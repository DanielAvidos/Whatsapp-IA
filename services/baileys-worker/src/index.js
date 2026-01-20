const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const path = require('path');

initializeApp();
const db = getFirestore();
const channelDocRef = db.collection('channels').doc('default');

const logger = pino({ level: 'info' });

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

app.get('/health', (_req, res) => res.status(200).send('ok'));

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
  try {
    logger.info('Received request to generate QR code.');
    await startBaileys({ forceRestart: true });
    res.json({ ok: true, message: 'QR generation process started.' });
  } catch (e) {
    logger.error(e, 'Failed to handle QR request');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/v1/channels/default/disconnect', async (_req, res) => {
  try {
    logger.info('Received request to disconnect.');
    if (sock) {
      await sock.logout('User requested disconnect.');
      sock = null;
    } else {
       // If sock is null, we still ensure the state in DB is disconnected
       await channelDocRef.set({
        status: 'DISCONNECTED',
        qr: null,
        qrDataUrl: null,
        phoneE164: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    res.json({ ok: true, message: 'Disconnection process initiated.' });
  } catch (e) {
    logger.error(e, 'Failed to handle disconnect request');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  startBaileys({ forceRestart: false }).catch(err => logger.error(err, "Initial Baileys start failed"));
});

async function startBaileys({ forceRestart = false }) {
  if (starting) {
    logger.warn('Start Baileys called while already starting.');
    return;
  }
  starting = true;
  logger.info({ forceRestart }, 'Starting Baileileys process...');

  try {
    if (sock && forceRestart) {
      logger.info('Forcing restart, closing existing socket.');
      try {
        await sock.logout('Forcing restart.');
      } catch (e) {
        logger.error(e, 'Error during forced logout, proceeding anyway.')
      }
      sock = null;
    }
    
    if (sock) {
      logger.warn('Socket already exists and not forcing restart. Aborting start.')
      starting = false;
      return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(path.join('/tmp', 'baileys_auth_info'));

    logger.info('Creating new Baileys socket.');
    await channelDocRef.set({
      status: 'CONNECTING',
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      logger.info({ update }, 'connection.update');

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR received from Baileys, saving to Firestore...');
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await channelDocRef.set({
            status: 'CONNECTING',
            qr,
            qrDataUrl,
            updatedAt: FieldValue.serverTimestamp(),
            lastSeenAt: FieldValue.serverTimestamp(),
            lastError: null,
          }, { merge: true });
          logger.info('Successfully saved QR to Firestore.');
        } catch (err) {
          logger.error(err, 'Failed to generate/save QR');
          await channelDocRef.set({
            lastError: String(err?.message || err),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 500;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        logger.info({ shouldReconnect, statusCode }, 'Connection closed');

        await channelDocRef.set({
          status: 'DISCONNECTED',
          qr: null,
          qrDataUrl: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        sock = null;

        if (shouldReconnect) {
          logger.info('Attempting to reconnect in 2 seconds...');
          setTimeout(() => startBaileys({ forceRestart: false }).catch((e) => logger.error(e, 'Reconnect failed')), 2000);
        } else {
          logger.info('Not reconnecting because user logged out.');
        }
      }

      if (connection === 'open') {
        logger.info('Connection opened');
        const phoneId = sock?.user?.id?.split(':')?.[0];
        await channelDocRef.set({
          status: 'CONNECTED',
          qr: null,
          qrDataUrl: null,
          phoneE164: phoneId ? `+${phoneId}` : null,
          updatedAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
          lastError: null,
        }, { merge: true });
        logger.info('Updated Firestore to CONNECTED state.');
      }
    });

    const doc = await channelDocRef.get();
    if (!doc.exists) {
        logger.info('Default channel doc does not exist, creating it.');
        await channelDocRef.set({
            displayName: "Canal Principal",
            status: "DISCONNECTED",
            qr: null,
            qrDataUrl: null,
            phoneE164: null,
            updatedAt: FieldValue.serverTimestamp(),
            lastSeenAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        });
    }

  } finally {
    starting = false;
  }
}
