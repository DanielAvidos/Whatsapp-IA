
/**
 * Auto-reply & Follow-up WhatsApp Bot (DEV/PROD)
 * Trigger: Firestore onCreate & Scheduled
 */

const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { VertexAI } = require("@google-cloud/vertexai");
const { Storage } = require("@google-cloud/storage");
const { DateTime } = require("luxon");
const pdf = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const os = require("os");

admin.initializeApp();
const db = admin.firestore();
const storage = new Storage();

// --- MODEL LOCK ---
const GEMINI_MODEL_LOCKED = "gemini-2.5-flash";

// --- HELPERS ---
function safeText(v) {
  return typeof v === "string" ? v : "";
}

function extractText(data) {
  const direct = safeText(data.text) || safeText(data.body) || safeText(data.messageText);
  if (direct) return direct;
  const msg = data.message || data.msg || {};
  return msg.conversation || msg.extendedTextMessage?.text || "";
}

function extractFromMe(data) {
  if (typeof data.fromMe === "boolean") return data.fromMe;
  const key = data.key || data.message?.key || {};
  return !!key.fromMe;
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
      const text = extractText(m);
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

function buildSystemPrompt({ salesStrategy, productDetails, kbDocs, isFollowup = false, step = 0 }) {
  const hardRules = `
Eres un asistente automático experto en WhatsApp.
REGLAS GLOBALES:
- Responde claro, breve y útil.
- Usa emojis moderados.
- Si falta info, haz 1-2 preguntas.
- No inventes datos fuera del contexto.
- Responde en el idioma del usuario.
`.trim();

  let followupInstruction = "";
  if (isFollowup) {
    followupInstruction = `\n=== INSTRUCCIÓN DE SEGUIMIENTO (Paso ${step + 1}) ===\nEste es un mensaje de seguimiento proactivo porque el cliente no ha respondido. No seas insistente, varía el tono según el paso. Si es el primer paso, solo recuerda amablemente. Si es avanzado, ofrece un valor adicional o pregunta si prefiere que no le escribamos.`;
  }

  let kbSection = "";
  if (kbDocs && kbDocs.length > 0) {
    kbSection = "\n=== CONOCIMIENTO POR DOCUMENTOS ===\n";
    kbDocs.forEach(doc => {
      kbSection += `Documento: ${doc.fileName}\nResumen: ${doc.summary}\nContenido Relevante: ${doc.extractedText.slice(0, 2000)}\n---\n`;
    });
  }

  return `
${hardRules}
${followupInstruction}

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
    throw new Error("Falta runtime/config.workerUrl en Firestore.");
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
  const text = resp?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

  return String(text || "").trim();
}

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

// --- OPT-OUT DETECTION ---
const OPT_OUT_KEYWORDS = ["stop", "alto", "cancelar", "no me escribas", "deja de escribir", "no me interesa", "no estoy interesado", "ya no", "baja", "unsubscribe", "quitar", "no gracias", "no quiero"];

function detectOptOut(text) {
  if (!text) return false;
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return OPT_OUT_KEYWORDS.some(k => normalized.includes(k));
}

// --- CLOUD FUNCTIONS ---

/**
 * Trigger: Responde mensajes entrantes.
 */
exports.autoReplyOnIncomingMessage = functions
  .region("us-central1")
  .firestore
  .document("channels/{channelId}/conversations/{jid}/messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const { channelId, jid, messageId } = context.params;
    const data = snapshot.data() || {};

    const text = extractText(data);
    const fromMe = extractFromMe(data);
    const isBot = !!data.isBot;

    if (!text) return null;

    if (fromMe || isBot) {
      await db.doc(`channels/${channelId}/runtime/bot`).set({
        lastSkipAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSkipReason: fromMe ? "FROM_ME" : "IS_BOT",
      }, { merge: true });
      return null;
    }

    const isNew = await markProcessed(channelId, messageId, { jid, text });
    if (!isNew) return null;

    try {
      const bot = await getBotConfig(channelId);
      if (!bot.enabled) return null;

      const workerUrl = await getWorkerUrl();
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;
      const location = "us-central1";

      const kbDocs = await loadKnowledgeBaseDocs(channelId);
      const systemPrompt = buildSystemPrompt({
        salesStrategy: bot.salesStrategy,
        productDetails: bot.productDetails,
        kbDocs,
      });

      const messages = await loadConversationContext(channelId, jid, 12);

      const reply = await generateWithGemini({ systemPrompt, messages, projectId, location });

      if (!reply) throw new Error("Gemini no generó respuesta.");

      await sendViaWorker({ 
        workerUrl, 
        channelId, 
        toJid: jid, 
        text: reply,
        meta: { triggerMessageId: messageId }
      });

      await db.doc(`channels/${channelId}/runtime/bot`).set({
        lastAutoReplyAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: null,
      }, { merge: true });

    } catch (err) {
      logger.error("[BOT] Error", { channelId, error: err.message });
      await db.doc(`channels/${channelId}/runtime/bot`).set({
        lastError: err.message,
        lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return null;
  });

/**
 * Trigger: Actualiza estado de follow-up al llegar mensajes.
 */
exports.onIncomingMessageUpdateFollowupState = functions
  .region("us-central1")
  .firestore
  .document("channels/{channelId}/conversations/{jid}/messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const { channelId, jid } = context.params;
    const data = snapshot.data() || {};
    const fromMe = extractFromMe(data);
    const text = extractText(data);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // El estado del follow-up ahora vive en el documento de la conversación mismo
    const convRef = db.doc(`channels/${channelId}/conversations/${jid}`);

    if (!fromMe) {
      // Mensaje del cliente: resetear o manejar opt-out
      const isOptOut = detectOptOut(text);
      if (isOptOut) {
        await convRef.set({
          followupStopped: true,
          followupEnabled: false,
          followupStopReason: "OPTOUT",
          followupStopAt: now,
          updatedAt: now
        }, { merge: true });
      } else {
        await convRef.set({
          followupStage: 0,
          followupLastCustomerAt: now,
          followupStopReason: "CUSTOMER_REPLIED",
          followupNextAt: null,
          updatedAt: now
        }, { merge: true });
      }
    } else {
      // Mensaje del bot/empresa: registrar para cooldown
      await convRef.set({
        followupLastSentAt: now,
        updatedAt: now
      }, { merge: true });
    }
    return null;
  });

/**
 * Scheduler: Ejecuta el seguimiento horario.
 */
exports.followupTickHourly = functions
  .region("us-central1")
  .pubsub
  .schedule("every 60 minutes")
  .onRun(async (context) => {
    const channelsSnap = await db.collection("channels").get();
    
    for (const channelDoc of channelsSnap.docs) {
      const channelId = channelDoc.id;
      // Ruta correcta de configuración: channels/{id}/runtime/followup
      const followupConfigSnap = await db.doc(`channels/${channelId}/runtime/followup`).get();
      const config = followupConfigSnap.exists ? followupConfigSnap.data() : {
        enabled: false, 
        businessHours: { startHour: 8, endHour: 22, timezone: "America/Mexico_City" }, 
        maxTouches: 9, 
        cadenceHours: [1, 3, 5, 8, 13, 21, 34, 55, 89]
      };

      if (!config.enabled) continue;

      // Validar hora actual en el timezone del canal
      const nowInTz = DateTime.now().setZone(config.businessHours?.timezone || "America/Mexico_City");
      if (nowInTz.hour < (config.businessHours?.startHour || 8) || nowInTz.hour >= (config.businessHours?.endHour || 22)) {
        logger.info(`[FOLLOWUP] Canal ${channelId} fuera de horario (${nowInTz.hour}h)`);
        continue;
      }

      const convsSnap = await db.collection(`channels/${channelId}/conversations`)
        .where("followupEnabled", "==", true)
        .where("followupStopped", "==", false)
        .get();

      const workerUrl = await getWorkerUrl();
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;

      for (const convDoc of convsSnap.docs) {
        const jid = convDoc.id;
        const state = convDoc.data();
        
        const step = state.followupStage || 0;
        if (step >= (config.maxTouches || 9)) {
          await convDoc.ref.update({ followupStopReason: "COMPLETED", followupEnabled: false });
          continue;
        }

        // Calcular elegibilidad
        const lastCustomerAt = state.followupLastCustomerAt?.toDate();
        const lastSentAt = state.followupLastSentAt?.toDate();
        if (!lastCustomerAt) continue;

        const hoursSinceCustomer = (Date.now() - lastCustomerAt.getTime()) / (1000 * 60 * 60);
        const hoursSinceBot = lastSentAt ? (Date.now() - lastSentAt.getTime()) / (1000 * 60 * 60) : 999;

        const schedule = config.cadenceHours || [1, 3, 5, 8, 13, 21, 34, 55, 89];

        if (hoursSinceCustomer >= schedule[step] && hoursSinceBot >= 1) {
          // Idempotencia por hora
          const lockId = nowInTz.toFormat("yyyyMMddHH");
          const lockRef = convDoc.ref.collection("followup_locks").doc(lockId);
          const lockSnap = await lockRef.get();
          if (lockSnap.exists) continue;
          await lockRef.set({ lockedAt: admin.firestore.FieldValue.serverTimestamp() });

          try {
            logger.info(`[FOLLOWUP] Enviando paso ${step + 1} a ${jid}`);
            const bot = await getBotConfig(channelId);
            const kbDocs = await loadKnowledgeBaseDocs(channelId);
            const systemPrompt = buildSystemPrompt({ 
              salesStrategy: bot.salesStrategy, productDetails: bot.productDetails, 
              kbDocs, isFollowup: true, step 
            });
            const messages = await loadConversationContext(channelId, jid, 6);

            const reply = await generateWithGemini({ systemPrompt, messages, projectId, location: "us-central1" });
            if (!reply) throw new Error("Gemini no generó follow-up.");

            await sendViaWorker({ 
              workerUrl, channelId, toJid: jid, text: reply, 
              meta: { type: "followup", step: step + 1 } 
            });

            await convDoc.ref.update({
              followupStage: step + 1,
              followupLastSentAt: admin.firestore.FieldValue.serverTimestamp(),
              followupNextAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + (schedule[step+1] || 24) * 3600000)),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (e) {
            logger.error(`[FOLLOWUP] Error en ${jid}`, e.message);
          }
        }
      }
    }
  });

/**
 * Trigger: Procesa archivos subidos a la base de conocimientos.
 */
exports.onKnowledgeFileFinalize = functions
  .region("us-central1")
  .storage.object()
  .onFinalize(async (object) => {
    const filePath = object.name; // channels/{channelId}/kb/{docId}/{fileName}
    if (!filePath.startsWith("channels/") || !filePath.includes("/kb/")) return null;

    const parts = filePath.split("/");
    const channelId = parts[1];
    const docId = parts[3];
    const fileName = parts[4];

    const docRef = db.doc(`channels/${channelId}/kb_docs/${docId}`);
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;
    
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
        const vertexAI = new VertexAI({ project: projectId, location: "us-central1" });
        const genModel = vertexAI.getGenerativeModel({ model: GEMINI_MODEL_LOCKED });
        const base64Image = fs.readFileSync(tempFilePath, { encoding: "base64" });
        const result = await genModel.generateContent({
          contents: [{ role: "user", parts: [
            { text: "Extrae el texto y describe la información relevante de esta imagen." },
            { inlineData: { mimeType: contentType, data: base64Image } }
          ]}]
        });
        extractedText = result?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
      }

      fs.unlinkSync(tempFilePath);
      if (!extractedText.trim()) throw new Error("Archivo vacío.");

      const vertexAI = new VertexAI({ project: projectId, location: "us-central1" });
      const genModel = vertexAI.getGenerativeModel({ model: GEMINI_MODEL_LOCKED });
      const summaryResult = await genModel.generateContent({
        contents: [{ role: "user", parts: [{ text: `Resume esta información en 5-10 puntos clave:\n${extractedText.slice(0, 10000)}` }] }]
      });
      const summary = summaryResult?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "Sin resumen.";

      await docRef.set({
        status: "READY",
        summary,
        extractedText: extractedText.slice(0, 30000),
        processedAt: admin.FieldValue.serverTimestamp(),
        updatedAt: admin.FieldValue.serverTimestamp(),
      }, { merge: true });

    } catch (error) {
      logger.error("[KB] Error", { docId, error: error.message });
      await docRef.set({ status: "ERROR", error: error.message, updatedAt: admin.FieldValue.serverTimestamp() }, { merge: true });
    }
    return null;
  });
