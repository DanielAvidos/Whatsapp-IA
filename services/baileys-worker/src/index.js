
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;

const {
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
} = baileys;

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const cors = require('cors');
const dns = require('dns');

// --- BOOT ---
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection', reason?.stack || reason);
});

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

console.log('[BOOT] baileys-worker starting...', {
  revision: process.env.K_REVISION || 'unknown',
  timestamp: new Date().toISOString(),
});

// --- FIREBASE ADMIN ---
initializeApp();
const db = getFirestore();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// --- AI INITIALIZATION ---
let aiInstance = null;
async function getAI() {
  if (aiInstance) return aiInstance;
  const { genkit } = await import('genkit');
  const { googleAI } = await import('@genkit-ai/google-genai');
  aiInstance = genkit({
    plugins: [googleAI()],
    model: 'googleai/gemini-1.5-flash',
  });
  return aiInstance;
}

// --- GLOBAL STATE ---
const activeSockets = new Map();
const startingChannels = new Set();
const retryCounts = new Map();
const startPromises = new Map();
const channelConnState = new Map();
const lockRenewals = new Map();

// --- LOCKING SYSTEM ---
const REVISION = process.env.K_REVISION || 'local';

async function acquireChannelLock(channelId) {
  const lockRef = db.collection('channels').doc(channelId).collection('runtime').doc('lock');
  const now = Date.now();
  
  try {
    const lockSnap = await lockRef.get();
    if (lockSnap.exists) {
      const data = lockSnap.data();
      if (data.holder !== REVISION && data.expiresAt > now) {
        logger.warn({ channelId, holder: data.holder }, 'Lock held by another instance');
        return false;
      }
    }
    
    await lockRef.set({
      holder: REVISION,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: now + 60000,
    });
    return true;
  } catch (e) {
    logger.error({ channelId, error: e.message }, 'Failed to acquire lock');
    return false;
  }
}

async function releaseChannelLock(channelId) {
  const lockRef = db.collection('channels').doc(channelId).collection('runtime').doc('lock');
  try {
    const lockSnap = await lockRef.get();
    if (lockSnap.exists && lockSnap.data().holder === REVISION) {
      await lockRef.delete();
    }
    const interval = lockRenewals.get(channelId);
    if (interval) {
      clearInterval(interval);
      lockRenewals.delete(channelId);
    }
  } catch (e) {
    logger.error({ channelId, error: e.message }, 'Failed to release lock');
  }
}

function startLockRenewal(channelId) {
  if (lockRenewals.has(channelId)) clearInterval(lockRenewals.get(channelId));
  
  const interval = setInterval(async () => {
    const lockRef = db.collection('channels').doc(channelId).collection('runtime').doc('lock');
    try {
      await lockRef.set({
        holder: REVISION,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + 60000,
      }, { merge: true });
    } catch (e) {
      logger.error({ channelId }, 'Failed to renew lock');
    }
  }, 20000);
  
  lockRenewals.set(channelId, interval);
}

