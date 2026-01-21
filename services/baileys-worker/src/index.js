
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const path = require('path');
const cors = require('cors');

// Force IPv4 first to avoid IPv6 WSS handshake issues in some cloud environments
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

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

async function upsertChannelStatus(channelId, patch) {
    const ref = db.collection('channels').doc(channelId);
    await ref.set({
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
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
      hasLastQr: !!q,
      lastQrAt: q?.at || null,
      nodeOptions: process.env.NODE_OPTIONS || null
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
  await upsertChannelStatus('default', { status:'DISCONNECTED', qr:null, qrDataUrl:null });
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
  await upsertChannelStatus('default', {
    status: 'CONNECTING',
    qr: null,
    qrDataUrl: null,
    lastError: null
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
        console.log('[BAILEYS] connection.update', {
          connection,
          hasQR: Boolean(qr),
          lastDisconnect: lastDisconnect ? {
            message: lastDisconnect?.error?.message,
            statusCode: lastDisconnect?.error?.output?.statusCode,
            name: lastDisconnect?.error?.name
          } : null
        });
      
        if (qr) {
          try {
            const QRCode = require('qrcode');
            const qrDataUrl = await QRCode.toDataURL(qr);
      
            global.__LAST_QR__ = { qr, qrDataUrl, at: Date.now() };
      
            await upsertChannelStatus('default', {
              status: 'QR',
              qr,
              qrDataUrl,
              phoneE164: null,
              lastError: null
            });
      
            console.log('[BAILEYS] QR saved to Firestore', { len: qr.length });
          } catch (e) {
            console.error('[BAILEYS] Failed to save QR', e);
            await upsertChannelStatus('default', {
              lastError: `QR Error: ${String(e?.message || e)}`,
              status: 'ERROR'
            });
          }
        }
      
        if (connection === 'open') {
          try {
            await upsertChannelStatus('default', {
              status: 'CONNECTED',
              qr: null,
              qrDataUrl: null,
              lastError: null
            });
            console.log('[BAILEYS] CONNECTED');
          } catch (e) {
            console.error('[BAILEYS] failed to persist CONNECTED', e);
          }
        }
      
        if (connection === 'close') {
          try {
            const err = lastDisconnect?.error;
            let errorMessage = null;
            if (err) {
              const boomError = err as any;
              const name = boomError.name || 'Error';
              const msg = boomError.message || 'Unknown disconnect reason';
              const statusCode = boomError.output?.statusCode;
              errorMessage = `Disconnect: ${name}${statusCode ? ` (${statusCode})` : ''} - ${msg}`;
            }
            await upsertChannelStatus('default', {
              status: 'DISCONNECTED',
              qr: null,
              qrDataUrl: null,
              lastError: errorMessage,
            });
            console.log('[BAILEYS] DISCONNECTED persisted');
          } catch (e) {
            console.error('[BAILEYS] failed to persist DISCONNECTED', e);
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
      lastError: `START_ERROR: ${String(err?.message || err)}`,
    });
  }
}
