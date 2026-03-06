
/**
 * Auto-reply & Follow-up WhatsApp Bot (DEV/PROD)
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
const SUPERADMIN_EMAIL = "superadmin@avidos.com";

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
 * Extraction Helpers
 */
function extractEmail(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const match = text.match(emailRegex);
  return match ? match[0].toLowerCase() : null;
}

function extractPhone(text) {
  const phoneRegex = /\+?\d{10,15}/g;
  const matches = text.match(phoneRegex);
  if (!matches) return null;
  return matches.find(m => m.replace(/\D/g, '').length >= 10) || null;
}

function extractName(text) {
  const patterns = [
    /me llamo ([\w\s]{2,30})/i,
    /soy ([\w\s]{2,30})/i,
    /mi nombre es ([\w\s]{2,30})/i,
    /mi nombre: ([\w\s]{2,30})/i,
    /atentamente ([\w\s]{2,30})/i,
    /atte ([\w\s]{2,30})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Trial & Access Control
 */
async function getChannelAccess(channelId) {
  const docRef = db.doc(`channels/${channelId}`);
  const snap = await docRef.get();
  if (!snap.exists) return { blocked: true, reason: "NOT_FOUND" };
  const data = snap.data();
  
  let trial = data.trial;
  // Lazy init if missing
  if (!trial) {
    const created = data.createdAt ? data.createdAt.toDate() : new Date();
    const endsAt = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
    trial = {
      status: "ACTIVE",
      startsAt: admin.firestore.Timestamp.fromDate(created),
      endsAt: admin.firestore.Timestamp.fromDate(endsAt),
    };
    await docRef.update({ trial });
  }

  const now = admin.firestore.Timestamp.now();
  const endsAtTs = trial.endsAt;
  const isExpired = now.toMillis() > (endsAtTs ? endsAtTs.toMillis() : 0);
  
  if (isExpired) {
    return { blocked: true, reason: "TRIAL_EXPIRED", endsAt: trial.endsAt };
  }
  
  return { blocked: false, endsAt: trial.endsAt };
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
    throw new Error("Falta la configuración de workerUrl en Firestore (colección runtime, documento config).");
  }
  return String(workerUrl).replace(/\/+$/, "");
}

async function getBotConfig(channelId) {
  const ref = db.doc(`channels/${channelId}/runtime/bot`);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};

  return {
    enabled: d?.enabled !== undefined ? !!d.enabled : true, // ON por defecto
    model: GEMINI_MODEL_LOCKED,
    productDetails: safeText(d?.productDetails),
    salesStrategy: safeText(d?.salesStrategy),
  };
}

async function markProcessed(channelId, messageId, payload) {
  const ref = db.collection('channels').doc(channelId).collection('runtime').doc('bot_processed').collection('ids').doc(messageId);
  const snap = await ref.get();
  if (snap.exists) return false;

  await ref.set({
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'completed',
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

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Worker send failed ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return body;
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
 * Admin: Extender Trial (Callable)
 */
exports.extendChannelTrial = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    logger.warn("[TRIAL] Unauthenticated request");
    throw new functions.https.HttpsError("unauthenticated", "Auth required");
  }
  
  const userEmail = context.auth.token.email || "";
  if (userEmail.toLowerCase() !== SUPERADMIN_EMAIL) {
    logger.warn("[TRIAL] Unauthorized request", { userEmail });
    throw new functions.https.HttpsError("permission-denied", "Only SuperAdmin can extend trials.");
  }

  const { channelId, extendDays, endsAt, reason } = data;
  logger.info("[TRIAL] extend requested", { channelId, extendDays, callerEmail: userEmail });

  try {
    const channelRef = db.doc(`channels/${channelId}`);
    const snap = await channelRef.get();
    
    if (!snap.exists) {
      logger.warn("[TRIAL] Channel not found", { channelId });
      throw new functions.https.HttpsError("not-found", "Channel not found");
    }
    
    const currentData = snap.data();
    let currentEndsAt = currentData.trial?.endsAt?.toDate() || new Date();
    
    let newEndsAt;
    if (endsAt) {
      newEndsAt = new Date(endsAt);
    } else {
      const baseDate = Math.max(currentEndsAt.getTime(), Date.now());
      newEndsAt = new Date(baseDate + (extendDays || 30) * 24 * 60 * 60 * 1000);
    }

    const trialUpdate = {
      status: "ACTIVE",
      endsAt: admin.firestore.Timestamp.fromDate(newEndsAt),
      extendedByUid: context.auth.uid,
      extendedByEmail: userEmail,
      extendedAt: admin.firestore.FieldValue.serverTimestamp(),
      reason: reason || "Extension manual"
    };

    await channelRef.set({ trial: trialUpdate }, { merge: true });
    logger.info("[TRIAL] extend success", { channelId, newEndsAt });

    return { ok: true, trial: trialUpdate, channelId };
  } catch (error) {
    logger.error("[TRIAL] extend failed", { channelId, error: error.message });
    throw new functions.https.HttpsError("internal", error.message);
  }
});

