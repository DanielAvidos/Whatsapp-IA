
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection', reason);
});

// Force IPv4 first to avoid IPv6 WSS handshake issues in some cloud environments
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

console.log('[BOOT] baileys-worker starting...', new Date().toISOString());
initializeApp();
const db = getFirestore();
const channelDocRef = db.collection('channels').doc('default');

const logger = pino({ level: process.env.LOG_LEVEL || 'debug' });
const { version: baileysVersion } = require('@whiskeysockets/baileys/package.json');
logger.info({ service: 'baileys-worker', version: '1', authStateLocation: 'filesystem:/tmp/baileys_auth_info', baileysVersion }, 'Booting service');

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
let lastDisconnectError = null;
let lastConnectionState = {};

async function upsertChannelStatus(channelId, patch) {
    const ref = db.collection('channels').doc(channelId);
    await ref.set({
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
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

app.get('/debug/net', async (req, res) => {
  const dnsPromises = require('dns').promises;
  const out = { ok: true, ts: new Date().toISOString(), checks: {} };

  try {
    out.checks.dns_web_whatsapp = await dnsPromises.lookup('web.whatsapp.com', { all: true });
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

  console.log('[DEBUG_NET]', JSON.stringify(out));
  res.status(out.ok ? 200 : 500).json(out);
});

app.get('/debug/ws', async (req, res) => {
  const ts = new Date().toISOString();
  try {
    const WebSocket = require('ws');
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
      return res.status(200).json({ ok: false, ts, error: String(err && err.message ? err.message : err) });
    });
  } catch (e) {
    return res.status(200).json({ ok: false, ts, error: String(e && e.message ? e.message : e) });
  }
});

app.get('/debug/baileys', (req, res) => {
    const q = global.__LAST_QR__ || null;
    res.json({
      ok: true,
      baileysVersion,
      nodeVersion: process.version,
      hasSock: !!sock,
      lastConnectionState,
      authStateBackend: 'filesystem',
      authStatePathOrRef: path.join('/tmp', 'baileys_auth_info'),
      hasLastQr: !!q,
      lastQrAt: q?.at || null,
      lastDisconnect: lastDisconnectError,
    });
});

app.get('/debug/config', (req, res) => {
    res.json({
        ok: true,
        env: {
            PORT: process.env.PORT,
            NODE_OPTIONS: process.env.NODE_OPTIONS,
            LOG_LEVEL: process.env.LOG_LEVEL,
        },
        baileysVersion: baileysVersion,
        authStateLocation: `filesystem:${path.join('/tmp', 'baileys_auth_info')}`,
        timestamp: new Date().toISOString(),
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
  startOrRestartBaileys('api-qr');
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
  await upsertChannelStatus('default', { status:'DISCONNECTED', qr:null, qrDataUrl:null });
  res.json({ ok: true, message: 'Disconnection process initiated.' });
});

app.post('/v1/channels/default/resetSession', async (_req, res) => {
    logger.info('Received API request to reset session.');
    if (sock) {
        try { await sock.logout(); } catch (e) { logger.warn(e, 'logout during reset failed'); }
        try { sock.end?.(); } catch (_) {}
        sock = null;
    }
    starting = false;

    const authPath = path.join('/tmp', 'baileys_auth_info');
    if (fs.existsSync(authPath)) {
        try {
            fs.rmSync(authPath, { recursive: true, force: true });
            logger.info('Auth info deleted from filesystem.');
        } catch (e) {
            logger.error(e, 'Failed to delete auth info directory.');
        }
    }

    await upsertChannelStatus('default', {
        status:'DISCONNECTED',
        qr:null,
        qrDataUrl:null,
        phoneE164: null,
        lastError: null,
        lastQrAt: null
    });
    res.json({ ok: true, message: 'Session reset successfully.' });
});

console.log('[BOOT] about to listen on PORT=', PORT);
app.listen(PORT, () => {
  console.log('[BOOT] HTTP server listening on', PORT);
  logger.info({ port: PORT }, 'HTTP server listening');
  startOrRestartBaileys('boot');
});

let retryCount = 0;
const MAX_RETRY = 5;
const RETRY_DELAY_MS = [2000, 5000, 10000, 20000, 60000];

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
  await upsertChannelStatus('default', {
    status: 'CONNECTING',
    qr: null,
    qrDataUrl: null,
    lastError: null,
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
        const { connection, lastDisconnect, qr } = update || {};
        const err = lastDisconnect?.error;

        lastConnectionState = {
            connection,
            hasQrBoolean: !!qr && typeof qr === 'string',
            qrLen: qr?.length || 0,
            lastDisconnectStatusCode: err?.output?.statusCode,
            lastDisconnectMessage: err?.message,
            ts: new Date().toISOString(),
        };

        console.log('[BAILEYS] connection.update', lastConnectionState);

        if (qr && typeof qr === 'string' && qr.length > 20) {
          try {
            const qrDataUrl = await qrcode.toDataURL(qr);
            global.__LAST_QR__ = { qr, qrDataUrl, at: Date.now() };

            await upsertChannelStatus('default', {
              status: 'QR',
              qr,
              qrDataUrl,
              phoneE164: null,
              lastError: null,
              lastQrAt: FieldValue.serverTimestamp(),
            });
            console.log('[BAILEYS] QR saved to Firestore', { len: qr.length });
          } catch (e) {
            console.error('[BAILEYS] Failed to save QR', e);
            await upsertChannelStatus('default', {
              lastError: { message: `QR_SAVE_ERROR: ${String(e?.message || e)}`, ts: new Date().toISOString() },
              status: 'ERROR'
            });
          }
        }
      
        if (connection === 'open') {
          retryCount = 0; // Reset retry counter on successful connection
          try {
            const phoneId = sock?.user?.id?.split(':')?.[0] || null;
            await upsertChannelStatus('default', {
              status: 'CONNECTED',
              qr: null,
              qrDataUrl: null,
              lastError: null,
              phoneE164: phoneId ? `+${phoneId}` : null,
            });
            console.log('[BAILEYS] CONNECTED');
          } catch (e) {
            console.error('[BAILEYS] failed to persist CONNECTED', e);
          }
        }
      
        if (connection === 'close') {
          lastDisconnectError = err ? {
              message: err?.message,
              name: err?.name,
              statusCode: err?.output?.statusCode,
              stack: err?.stack,
              ts: new Date().toISOString()
          } : null;

          if (err) {
            console.log('[BAILEYS] lastDisconnect.error name=', err.name, 'statusCode=', err?.output?.statusCode, 'message=', err.message);
          }

          const shouldReconnect = err ? (err instanceof Boom ? err.output.statusCode !== DisconnectReason.loggedOut : true) : true;

          await upsertChannelStatus('default', {
            status: 'DISCONNECTED',
            qr: null,
            qrDataUrl: null,
            lastError: lastDisconnectError,
          });
          console.log('[BAILEYS] DISCONNECTED persisted');

          sock = null;
          starting = false;
          
          if (shouldReconnect) {
            if (retryCount < MAX_RETRY) {
              const delay = RETRY_DELAY_MS[retryCount];
              logger.info(`Will attempt to reconnect in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRY})`);
              await new Promise(r => setTimeout(r, delay));
              retryCount++;
              startOrRestartBaileys('auto-reconnect');
            } else {
              logger.error('Max retries reached. Not attempting to reconnect further.');
              await upsertChannelStatus('default', {
                  lastError: { message: 'Max retries reached.', ts: new Date().toISOString() }
              });
            }
          } else {
             logger.info('Not reconnecting, reason: logged out.');
             retryCount = 0; // Reset on clean logout
          }
        }
      });

    starting = false;
    logger.info('Baileys socket created');
  } catch (err) {
    starting = false;
    logger.error(err, 'Baileys failed to start');
    await upsertChannelStatus('default',{
      status: 'DISCONNECTED',
      qr: null,
      qrDataUrl: null,
      lastError: { message: `START_ERROR: ${String(err?.message || err)}`, ts: new Date().toISOString() },
    });
  }
}
