const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const path = require('path');

// --- Firebase Setup ---
// Initialize Firebase Admin with Application Default Credentials
initializeApp();
const db = getFirestore();
const channelDocRef = db.collection('channels').doc('default');

const logger = pino({ level: 'info' });

// --- Express Server Setup ---
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  startBaileys();
});

// --- Baileys Connection Logic ---
async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join('/tmp', 'baileys_auth_info'));

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // We handle QR manually
    logger,
    browser: Browsers.macOS('Desktop'),
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
          qr: qr,
          qrDataUrl: qrDataUrl,
          updatedAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        logger.info('QR code saved to Firestore.');
      } catch (err) {
        logger.error(err, 'Failed to generate and save QR code.');
      }
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : false;
      logger.info({ shouldReconnect }, 'Connection closed.');
      
      await channelDocRef.set({
        status: 'DISCONNECTED',
        qr: null,
        qrDataUrl: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      
      if (shouldReconnect) {
        startBaileys();
      }
    } else if (connection === 'open') {
      logger.info('Connection opened.');
      const phoneId = sock.user.id.split(':')[0];
      await channelDocRef.set({
        status: 'CONNECTED',
        qr: null,
        qrDataUrl: null,
        phoneE164: `+${phoneId}`,
        updatedAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info('Connection status updated to CONNECTED in Firestore.');
    }
  });

  // Ensure the default document exists before starting
  try {
      const doc = await channelDocRef.get();
      if (!doc.exists) {
          await channelDocRef.set({
              displayName: "Canal Principal",
              status: "DISCONNECTED",
              qr: null,
              qrDataUrl: null,
              phoneE164: null,
              updatedAt: FieldValue.serverTimestamp(),
              lastSeenAt: FieldValue.serverTimestamp(),
          });
          logger.info('Created default channel document in Firestore.');
      }
  } catch (error) {
      logger.error(error, 'Failed to ensure default channel document.');
  }
}