/**
 * Proxy: Send Message with Trial Check
 */
exports.sendMessageProxy = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required");
  
  const { channelId, to, text, clientMessageId } = data;
  const access = await getChannelAccess(channelId);
  
  if (access.blocked) {
    throw new functions.https.HttpsError("permission-denied", "Channel access blocked", { reason: access.reason });
  }

  const workerUrl = await getWorkerUrl();
  const result = await sendViaWorker({ 
    workerUrl, 
    channelId, 
    toJid: to, 
    text,
    meta: { 
      source: "proxy", 
      senderUid: context.auth.uid,
      clientMessageId: clientMessageId || null
    }
  });

  return { success: true, result };
});

/**
 * Trigger: Captura el perfil del cliente.
 */
exports.onIncomingMessageCaptureCustomerProfile = functions
  .region("us-central1")
  .firestore
  .document("channels/{channelId}/conversations/{jid}/messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const { channelId, jid, messageId } = context.params;
    const data = snapshot.data() || {};
    const fromMe = extractFromMe(data);
    const isBot = !!data.isBot;

    if (fromMe || isBot) return null;

    const text = extractText(data);
    if (!text) return null;

    const lockRef = db.doc(`channels/${channelId}/conversations/${jid}/profile_processed/${messageId}`);
    const lockSnap = await lockRef.get();
    if (lockSnap.exists) return null;
    await lockRef.set({ processedAt: admin.firestore.FieldValue.serverTimestamp() });

    const email = extractEmail(text);
    const phone = extractPhone(text);
    const name = extractName(text);

    if (!email && !phone && !name) return null;

    const convRef = db.doc(`channels/${channelId}/conversations/${jid}`);
    const convSnap = await convRef.get();
    const existing = convSnap.exists ? (convSnap.data().customer || {}) : {};

    const newCustomer = { ...existing };
    let changed = false;

    if (name && (!existing.name || existing.confidence?.nameConfidence !== "high")) {
      newCustomer.name = name;
      newCustomer.confidence = { ...newCustomer.confidence, nameConfidence: "med" };
      changed = true;
    }
    if (email && !existing.email) {
      newCustomer.email = email;
      newCustomer.confidence = { ...newCustomer.confidence, emailConfidence: "high" };
      changed = true;
    }
    if (phone && !existing.phone) {
      newCustomer.phone = phone;
      newCustomer.confidence = { ...newCustomer.confidence, phoneConfidence: "high" };
      changed = true;
    }

    if (changed) {
      newCustomer.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      newCustomer.source = "auto-extract";
      const displayName = newCustomer.name || newCustomer.email || newCustomer.phone || jid;
      await convRef.set({
        customer: newCustomer,
        displayName,
        lastCustomerProfileUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return null;
  });

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

    if (!text || fromMe || isBot) return null;

    const access = await getChannelAccess(channelId);
    if (access.blocked) {
      logger.info("[BOT] Canal bloqueado. Skip autoReply", { channelId, reason: access.reason });
      return null;
    }

    const isNew = await markProcessed(channelId, messageId, { jid, text });
    if (!isNew) return null;

    try {
      const bot = await getBotConfig(channelId);
      if (!bot.enabled) {
        logger.info("[BOT] IA desactivada globalmente para este canal", { channelId });
        return null;
      }

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
        meta: { triggerMessageId: messageId, source: "bot_auto" }
      });

      await db.doc(`channels/${channelId}/runtime/bot`).set({
        lastAutoReplyAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: null,
      }, { merge: true });

    } catch (err) {
      logger.error("[BOT] Error fatal", { channelId, error: err.message });
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

    const convRef = db.doc(`channels/${channelId}/conversations/${jid}`);

    if (!fromMe) {
      const isOptOut = detectOptOut(text);
      
      const convSnap = await convRef.get();
      const convData = convSnap.exists ? convSnap.data() : {};
      
      const shouldAutoEnable = convData.followupEnabled === undefined;

      if (isOptOut) {
        await convRef.set({
          followupStopped: true,
          followupEnabled: false,
          followupNextAt: null,
          followupStopReason: "OPTOUT",
          followupStopAt: now,
          updatedAt: now
        }, { merge: true });
      } else {
        const followupConfigSnap = await db.doc(`channels/${channelId}/runtime/followup`).get();
        const config = followupConfigSnap.exists ? followupConfigSnap.data() : {};
        
        // Sanitize cadence dynamic
        let cadence = [1, 3, 5, 8, 13, 21, 34, 55, 89];
        if (config.cadenceHours && Array.isArray(config.cadenceHours)) {
          const sanitized = config.cadenceHours
            .map(v => parseInt(v))
            .filter(v => !isNaN(v) && v > 0);
          if (sanitized.length > 0) cadence = sanitized;
        }
        
        // Next follow-up timestamp (step 0) rounded to minute exact
        const firstInterval = cadence[0] || 1;
        const nextAtDate = DateTime.now().plus({ hours: firstInterval }).set({ second: 0, millisecond: 0 }).toJSDate();

        await convRef.set({
          followupEnabled: shouldAutoEnable ? true : (convData.followupEnabled ?? false),
          followupStage: 0,
          followupStopped: false,
          followupLastCustomerAt: now,
          followupStopReason: "CUSTOMER_REPLIED",
          followupNextAt: admin.firestore.Timestamp.fromDate(nextAtDate),
          updatedAt: now
        }, { merge: true });
      }
    } else {
      await convRef.set({
        followupLastSentAt: now,
        updatedAt: now
      }, { merge: true });
    }
    return null;
  });

