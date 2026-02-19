/**
 * Auto-reply WhatsApp Bot (DEV/PROD)
 * Trigger: Firestore onCreate (v1) para evitar problemas de Eventarc/2nd gen.
 */

const functions = require("firebase-functions/v1");
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
 * Extrae el texto de un mensaje de diversas estructuras posibles (Baileys/Custom).
 */
function extractText(data) {
  // 1. Campos directos
  const direct =
    safeText(data.text) ||
    safeText(data.body) ||
    safeText(data.messageText) ||
    safeText(data.content);

  if (direct) return direct;

  // 2. Estructuras típicas de Baileys
  const msg = data.message || data.msg || data.payload || data.rawMessage || null;
  if (!msg || typeof msg !== "object") return "";

  // Casos comunes de Baileys
  if (typeof msg.conversation === "string") return msg.conversation;

  if (msg.extendedTextMessage && typeof msg.extendedTextMessage.text === "string") {
    return msg.extendedTextMessage.text;
  }

  // Wrappers anidados
  if (msg.message) {
    if (typeof msg.message.conversation === "string") return msg.message.conversation;
    if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
  }

  return "";
}

/**
 * Determina si el mensaje fue enviado por nosotros o por el bot.
 */
function extractFromMe(data) {
  if (typeof data.fromMe === "boolean") return data.fromMe;
  if (typeof data.isBot === "boolean" && data.isBot) return true;

  // Revisar en la "key" de Baileys
  const key = data.key || data.message?.key || data.message?.message?.key;
  if (key && typeof key.fromMe === "boolean") return key.fromMe;

  return false;
}

/**
 * Obtiene el JID del destinatario de forma robusta.
 */
function extractJid(data, fallbackJid) {
  return (
    safeText(data.jid) ||
    safeText(data.remoteJid) ||
    safeText(data.chatId) ||
    fallbackJid
  );
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
    throw new Error("Falta runtime/config.workerUrl en Firestore");
  }
  return String(workerUrl).replace(/\/+$/, "");
}

/**
 * Obtiene la configuración de IA del canal desde Firestore.
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
 * Registra por qué se ignoró un mensaje.
 */
async function setBotSkip(channelId, reason, path) {
  await db.doc(`channels/${channelId}/runtime/bot`).set({
    lastSkipReason: reason,
    lastSkipAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSkipMessagePath: path,
  }, { merge: true });
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
exports.autoReplyOnIncomingMessage = functions
  .region("us-central1")
  .firestore.document("channels/{channelId}/conversations/{jid}/messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const { channelId, jid, messageId } = context.params;
    const data = snapshot.data() || {};

    // 1. Extraer datos de forma robusta
    const text = extractText(data);
    const fromMe = extractFromMe(data);
    const isBot = !!data.isBot;

    // Logging inicial para depuración
    functions.logger.info("[BOT] Trigger disparado", {
      channelId,
      jid,
      messageId,
      hasText: !!text,
      fromMe,
      isBot,
      path: snapshot.ref.path
    });

    // 2. Validaciones tempranas con registro de "skip"
    if (!text) {
      functions.logger.info("[BOT] Mensaje sin texto, ignorando");
      await setBotSkip(channelId, "NO_TEXT", snapshot.ref.path);
      return null;
    }

    if (fromMe || isBot) {
      functions.logger.info("[BOT] Mensaje saliente o de bot, ignorando");
      await setBotSkip(channelId, fromMe ? "FROM_ME" : "IS_BOT", snapshot.ref.path);
      return null;
    }

    // 3. Idempotencia
    const isNew = await markProcessed(channelId, messageId, { jid, text: text.slice(0, 50) });
    if (!isNew) {
      functions.logger.info("[BOT] Mensaje ya procesado anteriormente", { messageId });
      return null;
    }

    try {
      // 4. Cargar configuración del bot
      const bot = await getBotConfig(channelId);
      if (!bot.enabled) {
        functions.logger.info("[BOT] IA desactivada para este canal", { channelId });
        return null;
      }

      // 5. Preparar entorno
      const workerUrl = await getWorkerUrl();
      const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
      if (!projectId) throw new Error("No se pudo determinar projectId");
      
      const location = "us-central1";
      const systemPrompt = buildSystemPrompt({
        salesStrategy: bot.salesStrategy,
        productDetails: bot.productDetails,
      });

      // 6. Generar respuesta con IA
      functions.logger.info("[BOT] Generando respuesta con Gemini...", { model: bot.model });
      const reply = await generateWithGemini({
        model: bot.model,
        systemPrompt,
        userText: text,
        projectId,
        location,
      });

      if (!reply) throw new Error("Gemini no generó ninguna respuesta válida.");

      // 7. Enviar vía Worker
      const toJid = extractJid(data, jid);
      functions.logger.info("[BOT] Enviando respuesta vía worker...", { toJid });
      await sendViaWorker({ 
        workerUrl, 
        channelId, 
        toJid, 
        text: reply 
      });

      // 8. Marcar éxito
      await setBotSuccess(channelId);
      functions.logger.info("[BOT] Respuesta enviada con éxito", { channelId, toJid });

    } catch (err) {
      const msg = err.message || String(err);
      functions.logger.error("[BOT] Error fatal en ejecución", { channelId, messageId, error: msg });
      await setBotError(channelId, msg);
    }
    
    return null;
  });
