
'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore'

// IMPORTANT: DO NOT MODIFY THIS FUNCTION'S CORE LOGIC
// But added a safety check for the fallback config to avoid auth/invalid-api-key crashes
export function initializeFirebase() {
  if (!getApps().length) {
    let firebaseApp: FirebaseApp;
    try {
      // Attempt to initialize via Firebase App Hosting environment variables
      firebaseApp = initializeApp();
    } catch (e) {
      // Only warn in production because it's normal to use the firebaseConfig to initialize
      // during development
      if (process.env.NODE_ENV === "production") {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }

      // Safety check: only initialize with config if at least the apiKey is present
      if (firebaseConfig.apiKey && firebaseConfig.apiKey !== 'undefined') {
        firebaseApp = initializeApp(firebaseConfig);
      } else {
        console.error('Firebase configuration is missing. Ensure NEXT_PUBLIC_FIREBASE_* environment variables are set.');
        // Initialize with a dummy app to avoid breaking the entire JS execution flow
        // but it will still fail on actual service calls.
        firebaseApp = initializeApp({
          apiKey: "missing-api-key",
          projectId: "missing-project-id",
          authDomain: "missing-auth-domain",
        });
      }
    }

    return getSdks(firebaseApp);
  }

  // If already initialized, return the SDKs with the already initialized App
  return getSdks(getApp());
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore: getFirestore(firebaseApp)
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