/**
 * Scheduler: Ejecuta el seguimiento minuto a minuto.
 */
exports.followupTickEveryMinute = functions
  .region("us-central1")
  .pubsub
  .schedule("every 1 minutes")
  .onRun(async (context) => {
    const now = DateTime.now().set({ second: 0, millisecond: 0 });
    const nowMinuteStartTs = admin.firestore.Timestamp.fromDate(now.toJSDate());
    const nowMinuteEndTs = admin.firestore.Timestamp.fromDate(now.plus({ minutes: 1 }).toJSDate());
    
    logger.info("[FOLLOWUP] Tick window start", { 
      start: now.toISO(), 
      end: now.plus({ minutes: 1 }).toISO() 
    });

    const channelsSnap = await db.collection("channels").get();
    
    for (const channelDoc of channelsSnap.docs) {
      const channelId = channelDoc.id;
      
      const access = await getChannelAccess(channelId);
      if (access.blocked) continue;

      const followupConfigSnap = await db.doc(`channels/${channelId}/runtime/followup`).get();
      const config = followupConfigSnap.exists ? followupConfigSnap.data() : { enabled: false };

      if (!config.enabled) continue;

      // Sanitize cadence dynamic
      let cadence = [1, 3, 5, 8, 13, 21, 34, 55, 89];
      if (config.cadenceHours && Array.isArray(config.cadenceHours)) {
        const sanitized = config.cadenceHours
          .map(v => parseInt(v))
          .filter(v => !isNaN(v) && v > 0);
        if (sanitized.length > 0) cadence = sanitized;
      }

      const timezone = config.businessHours?.timezone || "America/Mexico_City";
      const nowInTz = now.setZone(timezone);
      const startHour = parseInt(config.businessHours?.startHour ?? 8);
      const endHour = parseInt(config.businessHours?.endHour ?? 22);

      if (nowInTz.hour < startHour || nowInTz.hour >= endHour) {
        continue;
      }

      // Query conversations EXACTLY in this minute window
      const convsSnap = await db.collection(`channels/${channelId}/conversations`)
        .where("followupEnabled", "==", true)
        .where("followupStopped", "==", false)
        .where("followupNextAt", ">=", nowMinuteStartTs)
        .where("followupNextAt", "<", nowMinuteEndTs)
        .get();

      if (convsSnap.empty) continue;

      logger.info(`[FOLLOWUP] Found ${convsSnap.size} eligible conversations for channel ${channelId}`);

      const workerUrl = await getWorkerUrl();
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;

      let metrics = { total: convsSnap.size, sent: 0, errors: 0, skippedLock: 0 };

      for (const convDoc of convsSnap.docs) {
        const jid = convDoc.id;
        const state = convDoc.data();
        const step = state.followupStage || 0;

        // Idempotency lock determinista por el minuto programado
        const nextAtRaw = state.followupNextAt?.toDate ? state.followupNextAt.toDate() : null;
        const nextAtKey = nextAtRaw
          ? DateTime.fromJSDate(nextAtRaw).setZone(timezone)
              .set({ second: 0, millisecond: 0 })
              .toFormat("yyyyMMddHHmm")
          : nowInTz.toFormat("yyyyMMddHHmm");

        const lockId = `due_${nextAtKey}`;
        const lockRef = convDoc.ref.collection("followup_locks").doc(lockId);
        const lockSnap = await lockRef.get();
        
        if (lockSnap.exists) {
          metrics.skippedLock++;
          continue;
        }
        await lockRef.set({ lockedAt: admin.firestore.FieldValue.serverTimestamp() });

        try {
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
            meta: { type: "followup", step: step + 1, source: "scheduler" } 
          });

          // Calc next step rounded to minute
          const nextStep = step + 1;
          let nextAt = null;
          let followupEnabled = true;
          let stopReason = state.followupStopReason || null;

          const maxTouches = parseInt(config.maxTouches ?? cadence.length);

          if (nextStep < maxTouches) {
            const nextInterval = cadence[nextStep] || 24;
            const nextRounded = DateTime.now().plus({ hours: nextInterval }).set({ second: 0, millisecond: 0 }).toJSDate();
            nextAt = admin.firestore.Timestamp.fromDate(nextRounded);
          } else {
            followupEnabled = false;
            stopReason = "COMPLETED";
          }

          await convDoc.ref.update({
            followupStage: nextStep,
            followupLastSentAt: admin.firestore.FieldValue.serverTimestamp(),
            followupNextAt: nextAt,
            followupEnabled: followupEnabled,
            followupStopReason: stopReason,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          metrics.sent++;
          logger.info(`[FOLLOWUP] Sent to ${jid}`, { channelId, step: nextStep, nextAt: nextAt?.toDate()?.toISOString() });
        } catch (e) {
          metrics.errors++;
          logger.error(`[FOLLOWUP] Error en ${jid}`, { channelId, error: e.message });
        }
      }

      logger.info("[FOLLOWUP] Channel metrics finish", { channelId, metrics, cadenceSane: cadence });
    }
  });

/**
 * Trigger: Procesa archivos subidos a la base de conocimientos.
 */
exports.onKnowledgeFileFinalize = functions
  .region("us-central1")
  .storage.object()
  .onFinalize(async (object) => {
    const filePath = object.name; 
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
