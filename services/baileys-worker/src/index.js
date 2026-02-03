
const { default: makeWASocket, DisconnectReason, Browsers, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const cors = require('cors');
const dns = require('dns');
const WebSocket = require('ws');
const { version: baileysVersion } = require('@whiskeysockets/baileys/package.json');

// --- BOOT ---
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection', reason);
});

// Force IPv4 first to avoid IPv6 WSS handshake issues
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

console.log('[BOOT] baileys-worker starting...', {
  revision: process.env.K_REVISION || 'unknown',
  timestamp: new Date().toISOString()
});

// --- FIREBASE ADMIN ---
initializeApp();
const db = getFirestore();

const logger = pino({ level: process.env.LOG_LEVEL || 'debug' });
logger.info({
  service: 'baileys-worker',
  version: 'firestore-auth-multi-channel',
  baileysVersion,
  revision: process.env.K_REVISION || 'unknown',
}, 'Booting service');

// --- GLOBAL STATE ---
const activeSockets = new Map();      // <channelId, WASocket>
const startingChannels = new Set();   // <channelId> is being started
const retryCounts = new Map();        // <channelId, number>

// --- FIRESTORE AUTH STATE (FIXED: initAuthCreds + BufferJSON) ---
const useFirestoreAuthState = async (channelId) => {
  const authCollection = db.collection('channels').doc(channelId).collection('auth');

  const sanitizeId = (id) => id.replace(/\//g, '__');

  const writeData = async (data, id) => {
    const docRef = authCollection.doc(sanitizeId(id));
    // IMPORTANT: serialize with BufferJSON to preserve Buffers/Keys
    const json = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    await docRef.set(json);
  };

  const readData = async (id) => {
    const docRef = authCollection.doc(sanitizeId(id));
    const docSnap = await docRef.get();
    if (!docSnap.exists) return null;

    // IMPORTANT: revive with BufferJSON to restore Buffers
    const data = docSnap.data();
    return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
  };

  const removeData = async (id) => {
    const docRef = authCollection.doc(sanitizeId(id));
    await docRef.delete();
  };

  // ✅ CRITICAL FIX:
  // If creds don't exist yet, must use initAuthCreds() (NOT {})
  const storedCreds = await readData('creds');
  const creds = storedCreds || initAuthCreds();

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
    // ✅ IMPORTANT: write the *current* creds (mutated by Baileys), not a stale ref
    saveCreds: async () => writeData(state.creds, 'creds'),
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

// --- HELPERS ---
async function upsertChannelStatus(channelId, patch) {
  const ref = db.collection('channels').doc(channelId);
  return ref.set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function serializeError(err, extras = {}) {
  if (!err) return { message: 'Unknown error', ...extras };
  return {
    message: String(err.message || err),
    name: err.name,
    code: err.code,
    stack: err.stack,
    ...extras,
    ts: new Date().toISOString(),
  };
}

// --- BAILEYS CORE ---
const MAX_RETRY = 5;
const RETRY_DELAY_MS = [2000, 5000, 10000, 20000, 60000];

async function startOrRestartBaileys(channelId) {
  if (startingChannels.has(channelId)) {
    logger.info({ channelId }, 'Baileys already starting, skipping');
    return;
  }
  startingChannels.add(channelId);

  logger.info({ channelId }, 'Starting Baileys...');
  await upsertChannelStatus(channelId, {
    status: 'CONNECTING',
    qr: { raw: null, public: null },
    qrDataUrl: null,
    lastError: null,
    linked: false,
  });

  try {
    if (activeSockets.has(channelId)) {
      logger.info({ channelId }, 'Found existing socket, logging out before restart.');
      try {
        await activeSockets.get(channelId).logout();
      } catch (e) {
        logger.warn({ channelId, error: e }, 'Existing socket logout failed, proceeding.');
      } finally {
        activeSockets.delete(channelId);
      }
    }

    const { state, saveCreds } = await useFirestoreAuthState(channelId);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
      defaultQueryTimeoutMs: 60_000,
    });

    activeSockets.set(channelId, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update || {};
      logger.info({ channelId, connection, hasQrBoolean: !!qr, qrLen: qr?.length || 0 }, 'connection.update');

      // --- QR ---
      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await upsertChannelStatus(channelId, {
            status: 'QR',
            qr: { raw: qr, public: qrDataUrl },
            qrDataUrl,
            lastQrAt: FieldValue.serverTimestamp(),
          });
          logger.info({ channelId, len: qr.length }, 'QR saved to Firestore');
        } catch (e) {
          logger.error({ channelId, err: e }, 'Failed to save QR code.');
          await upsertChannelStatus(channelId, { lastError: serializeError(e, { where: 'connection.update:qr', channelId }) });
        }
      }

      // --- OPEN ---
      if (connection === 'open') {
        retryCounts.set(channelId, 0);
        const phoneId = sock?.user?.id?.split(':')?.[0] || null;

        await upsertChannelStatus(channelId, {
          status: 'CONNECTED',
          linked: true,
          qr: { raw: null, public: null },
          qrDataUrl: null,
          lastError: null,
          phoneE164: phoneId ? `+${phoneId}` : null,
          me: sock?.user || null,
          connectedAt: FieldValue.serverTimestamp(),
        });

        logger.info({ channelId, jid: sock.user?.id }, 'Connection opened');
      }

      // --- CLOSE ---
      if (connection === 'close') {
        const err = lastDisconnect?.error;
        const statusCode = err instanceof Boom ? err.output.statusCode : 500;
        const msg = String(err?.message || '');
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
        logger.warn({ channelId, statusCode, shouldReconnect, message: msg }, 'Connection closed');
      
        // limpiar socket activo siempre
        activeSockets.delete(channelId);
      
        // Clasificar causas típicas
        const isQrAttemptsEnded =
          statusCode === 408 && msg.toLowerCase().includes('qr') && msg.toLowerCase().includes('attempts');
      
        const isUnsupportedState =
          msg.toLowerCase().includes('unsupported state') ||
          msg.toLowerCase().includes('authenticate data');
      
        const isTerminated428 =
          statusCode === 428 || msg.toLowerCase().includes('connection terminated');
      
        // 1) QR se agotó: NO reconectar en loop; esperar acción del usuario
        if (isQrAttemptsEnded) {
          logger.warn({ channelId, statusCode, msg }, 'QR attempts ended -> stopping auto-reconnect, clearing auth');
          await resetFirestoreAuthState(channelId);
      
          await upsertChannelStatus(channelId, {
            status: 'QR_EXPIRED',
            linked: false,
            qr: { raw: null, public: null },
            qrDataUrl: null,
            lastError: { message: msg, statusCode },
          });
      
          return; // CLAVE: cortar aquí, NO auto-reconnect
        }
      
        // 2) Auth corrupto / terminated: limpiar auth y parar
        if (isUnsupportedState || isTerminated428) {
          logger.warn({ channelId, statusCode, msg }, 'Auth/termination issue -> clearing auth and stopping auto-reconnect');
          await resetFirestoreAuthState(channelId);
      
          await upsertChannelStatus(channelId, {
            status: 'ERROR',
            linked: false,
            qr: { raw: null, public: null },
            qrDataUrl: null,
            lastError: { message: msg, statusCode },
          });
      
          return; // CLAVE: cortar aquí, NO auto-reconnect
        }
      
        // Estado normal de disconnected
        await upsertChannelStatus(channelId, {
          status: 'DISCONNECTED',
          linked: false,
          qr: { raw: null, public: null },
          qrDataUrl: null,
          lastError: err ? {
            message: err.message,
            stack: err.stack,
            statusCode,
          } : null,
        });
      
        // 3) Si fue loggedOut, limpiar auth y parar
        if (!shouldReconnect) {
          logger.info({ channelId }, 'Not reconnecting (logged out). Clearing auth state.');
          await resetFirestoreAuthState(channelId);
          return;
        }
      
        // 4) Reconexión controlada (solo cierres “normales”)
        let currentRetry = retryCounts.get(channelId) || 0;
        if (currentRetry < MAX_RETRY) {
          const delay = (RETRY_DELAY_MS[currentRetry] || 60000) + Math.floor(Math.random() * 1000);
          retryCounts.set(channelId, currentRetry + 1);
      
          logger.info({ channelId, delay, attempt: currentRetry + 1 }, 'Reconnecting (scheduled)...');
          setTimeout(() => startOrRestartBaileys(channelId), delay);
        } else {
          logger.error({ channelId }, 'Max retries reached.');
          await upsertChannelStatus(channelId, {
            status: 'ERROR',
            lastError: { message: 'Max retries reached.' }
          });
        }
      }
    });

  } catch (err) {
    logger.error({ channelId, error: err?.stack || err }, 'Baileys failed to start for channel');
    await upsertChannelStatus(channelId, {
      status: 'ERROR',
      lastError: serializeError(err, { where: 'startOrRestartBaileys', channelId, tag: 'START_ERROR' }),
    });
  } finally {
    startingChannels.delete(channelId);
  }
}

