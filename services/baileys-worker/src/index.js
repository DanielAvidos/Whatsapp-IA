
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;

const {
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
  downloadMediaMessage,
} = baileys;

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const cors = require('cors');
const dns = require('dns');

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

// Resolve storage bucket name explicitly
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 
                   process.env.STORAGE_BUCKET || 
                   `${process.env.GOOGLE_CLOUD_PROJECT}.firebasestorage.app`;

console.log(`[BOOT] Resolved Storage Bucket: ${bucketName}`);
const bucket = getStorage().bucket(bucketName);

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// --- GLOBAL STATE ---
const activeSockets = new Map();
const startingChannels = new Set();
const retryCounts = new Map();
const startPromises = new Map();
const channelConnState = new Map();
const lockRenewals = new Map();

// IDEMPOTENCY MAPPING (waMessageId -> clientMessageId)
const waToClientMap = new Map();

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

/**
 * Unwraps complex message types to get the core message object.
 */
function unwrapMessage(message) {
  if (!message) return null;
  let msg = message;
  if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
  if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
  if (msg.viewOnceMessageV2Extension) msg = msg.viewOnceMessageV2Extension.message;
  if (msg.editedMessage) msg = msg.editedMessage.message;
  if (msg?.protocolMessage?.editedMessage) msg = msg.protocolMessage.editedMessage;
  return msg;
}

