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

const { version: baileysVersionFromPkg } = require('@whiskeysockets/baileys/package.json');

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

// --- GLOBAL STATE ---
const activeSockets = new Map();      // <channelId, WASocket>
const startingChannels = new Set();   // <channelId> is being started
const retryCounts = new Map();        // <channelId, number>
const startPromises = new Map();      // <channelId, Promise<void>>
const channelConnState = new Map();   // <channelId, { connected: boolean, lastSeenAt: number }>
const lockRenewals = new Map();      // <channelId, Interval>

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

// --- BAILEYS CORE ---
const MAX_RETRY = 6;
const RETRY_DELAY_MS = [2000, 5000, 10000, 20000, 60000, 120000];

async function startOrRestartBaileys(channelId, reason = 'manual') {
  if (startingChannels.has(channelId)) {
    return;
  }
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
    try {
      latest = await fetchLatestBaileysVersion();
    } catch (e) {}

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
      logger.info({ channelId, connection, hasQr: !!qr }, 'connection.update');

      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await upsertChannelStatus(channelId, {
            status: 'QR',
            qr: { raw: qr, public: qrDataUrl },
            qrDataUrl,
            lastQrAt: FieldValue.serverTimestamp(),
            lastError: null,
          });
        } catch (e) {
          logger.error({ channelId }, 'Failed to build QR');
        }
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
          lastError: null,
          phoneE164: phoneId ? `+${phoneId}` : null,
          me: safeJson(sock?.user || null),
          connectedAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
        });
      }

      if (connection === 'close') {
        channelConnState.set(channelId, { connected: false, lastSeenAt: Date.now() });
        const err = lastDisconnect?.error;
        const statusCode = err instanceof Boom ? err.output.statusCode : 500;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn({ channelId, statusCode, shouldReconnect }, 'Connection closed');

        await upsertChannelStatus(channelId, {
          status: 'DISCONNECTED',
          linked: false,
          qr: emptyQrObject(),
          qrDataUrl: null,
          lastError: err ? { message: String(err.message || err), statusCode } : null,
          lastSeenAt: FieldValue.serverTimestamp(),
        });

        activeSockets.delete(channelId);

        if (shouldReconnect) {
          let currentRetry = retryCounts.get(channelId) || 0;
          if (currentRetry < MAX_RETRY) {
            const delay = RETRY_DELAY_MS[currentRetry] + Math.floor(Math.random() * 1000);
            retryCounts.set(channelId, currentRetry + 1);
            setTimeout(() => startOrRestartBaileys(channelId, 'auto-reconnect'), delay);
          } else {
            await upsertChannelStatus(channelId, {
              status: 'ERROR',
              lastError: { message: 'Max retries reached.' },
            });
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
        const tasks = msgs.map(async (msg) => {
          const jid = msg?.key?.remoteJid;
          const messageId = msg?.key?.id;
          if (!jid || !messageId) return;

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
            raw: null, 
          });

          await upsertChannelStatus(channelId, { lastSeenAt: FieldValue.serverTimestamp() });
        });

        await Promise.allSettled(tasks);
      } catch (e) {
        logger.error({ channelId }, 'messages.upsert failed');
      }
    });

    return sock;
  } catch (err) {
    logger.error({ channelId, error: err.message }, 'START_ERROR');
    await upsertChannelStatus(channelId, {
      status: 'ERROR',
      qr: emptyQrObject(),
      qrDataUrl: null,
      lastError: { message: `START_ERROR: ${err.message}`, statusCode: 500 },
    });
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

app.get('/debug/baileys', (_req, res) => {
  const socketsInfo = Array.from(activeSockets.keys()).map((channelId) => ({
    channelId,
    connected: !!channelConnState.get(channelId)?.connected,
    user: activeSockets.get(channelId)?.user || null,
  }));
  res.json({
    ok: true,
    activeSocketsCount: activeSockets.size,
    socketsInfo,
    startingChannels: Array.from(startingChannels),
    ts: new Date().toISOString(),
  });
});

// --- API V1 ENDPOINTS ---
app.get('/v1/channels', async (_req, res) => {
  try {
    const snapshot = await db.collection('channels').get();
    const channels = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(channels);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to list channels' });
  }
});

app.post('/v1/channels', async (req, res) => {
  try {
    const { displayName, id } = req.body;
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const channelData = {
      displayName,
      status: 'DISCONNECTED',
      linked: false,
      qr: emptyQrObject(),
      createdAt: FieldValue.serverTimestamp(),
    };

    let channelRef;
    if (id) {
      channelRef = db.collection('channels').doc(id);
      await channelRef.set(channelData, { merge: true });
    } else {
      channelRef = await db.collection('channels').add(channelData);
    }

    res.status(201).json({ id: channelRef.id, ...channelData });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to create channel' });
  }
});

app.patch('/v1/channels/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { displayName } = req.body;
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    await db.collection('channels').doc(channelId).set({
      displayName,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ ok: true, message: 'Alias updated' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to update alias' });
  }
});

app.get('/v1/channels/:channelId/status', async (req, res) => {
  try {
    const { channelId } = req.params;
    const snap = await db.collection('channels').doc(channelId).get();
    if (!snap.exists) return res.json(null);

    const data = snap.data() || {};
    const qr = data.qr && typeof data.qr === 'object' ? data.qr : emptyQrObject();

    res.json({ id: snap.id, ...data, qr });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/v1/channels/:channelId/qr', async (req, res) => {
  const { channelId } = req.params;
  const sock = activeSockets.get(channelId);
  const isStarting = startingChannels.has(channelId);

  if (sock || isStarting) {
    const snap = await db.collection('channels').doc(channelId).get();
    return res.status(200).json({
      ok: true,
      message: 'Process already active',
      status: snap.exists ? snap.data() : null,
    });
  }

  startOrRestartBaileys(channelId, 'qr-request');
  res.json({ ok: true, message: 'QR generation process started.' });
});

app.post('/v1/channels/:channelId/repair', async (req, res) => {
  const { channelId } = req.params;
  logger.info({ channelId }, 'API request: repair');

  await resetFirestoreAuthState(channelId);
  await releaseChannelLock(channelId);

  await upsertChannelStatus(channelId, {
    status: 'DISCONNECTED',
    linked: false,
    qr: emptyQrObject(),
    qrDataUrl: null,
    phoneE164: null,
    lastError: null,
  });

  res.json({ ok: true, message: 'Channel repair initiated.' });
});

app.post('/v1/channels/:channelId/disconnect', async (req, res) => {
  const { channelId } = req.params;
  const sock = activeSockets.get(channelId);
  if (sock) {
    try { await sock.logout(); } catch (e) {}
  }
  res.json({ ok: true, message: 'Disconnection initiated.' });
});

app.post('/v1/channels/:channelId/resetSession', async (req, res) => {
  const { channelId } = req.params;
  const sock = activeSockets.get(channelId);
  if (sock) {
    try { await sock.logout(); } catch (e) {}
  }

  activeSockets.delete(channelId);
  startingChannels.delete(channelId);
  retryCounts.delete(channelId);
  channelConnState.delete(channelId);

  await resetFirestoreAuthState(channelId);
  await releaseChannelLock(channelId);

  await upsertChannelStatus(channelId, {
    status: 'DISCONNECTED',
    linked: false,
    qr: emptyQrObject(),
    qrDataUrl: null,
    phoneE164: null,
    lastError: null,
    me: null,
    connectedAt: null,
  });

  res.json({ ok: true, message: 'Session reset successfully.' });
});

// --- MESSAGING API ---
app.get('/v1/channels/:channelId/conversations', async (req, res) => {
  try {
    const { channelId } = req.params;
    const limitNum = Math.min(parseInt(req.query.limit || '30', 10), 100);

    const snap = await db.collection('channels').doc(channelId)
      .collection('conversations')
      .orderBy('lastMessageAt', 'desc')
      .limit(limitNum)
      .get();

    res.json({ ok: true, conversations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/v1/channels/:channelId/conversations/:jid/messages', async (req, res) => {
  try {
    const { channelId, jid: jidParam } = req.params;
    const jid = decodeURIComponent(jidParam);
    const limitNum = Math.min(parseInt(req.query.limit || '50', 10), 200);

    const snap = await db.collection('channels').doc(channelId)
      .collection('conversations').doc(jid)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(limitNum)
      .get();

    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    res.json({ ok: true, jid, messages: msgs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/v1/channels/:channelId/messages/send', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false, error: '`to` and `text` required' });

    const sock = await ensureSocketReady(channelId, 25000);
    if (!sock) return res.status(409).json({ ok: false, error: 'Socket not ready' });

    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const r = await sock.sendMessage(jid, { text });

    const messageId = r?.key?.id || `${Date.now()}`;
    await saveMessageToFirestore(channelId, jid, messageId, {
      messageId,
      jid,
      fromMe: true,
      direction: 'OUT',
      text,
      status: 'sent',
      timestamp: Date.now(),
      raw: null,
    });

    res.json({ ok: true, messageId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/v1/channels/:channelId/conversations/:jid/markRead', async (req, res) => {
  try {
    const { channelId, jid: jidParam } = req.params;
    const jid = decodeURIComponent(jidParam);
    await db.collection('channels').doc(channelId).collection('conversations').doc(jid)
      .set({ unreadCount: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- AUTO-START linked channels ---
async function bootStartLinkedChannels() {
  try {
    const snap = await db.collection('channels').where('linked', '==', true).get();
    const docs = snap.docs;
    if (docs.length) logger.info({ count: docs.length }, 'Boot: starting linked channels');
    
    for (const docSnap of docs) {
      const status = docSnap.data().status;
      if (['CONNECTED', 'DISCONNECTED'].includes(status)) {
        await startOrRestartBaileys(docSnap.id, 'boot-linked');
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (e) {
    logger.error({ err: e.message }, 'Boot failed');
  }
}

// --- SERVER LISTEN ---
app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'HTTP server listening');
  await bootStartLinkedChannels();
});
