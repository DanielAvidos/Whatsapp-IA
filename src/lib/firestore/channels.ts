'use client';
import {
  doc,
  onSnapshot,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type { WhatsappChannel } from '@/lib/types';
import { errorEmitter, FirestorePermissionError } from '@/firebase';

const CHANNEL_COLLECTION = 'channels';
const DEFAULT_CHANNEL_ID = 'default';

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
      // Doc doesn't exist, which might be a temp state before worker creates it
      callback(null);
    }
  }, (error) => {
    console.error('Error subscribing to default channel:', error);
    const contextualError = new FirestorePermissionError({
        operation: 'list', // onSnapshot is a list-like operation
        path: docRef.path,
    });
    errorEmitter.emit('permission-error', contextualError);
    callback(null);
  });

  return unsubscribe;
}
