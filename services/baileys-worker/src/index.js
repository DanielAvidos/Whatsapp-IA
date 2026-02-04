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

// Force IPv4 first to avoid IPv6 WSS handshake issues
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
logger.info(
  {
    service: 'baileys-worker',
    version: 'firestore-auth-multi-channel-messaging',
    baileysVersionFromPkg,
    revision: process.env.K_REVISION || 'unknown',
  },
  'Booting service'
);

// --- GLOBAL STATE ---
const activeSockets = new Map();      // <channelId, WASocket>
const startingChannels = new Set();   // <channelId> is being started
const retryCounts = new Map();        // <channelId, number>
const startPromises = new Map();      // <channelId, Promise<void>>
const channelConnState = new Map();   // <channelId, { connected: boolean, lastSeenAt: number }>

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
  if (typeof message === 'string') return message;
  const text = message.conversation || 
               message.extendedTextMessage?.text || 
               message.imageMessage?.caption || 
               message.videoMessage?.caption || 
               null;
  return text;
}

// --- FIRESTORE AUTH STATE (BufferJSON + initAuthCreds) ---
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
      logger.warn({ channelId, id, error: String(e?.message || e) }, 'Failed to parse auth blob');
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

  // message
  await msgRef.set({
    ...doc,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // conversation upsert
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
    logger.info({ channelId, reason }, 'Baileys already starting, skipping');
    return;
  }
  startingChannels.add(channelId);

  logger.info({ channelId, reason }, 'Starting Baileys...');
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
      logger.info({ channelId, latest }, 'Fetched latest Baileys version');
    } catch (e) {
      logger.warn({ channelId, error: String(e?.message || e) }, 'Could not fetch latest Baileys version, using default');
    }

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
      saveCreds().catch((e) => {
        logger.warn({ channelId, error: String(e?.message || e) }, 'saveCreds failed');
      });
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update || {};
      logger.info({ channelId, connection, hasQr: !!qr }, 'connection.update');

      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await upsertChannelStatus(channelId, {
            status: 'QR',
            qr: { raw: qr, public: qr },
            qrDataUrl,
            lastQrAt: FieldValue.serverTimestamp(),
            lastError: null,
          });
          logger.info({ channelId, len: qr.length }, 'QR saved to Firestore');
        } catch (e) {
          logger.error({ channelId, error: String(e?.message || e) }, 'Failed to build/save QR');
          await upsertChannelStatus(channelId, {
            lastError: { message: `QR_SAVE_ERROR: ${String(e?.message || e)}` },
          });
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
        logger.info({ channelId, jid: sock.user?.id }, 'Connection opened');
      }

      if (connection === 'close') {
        channelConnState.set(channelId, { connected: false, lastSeenAt: Date.now() });
        const err = lastDisconnect?.error;
        const statusCode = err instanceof Boom ? err.output.statusCode : 500;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(
          { channelId, statusCode, shouldReconnect, error: String(err?.message || err) },
          'Connection closed'
        );

        await upsertChannelStatus(channelId, {
          status: 'DISCONNECTED',
          linked: false,
          qr: emptyQrObject(),
          qrDataUrl: null,
          lastError: err
            ? { message: String(err.message || err), stack: err.stack || null, statusCode }
            : null,
          lastSeenAt: FieldValue.serverTimestamp(),
        });

        activeSockets.delete(channelId);

        if (shouldReconnect) {
          let currentRetry = retryCounts.get(channelId) || 0;
          if (currentRetry < MAX_RETRY) {
            const delay = RETRY_DELAY_MS[currentRetry] + Math.floor(Math.random() * 1000);
            logger.info({ channelId, delay, attempt: currentRetry + 1 }, 'Reconnecting...');
            await new Promise((r) => setTimeout(r, delay));
            retryCounts.set(channelId, currentRetry + 1);
            startOrRestartBaileys(channelId, 'auto-reconnect');
          } else {
            logger.error({ channelId }, 'Max retries reached.');
            await upsertChannelStatus(channelId, {
              status: 'ERROR',
              lastError: { message: 'Max retries reached.' },
            });
          }
        } else {
          logger.info({ channelId }, 'Not reconnecting (loggedOut). Clearing auth state.');
          await resetFirestoreAuthState(channelId);
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
        logger.error({ channelId, err: String(e?.message || e) }, 'messages.upsert handler failed');
      }
    });

    return sock;
  } catch (err) {
    logger.error({ channelId, error: String(err?.message || err), stack: err?.stack }, 'START_ERROR');
    await upsertChannelStatus(channelId, {
      status: 'ERROR',
      qr: emptyQrObject(),
      qrDataUrl: null,
      lastError: { message: `START_ERROR: ${String(err?.message || err)}`, stack: err?.stack || null, statusCode: 500 },
    });
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
    logger.error(e, 'Failed to list channels');
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
      await channelRef.set(channelData);
    } else {
      channelRef = await db.collection('channels').add(channelData);
    }

    res.status(201).json({ id: channelRef.id, ...channelData });
  } catch (e) {
    logger.error(e, 'Failed to create channel');
    res.status(500).json({ ok: false, error: 'Failed to create channel' });
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
    logger.error(e, 'Failed to get status for channel', req.params.channelId);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/v1/channels/:channelId/qr', async (req, res) => {
  const { channelId } = req.params;
  logger.info({ channelId }, 'API request: generate QR');

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

app.post('/v1/channels/:channelId/disconnect', async (req, res) => {
  const { channelId } = req.params;
  logger.info({ channelId }, 'API request: disconnect');
  const sock = activeSockets.get(channelId);
  if (sock) {
    try {
      await sock.logout();
    } catch (e) {
      logger.warn({ channelId, error: String(e?.message || e) }, 'logout failed');
    }
  }
  res.json({ ok: true, message: 'Disconnection process initiated.' });
});

app.post('/v1/channels/:channelId/resetSession', async (req, res) => {
  const { channelId } = req.params;
  logger.info({ channelId }, 'API request: resetSession');

  const sock = activeSockets.get(channelId);
  if (sock) {
    try {
      await sock.logout();
    } catch (e) {
      logger.warn({ channelId, error: String(e?.message || e) }, 'logout during reset failed');
    }
  }

  activeSockets.delete(channelId);
  startingChannels.delete(channelId);
  retryCounts.delete(channelId);
  channelConnState.delete(channelId);

  await resetFirestoreAuthState(channelId);

  await upsertChannelStatus(channelId, {
    status: 'DISCONNECTED',
    linked: false,
    qr: emptyQrObject(),
    qrDataUrl: null,
    phoneE164: null,
    lastError: null,
    lastQrAt: null,
    me: null,
    connectedAt: null,
  });

  res.json({ ok: true, message: 'Session reset successfully.' });
});

// --- MESSAGING API ---
app.get('/v1/channels/:channelId/conversations', async (req, res) => {
  try {
    const { channelId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);

    const snap = await db.collection('channels').doc(channelId)
      .collection('conversations')
      .orderBy('lastMessageAt', 'desc')
      .limit(limit)
      .get();

    res.json({ ok: true, conversations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/v1/channels/:channelId/conversations/:jid/messages', async (req, res) => {
  try {
    const { channelId, jid: jidParam } = req.params;
    const jid = decodeURIComponent(jidParam);
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    const snap = await db.collection('channels').doc(channelId)
      .collection('conversations').doc(jid)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    res.json({ ok: true, jid, messages: msgs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/v1/channels/:channelId/messages/send', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false, error: '`to` and `text` required' });

    const sock = await ensureSocketReady(channelId, 25000);
    if (!sock) return res.status(409).json({ ok: false, error: 'Socket not ready for this channel' });

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
    res.status(500).json({ ok: false, error: String(e?.message || e) });
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
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- AUTO-START linked channels on boot ---
async function bootStartLinkedChannels() {
  try {
    const snap = await db.collection('channels').where('linked', '==', true).get();
    const ids = snap.docs.map(d => d.id);
    if (ids.length) logger.info({ ids }, 'Boot: starting linked channels');
    ids.forEach(id => startOrRestartBaileys(id, 'boot-linked'));
  } catch (e) {
    logger.error({ err: String(e?.message || e) }, 'Boot start linked channels failed');
  }
}

// --- SERVER LISTEN ---
app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'HTTP server listening');
  await bootStartLinkedChannels();
});