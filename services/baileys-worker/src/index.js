
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const path = require('path');
const cors = require('cors');

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection', reason);
});

initializeApp();
console.log('[BOOT] baileys-worker starting...', new Date().toISOString());
const db = getFirestore();
const channelDocRef = db.collection('channels').doc('default');

const logger = pino({ level: process.env.LOG_LEVEL || 'debug' });
logger.info({ service: 'baileys-worker', version: '1' }, 'Booting service');

const app = express();

// --- CORS (manual, infalible para browsers) ---
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Si viene origin, lo reflejamos; si no, permitimos cualquiera (curl/server-to-server)
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }
  next();
});

app.use(express.json());

const PORT = process.env.PORT || 8080;

let sock = null;
let starting = false;

async function safeSet(data) {
  try {
    await channelDocRef.set(data, { merge: true });
  } catch (e) {
    logger.error(e, 'Failed writing to Firestore');
  }
}

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.get('/debug', (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    version: 'debug-1',
    hasSock: !!sock,
    starting,
    node: process.version
  });
});

app.get('/v1/channels/default/status', async (_req, res) => {
  try {
    const snap = await channelDocRef.get();
    res.json(snap.exists ? snap.data() : null);
  } catch (e) {
     logger.error(e, 'Failed to get status');
     res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/v1/channels/default/qr', async (_req, res) => {
  logger.info('Received API request to generate QR code.');
  await startOrRestartBaileys('api-qr');
  res.json({ ok: true, message: 'QR generation process started.' });
});

app.post('/v1/channels/default/disconnect', async (_req, res) => {
  logger.info('Received API request to disconnect.');
  if (sock) {
    try { await sock.logout(); } catch (e) { logger.warn(e, 'logout failed'); }
    try { sock.end?.(); } catch (_) {}
    sock = null;
  }
  starting = false;
  await safeSet({ status:'DISCONNECTED', qr:null, qrDataUrl:null, updatedAt: FieldValue.serverTimestamp() });
  res.json({ ok: true, message: 'Disconnection process initiated.' });
});

console.log('[BOOT] about to listen on PORT=', PORT);
app.listen(PORT, () => {
  console.log('[BOOT] HTTP server listening on', PORT);
  logger.info({ port: PORT }, 'HTTP server listening');
  startOrRestartBaileys('boot');
});

async function startOrRestartBaileys(reason = 'manual') {
  console.log('[BAILEYS] startOrRestartBaileys reason=', reason, 'time=', new Date().toISOString());

  if (sock) {
    console.log('[BAILEYS] socket already exists, skipping new start');
    starting = false;
    return;
  }

  if (starting) {
    logger.info({ reason }, 'Baileys already starting, skipping');
    return;
  }
  starting = true;

  logger.info({ reason }, 'Starting Baileys...');
  await safeSet({
    status: 'CONNECTING',
    qr: null,
    qrDataUrl: null,
    lastError: null,
    updatedAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
  });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join('/tmp', 'baileys_auth_info'));

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
      defaultQueryTimeoutMs: 60_000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      console.log('[BAILEYS] connection.update keys=', Object.keys(update || {}), 'connection=', update?.connection, 'hasQR=', !!update?.qr);
      
      if (update?.lastDisconnect?.error) {
        const err = update.lastDisconnect.error;
        const msg = err?.message || String(err);
        const name = err?.name || 'UnknownError';
        const statusCode = err?.output?.statusCode || err?.output?.payload?.statusCode;
        const data = err?.data;
      
        console.log('[BAILEYS] lastDisconnect.error name=', name, 'statusCode=', statusCode, 'message=', msg);
        try {
          console.log('[BAILEYS] lastDisconnect.error raw=', JSON.stringify(err, Object.getOwnPropertyNames(err)));
        } catch (_) {
          console.log('[BAILEYS] lastDisconnect.error raw (string)=', String(err));
        }
      
        await safeSet({
          lastError: `DISCONNECT: ${name} ${statusCode || ''} ${msg}`.trim(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      
      logger.info({ update }, 'connection.update');

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR received from Baileys');
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await safeSet({
            status: 'CONNECTING',
            qr,
            qrDataUrl,
            updatedAt: FieldValue.serverTimestamp(),
            lastSeenAt: FieldValue.serverTimestamp(),
          });
        } catch (err) {
          logger.error(err, 'Failed to generate/save QR');
          await safeSet({
            lastError: `QR_SAVE_ERROR: ${String(err?.message || err)}`,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      if (connection === 'close') {
        console.log('[BAILEYS] connection closed - lastDisconnect=', !!lastDisconnect, 'hasError=', !!lastDisconnect?.error);
        try {
            console.log('[BAILEYS] lastDisconnect full =', JSON.stringify(lastDisconnect, Object.getOwnPropertyNames(lastDisconnect || {})));
        } catch (e) {
            console.log('[BAILEYS] lastDisconnect full (string)=', String(lastDisconnect));
        }

        sock = null;
        const code = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output?.statusCode
          : undefined;

        logger.warn({ code }, 'Connection closed');

        await safeSet({
          status: 'DISCONNECTED',
          qr: null,
          qrDataUrl: null,
          updatedAt: FieldValue.serverTimestamp(),
          lastError: `CLOSE: ${String(lastDisconnect?.error?.message || lastDisconnect?.error || 'no-error')}`,
        });

        const shouldReconnect = code !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          starting = false;
          await new Promise(r => setTimeout(r, 3000));
          startOrRestartBaileys('auto-reconnect');
        }
      }

      if (connection === 'open') {
        logger.info('Connection opened!');
        const phoneId = sock?.user?.id?.split(':')?.[0] || null;

        await safeSet({
          status: 'CONNECTED',
          qr: null,
          qrDataUrl: null,
          phoneE164: phoneId ? `+${phoneId}` : null,
          lastError: null,
          updatedAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
        });
      }
    });

    starting = false;
    logger.info('Baileys socket created');
  } catch (err) {
    starting = false;
    logger.error(err, 'Baileys failed to start');
    await safeSet({
      status: 'DISCONNECTED',
      qr: null,
      qrDataUrl: null,
      lastError: `START_ERROR: ${String(err?.message || err)}`,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}
