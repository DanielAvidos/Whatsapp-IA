const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { VertexAI } = require("@google-cloud/vertexai");

admin.initializeApp();
const db = admin.firestore();

/**
 * Normaliza valores de texto para evitar errores de tipo.
 */
function safeText(v) {
  return (typeof v === "string" ? v : "") || "";
}

/**
 * Construye el prompt del sistema basado en la configuración del canal.
 */
function buildSystemPrompt({ salesStrategy, productDetails }) {
  const hardRules = `
Eres un asistente automático experto en WhatsApp.
REGLAS GLOBALES:
- Responde de forma clara, breve y útil.
- Usa emojis de forma moderada para ser cercano pero profesional.
- Si falta información para ayudar al usuario, haz 1 o 2 preguntas clave.
- NO inventes datos que no estén en el contexto.
- Responde siempre en el mismo idioma que el usuario.
`.trim();

  return `
${hardRules}

=== ESTRATEGIA DE VENTAS Y PERSONALIDAD ===
${salesStrategy || "Responde como asistente profesional. Haz 1 pregunta para avanzar si falta información."}

=== DETALLES DEL PRODUCTO / BASE DE CONOCIMIENTO ===
${productDetails || ""}
`.trim();
}

/**
 * Obtiene la URL del worker configurada para el proyecto.
 */
async function getWorkerUrl() {
  const snap = await db.doc("runtime/config").get();
  const data = snap.exists ? snap.data() : null;
  const workerUrl = data?.workerUrl;
  if (!workerUrl) {
    logger.error("Falta runtime/config.workerUrl en Firestore");
    throw new Error("Worker URL no configurada");
  }
  return String(workerUrl).replace(/\/+$/, "");
}

/**
 * Obtiene la configuración de IA del canal.
 */
async function getBotConfig(channelId) {
  const snap = await db.doc(`channels/${channelId}/runtime/bot`).get();
  const data = snap.exists ? snap.data() : {};
  return {
    enabled: !!data.enabled,
    model: data.model || "gemini-1.5-flash",
    productDetails: safeText(data.productDetails),
    salesStrategy: safeText(data.salesStrategy),
  };
}

/**
 * Implementa idempotencia para no responder dos veces al mismo mensaje.
 */
async function markProcessed(channelId, messageId, payload) {
  const ref = db.doc(`channels/${channelId}/runtime/bot_processed/${messageId}`);
  const snap = await ref.get();
  if (snap.exists) return false;
  await ref.set({
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...payload,
  });
  return true;
}

/**
 * Registra errores en la configuración del bot para visualización en UI.
 */
async function setBotError(channelId, errMsg) {
  await db.doc(`channels/${channelId}/runtime/bot`).set(
    {
      lastError: errMsg,
      lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Registra éxito en la auto-respuesta.
 */
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
 * Genera contenido usando Vertex AI Gemini.
 */
async function generateWithGemini({ model, systemPrompt, userText, projectId, location }) {
  const vertexAI = new VertexAI({ project: projectId, location });
  const genModel = vertexAI.getGenerativeModel({ 
    model: model,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
  });

  const result = await genModel.generateContent({
    contents: [
      { role: "user", parts: [{ text: `${systemPrompt}\n\nUsuario dice: ${userText}` }] }
    ],
  });

  const response = result.response;
  const text = response.candidates[0].content.parts[0].text || "";
  return String(text).trim();
}

/**
 * Envía el mensaje de respuesta a través del endpoint del worker de Baileys.
 */
async function sendViaWorker({ workerUrl, channelId, toJid, text }) {
  const url = `${workerUrl}/v1/channels/${encodeURIComponent(channelId)}/messages/send`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toJid, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Worker send failed ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Función principal: Dispara cuando se guarda un mensaje en la subcolección de una conversación.
 */
exports.autoReplyOnIncomingMessage = onDocumentCreated(
  {
    document: "channels/{channelId}/conversations/{jid}/messages/{messageId}",
    region: "us-central1",
  },
  async (event) => {
    const { channelId, jid, messageId } = event.params;
    const data = event.data?.data() || {};

    // 1. Validar si el mensaje es apto para auto-respuesta
    const text = safeText(data.text);
    const fromMe = !!data.fromMe;
    const isBot = !!data.isBot;

    // Solo responder a mensajes de texto entrantes que no sean del bot mismo
    if (!text || fromMe || isBot) return;

    logger.info("[BOT] Procesando mensaje entrante", { channelId, jid, messageId });

    // 2. Idempotencia
    const isNew = await markProcessed(channelId, messageId, { jid, text });
    if (!isNew) {
      logger.info("[BOT] Mensaje ya procesado anteriormente", { messageId });
      return;
    }

    try {
      // 3. Cargar configuración del bot
      const bot = await getBotConfig(channelId);
      if (!bot.enabled) {
        logger.info("[BOT] IA desactivada para este canal", { channelId });
        return;
      }

      // 4. Obtener URL del worker
      const workerUrl = await getWorkerUrl();

      // 5. Configuración de Vertex AI
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.instanceId().app.options.projectId;
      const location = "us-central1";
      
      const systemPrompt = buildSystemPrompt({
        salesStrategy: bot.salesStrategy,
        productDetails: bot.productDetails,
      });

      // 6. Generar respuesta con IA
      const reply = await generateWithGemini({
        model: bot.model,
        systemPrompt,
        userText: text,
        projectId,
        location,
      });

      if (!reply) throw new Error("Gemini no generó ninguna respuesta válida.");

      // 7. Enviar vía Worker
      await sendViaWorker({ 
        workerUrl, 
        channelId, 
        toJid: jid, 
        text: reply 
      });

      // 8. Marcar éxito
      await setBotSuccess(channelId);
      logger.info("[BOT] Respuesta enviada con éxito", { channelId, jid });

    } catch (err) {
      const msg = err.message || String(err);
      logger.error("[BOT] Error fatal en ejecución", { channelId, messageId, error: msg });
      await setBotError(channelId, msg);
    }
  }
);
