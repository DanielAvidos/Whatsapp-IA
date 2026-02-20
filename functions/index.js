
/**
 * Auto-reply WhatsApp Bot (DEV/PROD)
 * Trigger: Firestore onCreate (Gen1 / v1 API)
 */

const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { VertexAI } = require("@google-cloud/vertexai");
const { Storage } = require("@google-cloud/storage");
const pdf = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const os = require("os");

admin.initializeApp();
const db = admin.firestore();
const storage = new Storage();

// --- MODEL LOCK ---
const GEMINI_MODEL_LOCKED = "gemini-2.5-flash";

function safeText(v) {
  return typeof v === "string" ? v : "";
}

/**
 * Carga los últimos N mensajes de una conversación para dar contexto a la IA.
 */
async function loadConversationContext(channelId, jid, limitCount = 12) {
  try {
    const snap = await db
      .collection(`channels/${channelId}/conversations/${jid}/messages`)
      .orderBy("timestamp", "desc")
      .limit(limitCount)
      .get();

    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .reverse();

    return items.map(m => {
      const role = m.fromMe ? "ASSISTANT" : "USER";
      const text = typeof m.text === "string" ? m.text : "";
      return { role, text };
    }).filter(x => x.text);
  } catch (error) {
    logger.error("[BOT] Error loading context", { channelId, jid, error: error.message });
    return [];
  }
}

/**
 * Carga los documentos de conocimiento listos del canal.
 */
async function loadKnowledgeBaseDocs(channelId) {
  try {
    const snap = await db
      .collection(`channels/${channelId}/kb_docs`)
      .where("status", "==", "READY")
      .orderBy("processedAt", "desc")
      .limit(5)
      .get();
    
    return snap.docs.map(d => ({
      fileName: d.data().fileName,
      summary: d.data().summary,
      extractedText: d.data().extractedText || "",
    }));
  } catch (error) {
    logger.error("[BOT] Error loading KB docs", { channelId, error: error.message });
    return [];
  }
}

function buildSystemPrompt({ salesStrategy, productDetails, kbDocs }) {
  const hardRules = `
Eres un asistente automático experto en WhatsApp.
REGLAS GLOBALES:
- Responde claro, breve y útil.
- Usa emojis moderados.
- Si falta info, haz 1-2 preguntas.
- No inventes datos fuera del contexto.
- Responde en el idioma del usuario.
`.trim();

  let kbSection = "";
  if (kbDocs && kbDocs.length > 0) {
    kbSection = "\n=== CONOCIMIENTO POR DOCUMENTOS ===\n";
    kbDocs.forEach(doc => {
      kbSection += `Documento: ${doc.fileName}\nResumen: ${doc.summary}\nContenido Relevante: ${doc.extractedText.slice(0, 3000)}\n---\n`;
    });
  }

  return `
${hardRules}

=== ESTRATEGIA Y PERSONALIDAD ===
${salesStrategy || "Responde como asistente profesional. Si falta info, haz 1 pregunta para avanzar."}

=== BASE DE CONOCIMIENTO (PRODUCTO/SERVICIO) ===
${productDetails || ""}
${kbSection}
`.trim();
}

async function getWorkerUrl() {
  const snap = await db.doc("runtime/config").get();
  const data = snap.exists ? snap.data() : null;
  const workerUrl = data?.workerUrl;

  if (!workerUrl) {
    throw new Error("Falta runtime/config.workerUrl en Firestore (debe apuntar al worker del ambiente).");
  }
  return String(workerUrl).replace(/\/+$/, "");
}

async function getBotConfig(channelId) {
  const ref = db.doc(`channels/${channelId}/runtime/bot`);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};

  return {
    enabled: d?.enabled !== undefined ? !!d.enabled : true,
    model: GEMINI_MODEL_LOCKED,
    productDetails: safeText(d?.productDetails),
    salesStrategy: safeText(d?.salesStrategy),
  };
}

/**
 * Idempotencia: subcolección bot_processed DENTRO del doc bot.
 */
async function markProcessed(channelId, messageId, payload) {
  const ref = db.doc(`channels/${channelId}/runtime/bot/bot_processed/${messageId}`);
  const snap = await ref.get();
  if (snap.exists) return false;

  await ref.set({
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...payload,
  });
  return true;
}

async function setBotError(channelId, errMsg, extra = {}) {
  await db.doc(`channels/${channelId}/runtime/bot`).set(
    {
      lastError: errMsg,
      lastErrorAt: admin.FieldValue.serverTimestamp(),
      ...extra,
    },
    { merge: true }
  );
}