// --- HELPERS ---
async function upsertChannelStatus(channelId, patch) {
  const ref = db.collection('channels').doc(channelId);
  return ref.set(
    {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function emptyQrObject() {
  return { raw: null, public: null };
}

function safeJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return null;
  }
}

function extractText(message) {
  if (!message) return null;

  let msg = message;
  if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
  if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
  if (msg.viewOnceMessageV2Extension) msg = msg.viewOnceMessageV2Extension.message;
  if (msg.editedMessage) msg = msg.editedMessage.message;
  if (!msg) return null;

  const text = msg.conversation || 
               msg.extendedTextMessage?.text || 
               msg.imageMessage?.caption || 
               msg.videoMessage?.caption || 
               msg.documentMessage?.caption ||
               msg.buttonsResponseMessage?.selectedButtonId ||
               msg.templateButtonReplyMessage?.selectedId ||
               msg.listResponseMessage?.title ||
               msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
               null;
  return text;
}

// --- FIRESTORE AUTH STATE ---
function serializeToString(data) {
  return JSON.stringify(data, BufferJSON.replacer);
}
function parseFromString(str) {
  return JSON.parse(str, BufferJSON.reviver);
}

const useFirestoreAuthState = async (channelId) => {
  const authCollection = db.collection('channels').doc(channelId).collection('auth');
  const safeId = (id) => id.replace(/\//g, '__');

  const writeData = async (data, id) => {
    const docRef = authCollection.doc(safeId(id));
    const payload = { data: serializeToString(data), updatedAt: FieldValue.serverTimestamp() };
    await docRef.set(payload, { merge: false });
  };

  const readData = async (id) => {
    const docRef = authCollection.doc(safeId(id));
    const docSnap = await docRef.get();
    if (!docSnap.exists) return null;
    const raw = docSnap.data();
    if (!raw || typeof raw.data !== 'string') return null;
    try {
      return parseFromString(raw.data);
    } catch (e) {
      return null;
    }
  };

  const removeData = async (id) => {
    const docRef = authCollection.doc(safeId(id));
    await docRef.delete();
  };

  const loadedCreds = await readData('creds');
  const creds = loadedCreds || initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        await Promise.all(
          ids.map(async (id) => {
            const value = await readData(`${type}-${id}`);
            if (value) data[id] = value;
          })
        );
        return data;
      },
      set: async (data) => {
        const tasks = [];
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${category}-${id}`;
            tasks.push(value ? writeData(value, key) : removeData(key));
          }
        }
        await Promise.all(tasks);
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await writeData(state.creds, 'creds');
    },
  };
};

async function resetFirestoreAuthState(channelId) {
  const authCollectionRef = db.collection('channels').doc(channelId).collection('auth');
  const querySnapshot = await authCollectionRef.get();
  const deletePromises = [];
  querySnapshot.forEach((doc) => deletePromises.push(doc.ref.delete()));
  await Promise.all(deletePromises);
  logger.info({ channelId }, 'Firestore auth state reset.');
}

// --- MESSAGES PERSISTENCE ---
async function saveMessageToFirestore(channelId, jid, messageId, doc) {
  const convRef = db.collection('channels').doc(channelId).collection('conversations').doc(jid);
  const msgRef = convRef.collection('messages').doc(messageId);

  await msgRef.set({
    ...doc,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const isIn = doc.direction === 'IN';
  await convRef.set({
    jid,
    type: jid.endsWith('@g.us') ? 'group' : 'user',
    lastMessageText: doc.text || '[media]',
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessageId: messageId,
    unreadCount: isIn ? FieldValue.increment(1) : FieldValue.increment(0),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// --- CHATBOT LOGIC ---
async function handleChatbotReply(channelId, jid, messageId, text, sock) {
  try {
    const channelRef = db.collection('channels').doc(channelId);
    
    // 1. Get Settings
    const settingsSnap = await channelRef.collection('ai_training').doc('settings').get();
    const settings = settingsSnap.exists ? settingsSnap.data() : { enabled: false };
    if (!settings.enabled) return;

    // 2. Idempotency Check
    const processedRef = channelRef.collection('bot_processed').doc(messageId);
    const processedSnap = await processedRef.get();
    if (processedSnap.exists) return;

    // Mark as processing
    await processedRef.set({
      jid,
      processedAt: FieldValue.serverTimestamp(),
      status: 'processing'
    });

    // 3. Load Knowledge Base
    const productSnap = await channelRef.collection('ai_training').doc('product_details').get();
    const strategySnap = await channelRef.collection('ai_training').doc('sales_strategy').get();
    
    const productDetails = productSnap.exists ? productSnap.data().content : "";
    const salesStrategy = strategySnap.exists ? strategySnap.data().content : "Responde como asistente profesional. Haz 1 pregunta para avanzar.";

    // 4. Generate Response
    const ai = await getAI();
    const prompt = `
Eres un asistente experto para WhatsApp. 
REGLAS GLOBALES:
- Responde de forma clara, breve y útil.
- Usa emojis de forma moderada para ser cercano pero profesional.
- Si falta información para ayudar al usuario, haz 1 o 2 preguntas clave.
- NO inventes datos que no estén en el contexto.
- Responde siempre en el mismo idioma que el usuario.

ESTRATEGIA DE VENTAS Y PERSONALIDAD:
${salesStrategy}

DETALLES DEL PRODUCTO / BASE DE CONOCIMIENTO:
${productDetails}

MENSAJE DEL USUARIO:
${text}
    `;

    const { text: responseText } = await ai.generate({ prompt });
    if (!responseText) throw new Error('AI returned empty response');

    // 5. Send & Persist
    await new Promise(r => setTimeout(r, 2000));
    const r = await sock.sendMessage(jid, { text: responseText });

    const outMsgId = r?.key?.id || `bot-${Date.now()}`;
    await saveMessageToFirestore(channelId, jid, outMsgId, {
      messageId: outMsgId,
      jid,
      fromMe: true,
      direction: 'OUT',
      text: responseText,
      status: 'sent',
      timestamp: Date.now(),
      isBot: true,
    });

    // Update stats
    await channelRef.collection('ai_training').doc('settings').update({
      lastAutoReplyAt: FieldValue.serverTimestamp()
    });

    await processedRef.update({ status: 'completed' });

  } catch (e) {
    logger.error({ channelId, jid, error: e.message }, 'Chatbot execution failed');
    await db.collection('channels').doc(channelId).update({
      lastBotError: {
        message: e.message,
        at: FieldValue.serverTimestamp()
      }
    });
  }
}

// --- BAILEYS CORE ---
const MAX_RETRY = 6;
const RETRY_DELAY_MS = [2000, 5000, 10000, 20000, 60000, 120000];

async function startOrRestartBaileys(channelId, reason = 'manual') {
  if (startingChannels.has(channelId)) return;
  startingChannels.add(channelId);

  const lockAcquired = await acquireChannelLock(channelId);
  if (!lockAcquired) {
    logger.warn({ channelId, reason }, 'Could not acquire lock, skipping start');
    startingChannels.delete(channelId);
    return;
  }

  logger.info({ channelId, reason }, 'Starting Baileys...');
  startLockRenewal(channelId);

  await upsertChannelStatus(channelId, {
    status: 'CONNECTING',
    qr: emptyQrObject(),
    qrDataUrl: null,
    lastError: null,
    linked: false,
  });

  try {
    if (activeSockets.has(channelId)) {
      try { await activeSockets.get(channelId).logout(); } catch {}
      activeSockets.delete(channelId);
    }

    const { state, saveCreds } = await useFirestoreAuthState(channelId);

    let latest = null;
    try { latest = await fetchLatestBaileysVersion(); } catch (e) {}

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
      defaultQueryTimeoutMs: 60_000,
      version: latest?.version,
    });

    activeSockets.set(channelId, sock);
    channelConnState.set(channelId, { connected: false, lastSeenAt: Date.now() });

    sock.ev.on('creds.update', () => {
      saveCreds().catch(() => {});
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update || {};
      
      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await upsertChannelStatus(channelId, {
            status: 'QR',
            qr: { raw: qr, public: qrDataUrl },
            qrDataUrl,
            lastQrAt: FieldValue.serverTimestamp(),
          });
        } catch (e) {}
      }

      if (connection === 'open') {
        retryCounts.set(channelId, 0);
        channelConnState.set(channelId, { connected: true, lastSeenAt: Date.now() });
        const phoneId = sock?.user?.id?.split(':')?.[0] || null;
        await upsertChannelStatus(channelId, {
          status: 'CONNECTED',
          linked: true,
          qr: emptyQrObject(),
          qrDataUrl: null,
          phoneE164: phoneId ? `+${phoneId}` : null,
          connectedAt: FieldValue.serverTimestamp(),
        });
      }

      if (connection === 'close') {
        channelConnState.set(channelId, { connected: false, lastSeenAt: Date.now() });
        const err = lastDisconnect?.error;
        const statusCode = err instanceof Boom ? err.output.statusCode : 500;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        await upsertChannelStatus(channelId, {
          status: 'DISCONNECTED',
          linked: false,
          qr: emptyQrObject(),
          lastError: err ? { message: String(err.message || err), statusCode } : null,
        });

        activeSockets.delete(channelId);

        if (shouldReconnect) {
          let currentRetry = retryCounts.get(channelId) || 0;
          if (currentRetry < MAX_RETRY) {
            const delay = RETRY_DELAY_MS[currentRetry];
            retryCounts.set(channelId, currentRetry + 1);
            setTimeout(() => startOrRestartBaileys(channelId, 'auto-reconnect'), delay);
          }
        } else {
          await resetFirestoreAuthState(channelId);
          await releaseChannelLock(channelId);
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msgs = m?.messages || [];
        for (const msg of msgs) {
          const jid = msg?.key?.remoteJid;
          const messageId = msg?.key?.id;
          if (!jid || !messageId) continue;

          const fromMe = !!msg?.key?.fromMe;
          const text = extractText(msg?.message);
          const tsSec = typeof msg?.messageTimestamp === 'number' ? msg.messageTimestamp : null;
          const timestampMs = tsSec ? tsSec * 1000 : Date.now();

          await saveMessageToFirestore(channelId, jid, messageId, {
            messageId,
            jid,
            fromMe,
            direction: fromMe ? 'OUT' : 'IN',
            text,
            status: fromMe ? 'sent' : 'received',
            timestamp: timestampMs,
          });

          // Chatbot Trigger
          if (!fromMe && text) {
            handleChatbotReply(channelId, jid, messageId, text, sock).catch(() => {});
          }
        }
      } catch (e) {}
    });

    return sock;
  } catch (err) {
    await upsertChannelStatus(channelId, { status: 'ERROR' });
    await releaseChannelLock(channelId);
  } finally {
    startingChannels.delete(channelId);
  }
}

async function ensureSocketReady(channelId, timeoutMs = 25000) {
  const existing = activeSockets.get(channelId);
  if (existing && channelConnState.get(channelId)?.connected) return existing;

  if (!startPromises.has(channelId)) {
    startPromises.set(channelId, (async () => {
      await startOrRestartBaileys(channelId, 'ensure-socket');
    })().finally(() => startPromises.delete(channelId)));
  }
  await startPromises.get(channelId);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sock = activeSockets.get(channelId);
    if (sock && channelConnState.get(channelId)?.connected && sock.user) return sock;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

// --- EXPRESS APP ---
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get('/health', (_req, res) => res.status(200).send('ok'));

// --- BOT CONFIG ENDPOINTS (Admin SDK writes) ---
app.get('/v1/channels/:channelId/bot/config', async (req, res) => {
  try {
    const { channelId } = req.params;
    const channelRef = db.collection('channels').doc(channelId);
    
    const [settings, product, strategy] = await Promise.all([
      channelRef.collection('ai_training').doc('settings').get(),
      channelRef.collection('ai_training').doc('product_details').get(),
      channelRef.collection('ai_training').doc('sales_strategy').get(),
    ]);

    res.json({
      ok: true,
      config: {
        enabled: settings.exists ? settings.data().enabled : false,
        productDetails: product.exists ? product.data().content : "",
        salesStrategy: strategy.exists ? strategy.data().content : "",
        lastAutoReplyAt: settings.exists ? settings.data().lastAutoReplyAt : null,
        updatedAt: settings.exists ? settings.data().updatedAt : null,
        updatedByEmail: settings.exists ? settings.data().updatedByEmail : null,
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/v1/channels/:channelId/bot/config', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { enabled, productDetails, salesStrategy, updatedByUid, updatedByEmail } = req.body;
    
    const channelRef = db.collection('channels').doc(channelId);
    const common = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: updatedByUid || 'system',
      updatedByEmail: updatedByEmail || '',
    };

    const batch = db.batch();
    
    if (enabled !== undefined) {
      batch.set(channelRef.collection('ai_training').doc('settings'), { enabled, ...common }, { merge: true });
    }
    
    if (productDetails !== undefined) {
      batch.set(channelRef.collection('ai_training').doc('product_details'), { content: productDetails, ...common }, { merge: true });
    }

    if (salesStrategy !== undefined) {
      batch.set(channelRef.collection('ai_training').doc('sales_strategy'), { content: salesStrategy, ...common }, { merge: true });
    }

    await batch.commit();
    
    // Return updated config to client
    res.json({ 
      ok: true, 
      config: {
        enabled: enabled !== undefined ? enabled : false,
        productDetails: productDetails || "",
        salesStrategy: salesStrategy || "",
        updatedAt: new Date().toISOString(),
        updatedByEmail: updatedByEmail || '',
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- CHANNELS API ---
app.get('/v1/channels', async (_req, res) => {
  try {
    const snapshot = await db.collection('channels').get();
    res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/v1/channels', async (req, res) => {
  try {
    const { displayName, id } = req.body;
    const channelData = { displayName, status: 'DISCONNECTED', linked: false, createdAt: FieldValue.serverTimestamp() };
    const channelRef = id ? db.collection('channels').doc(id) : db.collection('channels').doc();
    await channelRef.set(channelData, { merge: true });
    res.status(201).json({ id: channelRef.id, ...channelData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/v1/channels/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { displayName } = req.body;
    await db.collection('channels').doc(channelId).update({ displayName, updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/v1/channels/:channelId/status', async (req, res) => {
  try {
    const snap = await db.collection('channels').doc(req.params.channelId).get();
    res.json(snap.exists ? { id: snap.id, ...snap.data() } : null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/v1/channels/:channelId/qr', (req, res) => {
  startOrRestartBaileys(req.params.channelId, 'qr-request');
  res.json({ ok: true });
});

app.post('/v1/channels/:channelId/repair', async (req, res) => {
  const { channelId } = req.params;
  await resetFirestoreAuthState(channelId);
  await releaseChannelLock(channelId);
  await upsertChannelStatus(channelId, { status: 'DISCONNECTED', linked: false, phoneE164: null });
  res.json({ ok: true });
});

app.post('/v1/channels/:channelId/disconnect', async (req, res) => {
  const sock = activeSockets.get(req.params.channelId);
  if (sock) try { await sock.logout(); } catch (e) {}
  res.json({ ok: true });
});

app.post('/v1/channels/:channelId/resetSession', async (req, res) => {
  const { channelId } = req.params;
  const sock = activeSockets.get(channelId);
  if (sock) try { await sock.logout(); } catch (e) {}
  activeSockets.delete(channelId);
  await resetFirestoreAuthState(channelId);
  await releaseChannelLock(channelId);
  await upsertChannelStatus(channelId, { status: 'DISCONNECTED', linked: false, phoneE164: null, me: null });
  res.json({ ok: true });
});

// --- MESSAGING API ---
app.get('/v1/channels/:channelId/conversations', async (req, res) => {
  try {
    const snap = await db.collection('channels').doc(req.params.channelId).collection('conversations').orderBy('lastMessageAt', 'desc').limit(50).get();
    res.json({ ok: true, conversations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/v1/channels/:channelId/conversations/:jid/messages', async (req, res) => {
  try {
    const snap = await db.collection('channels').doc(req.params.channelId).collection('conversations').doc(decodeURIComponent(req.params.jid)).collection('messages').orderBy('timestamp', 'desc').limit(50).get();
    res.json({ ok: true, messages: snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/v1/channels/:channelId/messages/send', async (req, res) => {
  try {
    const { to, text } = req.body;
    const sock = await ensureSocketReady(req.params.channelId);
    if (!sock) return res.status(409).json({ error: 'Socket not ready' });
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const r = await sock.sendMessage(jid, { text });
    await saveMessageToFirestore(req.params.channelId, jid, r.key.id, { messageId: r.key.id, jid, fromMe: true, direction: 'OUT', text, status: 'sent', timestamp: Date.now() });
    res.json({ ok: true, messageId: r.key.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/v1/channels/:channelId/conversations/:jid/markRead', async (req, res) => {
  try {
    await db.collection('channels').doc(req.params.channelId).collection('conversations').doc(decodeURIComponent(req.params.jid)).set({ unreadCount: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'HTTP server listening');
  try {
    const snap = await db.collection('channels').where('linked', '==', true).get();
    for (const docSnap of snap.docs) startOrRestartBaileys(docSnap.id, 'boot');
  } catch (e) {}
});
