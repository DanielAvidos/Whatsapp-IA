
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, collection, doc, getDoc, setDoc, deleteDoc, query, getDocs: getFirestoreDocs, addDoc } = require('firebase-admin/firestore');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const cors = require('cors');

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection', reason);
});

const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

console.log('[BOOT] baileys-worker starting...', new Date().toISOString());
initializeApp();
const db = getFirestore();

const logger = pino({ level: process.env.LOG_LEVEL || 'debug' });
const { version: baileysVersion } = require('@whiskeysockets/baileys/package.json');
logger.info({ service: 'baileys-worker', version: '2-firestore-auth', baileysVersion }, 'Booting service');

// --- Global State ---
const activeSockets = new Map(); // <channelId, WASocket>
const startingChannels = new Set(); // <channelId>
let channelListeners = new Map(); // <channelId, { unsubscribe: () => void }>

// --- Firestore Auth State Manager ---
const useFirestoreAuthState = async (channelId) => {
    const authCollection = collection(db, 'channels', channelId, 'auth');

    const writeData = (data, id) => setDoc(doc(authCollection, id), JSON.parse(JSON.stringify(data)));
    const readData = async (id) => {
        const docSnap = await getDoc(doc(authCollection, id));
        return docSnap.exists() ? docSnap.data() : null;
    };
    const removeData = (id) => deleteDoc(doc(authCollection, id));

    const creds = await readData('creds') || {};

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            const value = await readData(`${type}-${id}`);
                            if (value) {
                                data[id] = value;
                            }
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}`;
                            tasks.push(value ? writeData(value, file) : removeData(file));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds'),
    };
};

const resetFirestoreAuthState = async (channelId) => {
    const authCollectionRef = collection(db, 'channels', channelId, 'auth');
    const q = query(authCollectionRef);
    const querySnapshot = await getFirestoreDocs(q);
    const deletePromises = [];
    querySnapshot.forEach((doc) => {
        deletePromises.push(deleteDoc(doc.ref));
    });
    await Promise.all(deletePromises);
    logger.info({ channelId }, 'Firestore auth state reset.');
};

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 8080;

async function upsertChannelStatus(channelId, patch) {
    const ref = db.collection('channels').doc(channelId);
    await ref.set({
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}

// --- API Endpoints ---
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/debug/config', (req, res) => {
    res.json({
        ok: true,
        env: {
            PORT: process.env.PORT,
            NODE_OPTIONS: process.env.NODE_OPTIONS,
            LOG_LEVEL: process.env.LOG_LEVEL,
        },
        baileysVersion: baileysVersion,
        authStateLocation: `firestore:channels/{channelId}/auth`,
        timestamp: new Date().toISOString(),
    });
});

app.get('/v1/channels', async (_req, res) => {
    try {
        const snapshot = await db.collection('channels').get();
        const channels = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(channels);
    } catch(e) {
        logger.error(e, 'Failed to list channels');
        res.status(500).json({ ok: false, error: 'Failed to list channels' });
    }
});

app.post('/v1/channels', async (req, res) => {
    try {
        const { displayName, id } = req.body;
        if (!displayName) {
            return res.status(400).json({ error: 'displayName is required'});
        }
        const channelData = {
            displayName,
            status: 'DISCONNECTED',
            createdAt: FieldValue.serverTimestamp(),
        };

        let channelRef;
        if (id) {
            channelRef = db.collection('channels').doc(id);
            await setDoc(channelRef, channelData);
        } else {
            channelRef = await addDoc(db.collection('channels'), channelData);
        }

        res.status(201).json({ id: channelRef.id, ...channelData });
    } catch(e) {
        logger.error(e, 'Failed to create channel');
        res.status(500).json({ ok: false, error: 'Failed to create channel' });
    }
});


app.get('/v1/channels/:channelId/status', async (req, res) => {
  try {
    const { channelId } = req.params;
    const snap = await db.collection('channels').doc(channelId).get();
    res.json(snap.exists ? { id: snap.id, ...snap.data() } : null);
  } catch (e) {
     logger.error(e, 'Failed to get status for channel', req.params.channelId);
     res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/v1/channels/:channelId/qr', async (req, res) => {
  const { channelId } = req.params;
  logger.info({ channelId }, 'Received API request to generate QR code.');
  startOrRestartBaileys(channelId);
  res.json({ ok: true, message: 'QR generation process started.' });
});

app.post('/v1/channels/:channelId/disconnect', async (req, res) => {
    const { channelId } = req.params;
    logger.info({ channelId }, 'Received API request to disconnect.');
    const sock = activeSockets.get(channelId);
    if (sock) {
        try { await sock.logout(); } catch (e) { logger.warn(e, 'logout failed'); }
        try { sock.end?.(); } catch (_) {}
    }
    activeSockets.delete(channelId);
    startingChannels.delete(channelId);
    await upsertChannelStatus(channelId, { status:'DISCONNECTED', qr:null, qrDataUrl:null });
    res.json({ ok: true, message: 'Disconnection process initiated.' });
});

app.post('/v1/channels/:channelId/resetSession', async (req, res) => {
    const { channelId } = req.params;
    logger.info({ channelId }, 'Received API request to reset session.');
    const sock = activeSockets.get(channelId);
    if (sock) {
        try { await sock.logout(); } catch (e) { logger.warn(e, 'logout during reset failed'); }
        try { sock.end?.(); } catch (_) {}
    }
    activeSockets.delete(channelId);
    startingChannels.delete(channelId);

    await resetFirestoreAuthState(channelId);

    await upsertChannelStatus(channelId, {
        status:'DISCONNECTED',
        qr:null,
        qrDataUrl:null,
        phoneE164: null,
        lastError: null,
        lastQrAt: null,
        me: null,
        linked: false,
    });
    res.json({ ok: true, message: 'Session reset successfully.' });
});


// --- Baileys Core Logic ---
let retryCounts = new Map(); // <channelId, number>
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
        qr: null,
        qrDataUrl: null,
        lastError: null,
    });

    try {
        if (activeSockets.has(channelId)) {
            logger.info({ channelId }, 'Found existing socket, logging out before restart.');
            try {
                await activeSockets.get(channelId).logout();
            } catch (e) {
                logger.warn({channelId, error: e}, 'Existing socket logout failed, proceeding.')
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
            const logCtx = { channelId, connection, hasQr: !!qr };
            logger.info(logCtx, 'Connection update');
            
            if (qr) {
                try {
                    const qrDataUrl = await qrcode.toDataURL(qr);
                    await upsertChannelStatus(channelId, {
                        status: 'QR',
                        qr,
                        qrDataUrl,
                        lastQrAt: FieldValue.serverTimestamp(),
                    });
                    logger.info({ channelId }, 'QR code saved to Firestore.');
                } catch (e) {
                    logger.error(e, 'Failed to save QR code.');
                }
            }
          
            if (connection === 'open') {
                retryCounts.set(channelId, 0);
                const phoneId = sock?.user?.id?.split(':')?.[0] || null;
                await upsertChannelStatus(channelId, {
                    status: 'CONNECTED',
                    linked: true,
                    qr: null,
                    qrDataUrl: null,
                    lastError: null,
                    phoneE164: phoneId ? `+${phoneId}` : null,
                    me: sock?.user || null,
                    connectedAt: FieldValue.serverTimestamp(),
                });
                logger.info({ channelId, jid: sock.user?.id }, 'Connection opened.');
            }
          
            if (connection === 'close') {
                const err = lastDisconnect?.error;
                const statusCode = err instanceof Boom ? err.output.statusCode : 500;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                logger.warn({ channelId, statusCode, shouldReconnect, error: err?.message }, 'Connection closed.');
                
                await upsertChannelStatus(channelId, {
                    status: 'DISCONNECTED',
                    linked: false,
                    qr: null,
                    qrDataUrl: null,
                    lastError: err ? {
                        message: err.message,
                        stack: err.stack,
                        statusCode,
                    } : null,
                });

                activeSockets.delete(channelId);
                startingChannels.delete(channelId);
              
                if (shouldReconnect) {
                    let currentRetry = retryCounts.get(channelId) || 0;
                    if (currentRetry < MAX_RETRY) {
                        const delay = RETRY_DELAY_MS[currentRetry];
                        logger.info({ channelId, delay, attempt: currentRetry + 1 }, 'Reconnecting...');
                        await new Promise(r => setTimeout(r, delay));
                        retryCounts.set(channelId, currentRetry + 1);
                        startOrRestartBaileys(channelId);
                    } else {
                        logger.error({ channelId }, 'Max retries reached.');
                        await upsertChannelStatus(channelId, { status: 'ERROR', lastError: { message: 'Max retries reached.' } });
                    }
                } else {
                    logger.info({ channelId }, 'Not reconnecting, reason: logged out.');
                    await resetFirestoreAuthState(channelId);
                }
            }
        });

    } catch (err) {
        logger.error(err, 'Baileys failed to start for channel', channelId);
        await upsertChannelStatus(channelId,{
            status: 'ERROR',
            lastError: { message: `START_ERROR: ${String(err?.message || err)}` },
        });
    } finally {
        startingChannels.delete(channelId);
    }
}

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'HTTP server listening');
});