// --- EXPRESS APP ---
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 8080;

// --- DEBUG ENDPOINTS ---
app.get('/health', (_req, res) => res.status(200).send('ok'));

app.get('/debug/config', (_req, res) => {
  res.json({
    ok: true,
    env: {
      PORT: process.env.PORT,
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      LOG_LEVEL: process.env.LOG_LEVEL,
    },
    baileysVersion,
    authStateLocation: `firestore:channels/{channelId}/auth`,
    timestamp: new Date().toISOString(),
  });
});

app.get('/debug/baileys', (_req, res) => {
  const socketsInfo = Array.from(activeSockets.keys()).map(channelId => ({
    channelId,
    user: activeSockets.get(channelId)?.user,
    state: activeSockets.get(channelId)?.ws?.readyState,
  }));

  res.json({
    ok: true,
    baileysVersion,
    activeSocketsCount: activeSockets.size,
    socketsInfo,
    startingChannels: Array.from(startingChannels),
  });
});

app.get('/debug/net', async (_req, res) => {
  const out = { ok: true, ts: new Date().toISOString(), checks: {} };

  try {
    out.checks.dns_web_whatsapp = await dns.promises.lookup('web.whatsapp.com', { all: true });
  } catch (e) {
    out.ok = false;
    out.checks.dns_web_whatsapp_error = String(e?.message || e);
  }

  try {
    const r = await fetch('https://web.whatsapp.com', { method: 'GET' });
    out.checks.https_web_whatsapp_status = r.status;
  } catch (e) {
    out.ok = false;
    out.checks.https_web_whatsapp_error = String(e?.message || e);
  }

  res.status(out.ok ? 200 : 500).json(out);
});