async function setBotSuccess(channelId) {
  await db.doc(`channels/${channelId}/runtime/bot`).set(
    {
      lastError: null,
      lastErrorAt: null,
      lastAutoReplyAt: admin.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Genera respuesta usando el historial de mensajes y el conocimiento base.
 */
async function generateWithGemini({ systemPrompt, messages, projectId, location }) {
  const vertexAI = new VertexAI({ project: projectId, location });
  const genModel = vertexAI.getGenerativeModel({
    model: GEMINI_MODEL_LOCKED,
    generationConfig: { maxOutputTokens: 512, temperature: 0.6 },
  });

  const historyString = messages
    .map(m => `${m.role.toUpperCase()}: ${m.text}`)
    .join("\n");

  const fullPrompt = `${systemPrompt}\n\n=== HISTORIAL DE CONVERSACIÓN ===\n${historyString}\n\nASSISTANT:`;

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
  });

  const resp = result?.response;
  const text =
    resp?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

  return String(text || "").trim();
}

/**
 * Envía el mensaje replicando el payload manual del frontend.
 */
async function sendViaWorker({ workerUrl, channelId, toJid, text, meta }) {
  const url = `${workerUrl}/v1/channels/${encodeURIComponent(channelId)}/messages/send`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      to: toJid, 
      text,
      source: "bot",
      meta
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Worker send failed ${res.status}: ${body.slice(0, 300)}`);
  }
}

exports.autoReplyOnIncomingMessage = functions
  .region("us-central1")
  .firestore
  .document("channels/{channelId}/conversations/{jid}/messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const { channelId, jid, messageId } = context.params;
    const data = snapshot.data() || {};

    const text = safeText(data.text);
    const fromMe = !!data.fromMe;
    const isBot = !!data.isBot;

    if (!text) return null;

    if (fromMe || isBot) {
      await db.doc(`channels/${channelId}/runtime/bot`).set(
        {
          lastSkipAt: admin.FieldValue.serverTimestamp(),
          lastSkipReason: fromMe ? "FROM_ME" : "IS_BOT",
          lastSkipMessagePath: snapshot.ref.path,
        },
        { merge: true }
      );
      return null;
    }

    logger.info("[BOT] Trigger detectado", { channelId, jid, messageId });

    const isNew = await markProcessed(channelId, messageId, { jid, text });
    if (!isNew) return null;

    try {
      const bot = await getBotConfig(channelId);
      if (!bot.enabled) return null;

      const workerUrl = await getWorkerUrl();
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;
      const location = "us-central1";

      // Cargar conocimiento extendido
      const kbDocs = await loadKnowledgeBaseDocs(channelId);
      const systemPrompt = buildSystemPrompt({
        salesStrategy: bot.salesStrategy,
        productDetails: bot.productDetails,
        kbDocs,
      });

      const messages = await loadConversationContext(channelId, jid, 12);

      const reply = await generateWithGemini({
        systemPrompt,
        messages,
        projectId,
        location,
      });

      if (!reply) throw new Error("Gemini no generó respuesta.");

      await sendViaWorker({ 
        workerUrl, 
        channelId, 
        toJid: jid, 
        text: reply,
        meta: { triggerMessageId: messageId }
      });

      await setBotSuccess(channelId);
      logger.info("[BOT] Flujo completado con éxito", { channelId, jid });

    } catch (err) {
      const msg = err?.message || String(err);
      logger.error("[BOT] Error crítico en el flujo", { channelId, messageId, error: msg });
      await setBotError(channelId, msg, { lastFailMessagePath: snapshot.ref.path });
    }

    return null;
  });

/**
 * Trigger: Procesa archivos subidos a la base de conocimientos.
 */
exports.onKnowledgeFileFinalize = functions
  .region("us-central1")
  .storage.object()
  .onFinalize(async (object) => {
    const filePath = object.name; // channels/{channelId}/kb/{docId}/{fileName}
    
    if (!filePath.startsWith("channels/") || !filePath.includes("/kb/")) {
      return null;
    }

    const parts = filePath.split("/");
    const channelId = parts[1];
    const docId = parts[3];
    const fileName = parts[4];

    logger.info("[KB] Procesando archivo", { channelId, docId, fileName });

    const docRef = db.doc(`channels/${channelId}/kb_docs/${docId}`);
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;
    const location = "us-central1";
    
    try {
      const bucket = storage.bucket(object.bucket);
      const tempFilePath = path.join(os.tmpdir(), fileName);
      await bucket.file(filePath).download({ destination: tempFilePath });

      let extractedText = "";
      const contentType = object.contentType || "";

      if (contentType.includes("pdf")) {
        const dataBuffer = fs.readFileSync(tempFilePath);
        const data = await pdf(dataBuffer);
        extractedText = data.text;
      } else if (contentType.includes("image")) {
        const vertexAI = new VertexAI({ project: projectId, location });
        const genModel = vertexAI.getGenerativeModel({ model: GEMINI_MODEL_LOCKED });
        
        const base64Image = fs.readFileSync(tempFilePath, { encoding: "base64" });
        const result = await genModel.generateContent({
          contents: [{
            role: "user",
            parts: [
              { text: "Extrae toda la información técnica y relevante de esta imagen para un sistema de atención al cliente. Si hay tablas o datos estructurados, lístalos claramente." },
              { inlineData: { mimeType: contentType, data: base64Image } }
            ]
          }]
        });
        extractedText = result?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
      }

      fs.unlinkSync(tempFilePath);

      if (!extractedText.trim()) throw new Error("No se pudo extraer texto del archivo.");

      // Generar resumen corto
      const vertexAI = new VertexAI({ project: projectId, location });
      const genModel = vertexAI.getGenerativeModel({ model: GEMINI_MODEL_LOCKED });
      const summaryResult = await genModel.generateContent({
        contents: [{
          role: "user",
          parts: [{ text: `Resume la siguiente información extraída de un documento para atención al cliente. Produce entre 5 y 10 puntos clave. \n\nInformación:\n${extractedText.slice(0, 15000)}` }]
        }]
      });
      const summary = summaryResult?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "Resumen no disponible.";

      await docRef.set({
        status: "READY",
        extractedText: extractedText.slice(0, 30000),
        summary,
        processedAt: admin.FieldValue.serverTimestamp(),
        updatedAt: admin.FieldValue.serverTimestamp(),
      }, { merge: true });

      logger.info("[KB] Archivo procesado correctamente", { channelId, docId });

    } catch (error) {
      logger.error("[KB] Error procesando archivo", { channelId, docId, error: error.message });
      await docRef.set({
        status: "ERROR",
        error: error.message,
        updatedAt: admin.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return null;
  });