function extractText(message) {
  const msg = unwrapMessage(message);
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
async function saveMessageToFirestore(channelId, jid, originalId, docData) {
  const convRef = db.collection('channels').doc(channelId).collection('conversations').doc(jid);
  const messagesCol = convRef.collection('messages');
  
  let targetDocId = originalId;
  const isFromMe = !!docData.fromMe;

  // Resolve Idempotency for OUT messages
  if (isFromMe) {
    if (docData.clientMessageId) {
      targetDocId = docData.clientMessageId;
    } else if (waToClientMap.has(originalId)) {
      targetDocId = waToClientMap.get(originalId);
    } else {
      // Search Fallback: look for recent "sending" message with same text
      try {
        const recentSnap = await messagesCol
          .where('fromMe', '==', true)
          .where('text', '==', docData.text)
          .where('timestamp', '>=', Date.now() - 120000) // 2 min window
          .limit(1)
          .get();
        
        if (!recentSnap.empty) {
          targetDocId = recentSnap.docs[0].id;
          logger.info({ originalId, targetDocId }, 'Deduplicated via search fallback');
        }
      } catch (e) {
        logger.error({ error: e.message }, 'Deduplication search failed');
      }
    }
  }

  const msgRef = messagesCol.doc(targetDocId);

  // Extract identity metadata for conversation enrichment
  const { phoneE164, pushName, ...messagePayload } = docData;

  await msgRef.set({
    ...messagePayload,
    id: targetDocId,
    updatedAt: FieldValue.serverTimestamp(),
    timestampServer: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update conversation summary
  const isIn = docData.direction === 'IN';
  const convPatch = {
    jid,
    type: jid.endsWith('@g.us') ? 'group' : 'user',
    lastMessageText: messagePayload.text || (messagePayload.type === 'image' ? '[Imagen]' : messagePayload.type === 'audio' ? '[Audio]' : '[media]'),
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessageId: targetDocId,
    unreadCount: isIn ? FieldValue.increment(1) : FieldValue.increment(0),
    updatedAt: FieldValue.serverTimestamp(),
  };

  // Identity resolution persistence
  if (phoneE164) {
    convPatch.phoneE164 = phoneE164;
  }
  if (pushName) {
    convPatch.name = pushName;
  }

  await convRef.set(convPatch, { merge: true });
}

// --- BAILEYS CORE ---
const MAX_RETRY = 6;
const RETRY_DELAY_MS = [2000, 5000, 10000, 20000, 60000, 120000];

async function startOrRestartBaileys(channelId, reason = 'manual') {
  if (startingChannels.has(channelId)) return;
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
    try { latest = await fetchLatestBaileysVersion(); } catch (e) {}

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
      
      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          await upsertChannelStatus(channelId, {
            status: 'QR',
            qr: { raw: qr, public: qrDataUrl },
            qrDataUrl,
            lastQrAt: FieldValue.serverTimestamp(),
          });
        } catch (e) {}
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
          phoneE164: phoneId ? `+${phoneId}` : null,
          connectedAt: FieldValue.serverTimestamp(),
        });
      }

      if (connection === 'close') {
        channelConnState.set(channelId, { connected: false, lastSeenAt: Date.now() });
        const err = lastDisconnect?.error;
        const statusCode = err instanceof Boom ? err.output.statusCode : 500;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        await upsertChannelStatus(channelId, {
          status: 'DISCONNECTED',
          linked: false,
          qr: emptyQrObject(),
          lastError: err ? { message: String(err.message || err), statusCode } : null,
        });

        activeSockets.delete(channelId);

        if (shouldReconnect) {
          let currentRetry = retryCounts.get(channelId) || 0;
          if (currentRetry < MAX_RETRY) {
            const delay = RETRY_DELAY_MS[currentRetry];
            retryCounts.set(channelId, currentRetry + 1);
            setTimeout(() => startOrRestartBaileys(channelId, 'auto-reconnect'), delay);
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
        for (const msg of msgs) {
          const jid = msg?.key?.remoteJid;
          const waMessageId = msg?.key?.id;
          if (!jid || !waMessageId) continue;

          // --- IDENTITY RESOLUTION ---
          let phoneE164 = null;
          if (jid.endsWith('@s.whatsapp.net')) {
            phoneE164 = `+${jid.split('@')[0]}`;
          }
          // Check for participant if primary JID is LID or for group identity
          const participantJid = msg.key.participant || msg.participant;
          if (!phoneE164 && participantJid && participantJid.endsWith('@s.whatsapp.net')) {
            phoneE164 = `+${participantJid.split('@')[0]}`;
          }
          const pushName = msg.pushName || null;

          if (phoneE164) {
            logger.debug({ jid, phoneE164 }, '[IDENTITY] Resolved phone number');
          }

          const fromMe = !!msg?.key?.fromMe;
          const rawContent = msg?.message;
          const content = unwrapMessage(rawContent);
          
          if (!content) continue;

          // Detect media types
          const imageMsg = content.imageMessage;
          const audioMsg = content.audioMessage;
          
          let text = extractText(rawContent);
          let mediaData = null;
          let messageType = 'text';

          // --- IMAGE PROCESSING ---
          if (imageMsg) {
            messageType = 'image';
            console.log(`[MEDIA_STEP] image_detected | ID: ${waMessageId} | JID: ${jid}`);
            try {
              console.log(`[MEDIA_STEP] download_start | ID: ${waMessageId}`);
              const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger, reuploadRequest: sock.updateMediaMessage }
              );
              console.log(`[MEDIA_STEP] download_success | ID: ${waMessageId} | Size: ${buffer.length} bytes`);

              const mimeType = imageMsg.mimetype || 'image/jpeg';
              const ext = mimeType.split('/')[1] || 'jpg';
              const storagePath = `channels/${channelId}/conversations/${jid}/messages/${waMessageId}/original.${ext}`;
              
              console.log(`[MEDIA_STEP] upload_start | ID: ${waMessageId} | Path: ${storagePath}`);
              const file = bucket.file(storagePath);
              await file.save(buffer, { metadata: { contentType: mimeType } });
              console.log(`[MEDIA_STEP] upload_success | ID: ${waMessageId}`);

              const [exists] = await file.exists();
              mediaData = {
                kind: 'image',
                storagePath,
                status: exists ? 'uploaded' : 'failed',
                mimeType,
                fileSize: buffer.length,
                width: imageMsg.width,
                height: imageMsg.height
              };
              
              if (imageMsg.caption) text = imageMsg.caption;
            } catch (err) {
              console.error(`[MEDIA_STEP] failure | ID: ${waMessageId} | Error: ${err.message}`, err);
              mediaData = { kind: 'image', status: 'failed', errorMessage: err.message };
            }
          }

          // --- AUDIO PROCESSING ---
          if (audioMsg) {
            messageType = 'audio';
            console.log(`[MEDIA_STEP] audio_detected | ID: ${waMessageId} | JID: ${jid}`);
            try {
              const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger, reuploadRequest: sock.updateMediaMessage }
              );
              
              const mimeType = audioMsg.mimetype || 'audio/ogg';
              const ext = mimeType.split('/')[1]?.split(';')[0] || 'ogg';
              const storagePath = `channels/${channelId}/conversations/${jid}/messages/${waMessageId}/original.${ext}`;
              
              const file = bucket.file(storagePath);
              await file.save(buffer, { metadata: { contentType: mimeType } });
              
              const [exists] = await file.exists();
              mediaData = {
                kind: 'audio',
                storagePath,
                status: exists ? 'uploaded' : 'failed',
                mimeType,
                fileSize: buffer.length,
                seconds: audioMsg.seconds,
                ptt: !!audioMsg.ptt
              };
            } catch (err) {
              console.error(`[MEDIA_STEP] audio_failure | ID: ${waMessageId}`, err);
              mediaData = { kind: 'audio', status: 'failed', errorMessage: err.message };
            }
          }

          const tsSec = typeof msg?.messageTimestamp === 'number' ? msg.messageTimestamp : null;
          const timestampMs = tsSec ? tsSec * 1000 : Date.now();

          await saveMessageToFirestore(channelId, jid, waMessageId, {
            waMessageId,
            jid,
            fromMe,
            direction: fromMe ? 'OUT' : 'IN',
            text,
            type: messageType,
            media: mediaData,
            status: fromMe ? 'sent' : 'received',
            timestamp: timestampMs,
            phoneE164,
            pushName
          });
        }
      } catch (e) {
        logger.error({ error: e.message }, 'Error in messages.upsert');
      }
    });

    return sock;
  } catch (err) {
    await upsertChannelStatus(channelId, { status: 'ERROR' });
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

// --- CHANNELS API ---
app.get('/v1/channels', async (_req, res) => {
  try {
    const snapshot = await db.collection('channels').get();
    res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/v1/channels', async (req, res) => {
  try {
    const { displayName, id } = req.body;
    const channelData = { displayName, status: 'DISCONNECTED', linked: false, createdAt: FieldValue.serverTimestamp() };
    const channelRef = id ? db.collection('channels').doc(id) : db.collection('channels').doc();
    await channelRef.set(channelData, { merge: true });
    res.status(201).json({ id: channelRef.id, ...channelData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/v1/channels/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { displayName } = req.body;
    await db.collection('channels').doc(channelId).update({ displayName, updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/v1/channels/:channelId/status', async (req, res) => {
  try {
    const snap = await db.collection('channels').doc(req.params.channelId).get();
    res.json(snap.exists ? { id: snap.id, ...snap.data() } : null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/v1/channels/:channelId/qr', (req, res) => {
  startOrRestartBaileys(req.params.channelId, 'qr-request');
  res.json({ ok: true });
});

app.post('/v1/channels/:channelId/repair', async (req, res) => {
  const { channelId } = req.params;
  await resetFirestoreAuthState(channelId);
  await releaseChannelLock(channelId);
  await upsertChannelStatus(channelId, { status: 'DISCONNECTED', linked: false, phoneE164: null });
  res.json({ ok: true });
});

app.post('/v1/channels/:channelId/disconnect', async (req, res) => {
  const sock = activeSockets.get(req.params.channelId);
  if (sock) try { await sock.logout(); } catch (e) {}
  res.json({ ok: true });
});

app.post('/v1/channels/:channelId/resetSession', async (req, res) => {
  const { channelId } = req.params;
  const sock = activeSockets.get(channelId);
  if (sock) try { await sock.logout(); } catch (e) {}
  activeSockets.delete(channelId);
  await resetFirestoreAuthState(channelId);
  await releaseChannelLock(channelId);
  await upsertChannelStatus(channelId, { status: 'DISCONNECTED', linked: false, phoneE164: null, me: null });
  res.json({ ok: true });
});

// --- MESSAGING API ---
app.get('/v1/channels/:channelId/conversations', async (_req, res) => {
  try {
    const snap = await db.collection('channels').doc(req.params.channelId).collection('conversations').orderBy('lastMessageAt', 'desc').limit(50).get();
    res.json({ ok: true, conversations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/v1/channels/:channelId/conversations/:jid/messages', async (req, res) => {
  try {
    const snap = await db.collection('channels').doc(req.params.channelId).collection('conversations').doc(decodeURIComponent(req.params.jid)).collection('messages').orderBy('timestamp', 'desc').limit(50).get();
    res.json({ ok: true, messages: snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/v1/channels/:channelId/messages/send', async (req, res) => {
  try {
    const { to, text, meta } = req.body;
    const { channelId } = req.params;
    const clientMessageId = meta?.clientMessageId;

    const sock = await ensureSocketReady(channelId);
    if (!sock) return res.status(409).json({ error: 'Socket not ready' });
    
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const r = await sock.sendMessage(jid, { text });
    const waMessageId = r?.key?.id;

    if (waMessageId && clientMessageId) {
      waToClientMap.set(waMessageId, clientMessageId);
    }

    await saveMessageToFirestore(channelId, jid, waMessageId || `proxy-${Date.now()}`, {
      waMessageId,
      clientMessageId: clientMessageId || null,
      jid,
      fromMe: true,
      direction: 'OUT',
      text,
      type: 'text',
      status: 'sent',
      timestamp: Date.now(),
      source: meta?.source || 'proxy'
    });

    res.json({ ok: true, messageId: waMessageId || clientMessageId });
  } catch (e) { 
    logger.error({ error: e.message }, 'Worker send error');
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/v1/channels/:channelId/messages/send-image', async (req, res) => {
  try {
    const { to, storagePath, caption, meta } = req.body;
    const { channelId } = req.params;
    const clientMessageId = meta?.clientMessageId;

    const sock = await ensureSocketReady(channelId);
    if (!sock) return res.status(409).json({ error: 'Socket not ready' });

    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

    const file = bucket.file(storagePath);
    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();

    const r = await sock.sendMessage(jid, { 
      image: buffer, 
      caption: caption || '' 
    });
    const waMessageId = r?.key?.id;

    if (waMessageId && clientMessageId) waToClientMap.set(waMessageId, clientMessageId);

    await saveMessageToFirestore(channelId, jid, waMessageId || `proxy-${Date.now()}`, {
      waMessageId,
      clientMessageId: clientMessageId || null,
      jid,
      fromMe: true,
      direction: 'OUT',
      text: caption || null,
      type: 'image',
      status: 'sent',
      media: {
        kind: 'image',
        storagePath,
        status: 'uploaded',
        mimeType: metadata.contentType,
        fileSize: metadata.size,
      },
      timestamp: Date.now(),
      source: meta?.source || 'manual'
    });

    res.json({ ok: true, messageId: waMessageId || clientMessageId });
  } catch (e) {
    logger.error({ error: e.message }, 'Worker send-image error');
    res.status(500).json({ error: e.message });
  }
});

app.post('/v1/channels/:channelId/messages/send-audio', async (req, res) => {
  try {
    const { to, storagePath, mimetype, ptt, seconds, meta } = req.body;
    const { channelId } = req.params;
    const clientMessageId = meta?.clientMessageId;

    console.log(`[AUDIO_SEND] start | To: ${to} | Mime: ${mimetype} | PTT: ${ptt}`);

    const sock = await ensureSocketReady(channelId);
    if (!sock) {
      console.error(`[AUDIO_SEND] failure | Socket not ready`);
      return res.status(409).json({ error: 'Socket not ready' });
    }

    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

    const file = bucket.file(storagePath);
    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();

    const r = await sock.sendMessage(jid, { 
      audio: buffer, 
      mimetype: mimetype || metadata.contentType || 'audio/ogg',
      ptt: !!ptt
    });
    const waMessageId = r?.key?.id;

    if (waMessageId && clientMessageId) waToClientMap.set(waMessageId, clientMessageId);

    await saveMessageToFirestore(channelId, jid, waMessageId || `proxy-${Date.now()}`, {
      waMessageId,
      clientMessageId: clientMessageId || null,
      jid,
      fromMe: true,
      direction: 'OUT',
      text: null,
      type: 'audio',
      status: 'sent',
      media: {
        kind: 'audio',
        storagePath,
        status: 'uploaded',
        mimeType: mimetype || metadata.contentType,
        fileSize: metadata.size,
        seconds: seconds || 0,
        ptt: !!ptt
      },
      timestamp: Date.now(),
      source: meta?.source || 'manual'
    });

    console.log(`[AUDIO_SEND] success | ID: ${waMessageId || clientMessageId}`);
    res.json({ ok: true, messageId: waMessageId || clientMessageId });
  } catch (e) {
    console.error(`[AUDIO_SEND] failure | Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/v1/channels/:channelId/conversations/:jid/markRead', async (req, res) => {
  try {
    await db.collection('channels').doc(req.params.channelId).collection('conversations').doc(decodeURIComponent(req.params.jid)).set({ unreadCount: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'HTTP server listening');
  try {
    const snap = await db.collection('channels').where('linked', '==', true).get();
    for (const docSnap of snap.docs) startOrRestartBaileys(docSnap.id, 'boot');
  } catch (e) {}
});
