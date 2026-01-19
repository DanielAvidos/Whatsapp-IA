const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');

initializeApp();
const db = getFirestore();
const channelDocRef = db.collection('channels').doc('default');

const logger = pino({ level: 'info' });

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => res.status(200).send('ok'));

let starting = false;
let sock = null;

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  startBaileys().catch((e) => logger.error(e, "startBaileys failed"));
});

async function ensureDefaultChannelDoc() {
  const doc = await channelDocRef.get();
  if (!doc.exists) {
    await channelDocRef.set({
      displayName: "Canal Principal",
      status: "DISCONNECTED",
      qr: null,
      qrDataUrl: null,
      phoneE164: null,
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    logger.info('Created default channel document in Firestore.');
  }
}

async function startBaileys() {
  if (starting) return;
  starting = true;

  try {
    await ensureDefaultChannelDoc();

    const { state, saveCreds } = await useMultiFileAuthState(path.join('/tmp', 'baileys_auth_info'));

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR code received, updating Firestore.');
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await channelDocRef.set({
            status: 'CONNECTING',
            qr,
            qrDataUrl,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          logger.info('QR code saved to Firestore.');
        } catch (err) {
          logger.error(err, 'Failed to generate and save QR code.');
        }
      }

      if (connection === 'open') {
        const me = sock?.user?.id || "";
        const phoneId = me.includes(":") ? me.split(":")[0] : null;

        await channelDocRef.set({
          status: 'CONNECTED',
          qr: null,
          qrDataUrl: null,
          phoneE164: phoneId ? `+${phoneId}` : null,
          updatedAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        logger.info({ me }, 'Connection opened and Firestore updated to CONNECTED.');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode && statusCode !== DisconnectReason.loggedOut;

        logger.warn({ statusCode, shouldReconnect }, 'Connection closed.');

        await channelDocRef.set({
          status: 'DISCONNECTED',
          qr: null,
          qrDataUrl: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (shouldReconnect) {
          setTimeout(() => {
            starting = false;
            startBaileys().catch((e) => logger.error(e, "reconnect failed"));
          }, 2000);
        }
      }
    });

  } finally {
    // allow reconnect attempts if startBaileys throws
    starting = false;
  }
}
