'use client';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  updateDocumentNonBlocking,
} from '@/firebase/non-blocking-updates';
import type { WhatsappChannel } from '@/lib/types';
import { errorEmitter, FirestorePermissionError } from '@/firebase';

const CHANNEL_COLLECTION = 'channels';
const DEFAULT_CHANNEL_ID = 'default';

/**
 * Ensures the default channel document exists in Firestore.
 * Creates it with default values if it doesn't.
 * This is intended to be a one-time setup call.
 * @param db The Firestore instance.
 */
export async function ensureDefaultChannel(db: Firestore): Promise<void> {
  const docRef = doc(db, CHANNEL_COLLECTION, DEFAULT_CHANNEL_ID);
  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      const defaultChannelData = {
        displayName: 'Canal Principal',
        status: 'DISCONNECTED',
        qr: null,
        phoneE164: null,
        lastSeenAt: null,
        updatedAt: serverTimestamp(),
      };
      // For this initial setup, a blocking call is acceptable
      // to ensure the document exists before the UI tries to subscribe.
      await setDoc(docRef, defaultChannelData);
    }
  } catch (error) {
    console.error("Failed to ensure default channel:", error);
    // We can also emit a permission error here if needed
    const contextualError = new FirestorePermissionError({
        operation: 'get', // The failure could be on getDoc
        path: docRef.path,
    });
    errorEmitter.emit('permission-error', contextualError);
  }
}

/**
 * Subscribes to the default channel document for real-time updates.
 * @param db The Firestore instance.
 * @param callback A function to be called with the channel data.
 * @returns An unsubscribe function.
 */
export function subscribeToDefaultChannel(
  db: Firestore,
  callback: (channel: WhatsappChannel | null) => void
): Unsubscribe {
  const docRef = doc(db, CHANNEL_COLLECTION, DEFAULT_CHANNEL_ID);

  const unsubscribe = onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      callback({ id: docSnap.id, ...docSnap.data() } as WhatsappChannel);
    } else {
      // Doc doesn't exist, which might be a temp state before ensureDefaultChannel completes
      callback(null);
    }
  }, (error) => {
    console.error('Error subscribing to default channel:', error);
    const contextualError = new FirestorePermissionError({
        operation: 'get',
        path: docRef.path,
    });
    errorEmitter.emit('permission-error', contextualError);
    callback(null);
  });

  return unsubscribe;
}

/**
 * Updates the default channel document in a non-blocking way.
 * @param db The Firestore instance.
 * @param data A partial object of the data to update.
 */
export function updateDefaultChannel(
  db: Firestore,
  data: Partial<Omit<WhatsappChannel, 'id' | 'updatedAt'>>
): void {
  const docRef = doc(db, CHANNEL_COLLECTION, DEFAULT_CHANNEL_ID);
  updateDocumentNonBlocking(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}
