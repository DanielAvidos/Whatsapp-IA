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
    enabled: d?.enabled !== undefined ? !!d.enabled : true, // default ON si no existe
    model: d?.model || "gemini-2.5-flash",
    productDetails: safeText(d?.productDetails),
    salesStrategy: safeText(d?.salesStrategy),
  };
}

/**
 * Idempotencia: subcolección DENTRO del doc bot
 * Ruta: channels/{channelId}/runtime/bot/bot_processed/{messageId}
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

async function generateWithGemini({ model, systemPrompt, userText, projectId, location }) {
  const vertexAI = new VertexAI({ project: projectId, location });
  const genModel = vertexAI.getGenerativeModel({
    model,
    generationConfig: { maxOutputTokens: 512, temperature: 0.6 },
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nUsuario: ${userText}` }] }],
  });

  const resp = result?.response;
  const text =
    resp?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

  return String(text || "").trim();
}

async function sendViaWorker({ workerUrl, channelId, toJid, text }) {
  const url = `${workerUrl}/v1/channels/${encodeURIComponent(channelId)}/messages/send`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toJid, text }),
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
          lastSkipAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSkipReason: fromMe ? "FROM_ME" : "IS_BOT",
          lastSkipMessagePath: snapshot.ref.path,
        },
        { merge: true }
      );
      return null;
    }

    logger.info("[BOT] Procesando mensaje entrante", { channelId, jid, messageId });

    const isNew = await markProcessed(channelId, messageId, { jid, text });
    if (!isNew) return null;

    try {
      const bot = await getBotConfig(channelId);
      if (!bot.enabled) return null;

      const workerUrl = await getWorkerUrl();
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;
      const location = "us-central1";

      const systemPrompt = buildSystemPrompt({
        salesStrategy: bot.salesStrategy,
        productDetails: bot.productDetails,
      });

      const reply = await generateWithGemini({
        model: bot.model,
        systemPrompt,
        userText: text,
        projectId,
        location,
      });

      if (!reply) throw new Error("Gemini no generó respuesta.");

      await sendViaWorker({ workerUrl, channelId, toJid: jid, text: reply });

      await setBotSuccess(channelId);
      logger.info("[BOT] Respuesta enviada", { channelId, jid });

    } catch (err) {
      const msg = err?.message || String(err);
      logger.error("[BOT] Error", { channelId, messageId, error: msg });
      await setBotError(channelId, msg, { lastFailMessagePath: snapshot.ref.path });
    }

    return null;
  });