app.get('/debug/ws', async (_req, res) => {
  const ts = new Date().toISOString();
  try {
    const ws = new WebSocket('wss://web.whatsapp.com/ws/chat', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const timeout = setTimeout(() => {
      try { ws.terminate(); } catch {}
      return res.status(200).json({ ok: false, ts, error: 'timeout' });
    }, 8000);

    ws.on('open', () => {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      return res.status(200).json({ ok: true, ts });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      try { ws.terminate(); } catch {}
      return res.status(200).json({ ok: false, ts, error: String(err?.message || err) });
    });
  } catch (e) {
    return res.status(200).json({ ok: false, ts, error: String(e?.message || e) });
  }
});

// --- API V1 ENDPOINTS ---
app.get('/v1/channels', async (_req, res) => {
  try {
    const snapshot = await db.collection('channels').get();
    const channels = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(channels);
  } catch (e) {
    logger.error({ error: e }, 'Failed to list channels');
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
    logger.error({ error: e }, 'Failed to create channel');
    res.status(500).json({ ok: false, error: 'Failed to create channel' });
  }
});

app.get('/v1/channels/:channelId/status', async (req, res) => {
  try {
    const { channelId } = req.params;
    const snap = await db.collection('channels').doc(channelId).get();
    if (!snap.exists) return res.json(null);

    const data = snap.data() || {};

    // Normalización defensiva: NUNCA devolver qr null/undefined
    const qrDataUrl = data.qrDataUrl ?? null;

    let raw = null;
    if (typeof data.qr === 'string') raw = data.qr;
    if (data.qr && typeof data.qr === 'object') raw = data.qr.raw ?? null;

    const normalized = {
      id: snap.id,
      ...data,
      qr: {
        raw,
        public: (data.qr && typeof data.qr === 'object' && 'public' in data.qr) ? (data.qr.public ?? qrDataUrl) : qrDataUrl,
      },
      // Campo extra por compatibilidad si el front lo usa de otra forma:
      imageSource: { public: qrDataUrl },
    };

    return res.json(normalized);
  } catch (e) {
    logger.error(e, 'Failed to get status for channel', req.params.channelId);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/v1/channels/:channelId/qr', async (req, res) => {
  const { channelId } = req.params;
  try {
    logger.info({ channelId }, 'Received API request to generate QR code');

    const sock = activeSockets.get(channelId);
    const isStarting = startingChannels.has(channelId);

    if (sock || isStarting) {
      logger.warn({ channelId, hasSock: !!sock, isStarting }, 'QR requested but process already active (no-op)');
      const snap = await db.collection('channels').doc(channelId).get();
      return res.status(200).json({
        ok: true,
        message: 'Process already active',
        status: snap.exists ? snap.data() : null
      });
    }

    startOrRestartBaileys(channelId);
    return res.json({ ok: true, message: 'QR generation process started.' });
  } catch (e) {
    logger.error({ error: e?.stack || e, channelId }, 'Failed to handle QR request');
    await upsertChannelStatus(channelId, {
      status: 'ERROR',
      lastError: serializeError(e, { where: '/v1/channels/:id/qr' })
    });
    res.status(500).json({ ok: false, error: 'Failed to request QR generation' });
  }
});

app.post('/v1/channels/:channelId/disconnect', async (req, res) => {
  const { channelId } = req.params;
  logger.info({ channelId }, 'Received API request to disconnect');

  const sock = activeSockets.get(channelId);
  if (sock) {
    try { await sock.logout(); } catch (e) { logger.warn({ error: e }, 'logout failed'); }
  }

  res.json({ ok: true, message: 'Disconnection process initiated.' });
});

app.post('/v1/channels/:channelId/resetSession', async (req, res) => {
  const { channelId } = req.params;
  logger.info({ channelId }, 'Received API request to reset session');

  const sock = activeSockets.get(channelId);
  if (sock) {
    try { await sock.logout(); } catch (e) { logger.warn({ error: e }, 'logout during reset failed'); }
  }

  activeSockets.delete(channelId);
  startingChannels.delete(channelId);
  retryCounts.delete(channelId);

  await resetFirestoreAuthState(channelId);

  await upsertChannelStatus(channelId, {
    status: 'DISCONNECTED',
    linked: false,
    qr: { raw: null, public: null },
    qrDataUrl: null,
    phoneE164: null,
    lastError: null,
    lastQrAt: null,
    me: null,
    connectedAt: null,
  });

  res.json({ ok: true, message: 'Session reset successfully.' });
});

// --- SERVER LISTEN ---
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'HTTP server listening');
});
