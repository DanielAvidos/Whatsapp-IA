/**
 * Auto-reply WhatsApp Bot (DEV/PROD)
 * Trigger: Firestore onCreate (Gen1 / v1 API)
 */

const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { VertexAI } = require("@google-cloud/vertexai");

admin.initializeApp();
const db = admin.firestore();

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

function buildSystemPrompt({ salesStrategy, productDetails }) {
  const hardRules = `
Eres un asistente automático experto en WhatsApp.
REGLAS GLOBALES:
- Responde claro, breve y útil.
- Usa emojis moderados.
- Si falta info, haz 1-2 preguntas.
- No inventes datos fuera del contexto.
- Responde en el idioma del usuario.
`.trim();

  return `
${hardRules}

=== ESTRATEGIA Y PERSONALIDAD ===
${salesStrategy || "Responde como asistente profesional. Si falta info, haz 1 pregunta para avanzar."}

=== BASE DE CONOCIMIENTO (PRODUCTO/SERVICIO) ===
${productDetails || ""}
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
    model: d?.model || "gemini-2.5-flash",
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
      lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
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
      lastAutoReplyAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Genera respuesta usando el historial de mensajes.
 */
async function generateWithGemini({ model, systemPrompt, messages, projectId, location }) {
  const vertexAI = new VertexAI({ project: projectId, location });
  const genModel = vertexAI.getGenerativeModel({
    model,
    generationConfig: { maxOutputTokens: 512, temperature: 0.6 },
  });

  // Formateamos el historial para que Gemini lo entienda como un diálogo
  const historyString = messages
    .map(m => `${m.role}: ${m.text}`)
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

    // Ignorar si es enviado por nosotros o por el bot
    if (fromMe || isBot) {
      await db.doc(`channels/${channelId}/runtime/bot`).set(
        {
          lastSkipAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSkipReason: fromMe ? "FROM_ME" : "IS_BOT",
          lastSkipMessagePath: snapshot.ref.path,
        },
        { merge: true }
      );
      return null;
    }

    logger.info("[BOT] Trigger detectado", { channelId, jid, messageId });

    // Idempotencia
    const isNew = await markProcessed(channelId, messageId, { jid, text });
    if (!isNew) {
      logger.info("[BOT] Mensaje ya procesado", { messageId });
      return null;
    }

    try {
      // 1. Obtener configuración
      const bot = await getBotConfig(channelId);
      if (!bot.enabled) {
        logger.info("[BOT] El bot está desactivado para este canal", { channelId });
        return null;
      }

      const workerUrl = await getWorkerUrl();
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;
      const location = "us-central1";

      const systemPrompt = buildSystemPrompt({
        salesStrategy: bot.salesStrategy,
        productDetails: bot.productDetails,
      });

      // 2. Cargar contexto (historial)
      logger.info("[BOT] Cargando contexto de conversación", { jid });
      const messages = await loadConversationContext(channelId, jid, 12);

      // 3. Generar respuesta con Gemini
      logger.info("[BOT] Generando respuesta con Gemini", { model: bot.model });
      const reply = await generateWithGemini({
        model: bot.model,
        systemPrompt,
        messages,
        projectId,
        location,
      });

      if (!reply) throw new Error("Gemini no generó ninguna respuesta válida.");

      // 4. Enviar vía worker
      logger.info("[BOT] Enviando respuesta al worker", { toJid: jid });
      await sendViaWorker({ 
        workerUrl, 
        channelId, 
        toJid: jid, 
        text: reply,
        meta: { triggerMessageId: messageId }
      });

      // 5. Registrar éxito
      await setBotSuccess(channelId);
      logger.info("[BOT] Flujo completado con éxito", { channelId, jid });

    } catch (err) {
      const msg = err?.message || String(err);
      logger.error("[BOT] Error crítico en el flujo", { channelId, messageId, error: msg });
      await setBotError(channelId, msg, { lastFailMessagePath: snapshot.ref.path });
    }

    return null;
  });
