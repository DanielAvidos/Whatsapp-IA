'use client';

import { firebaseConfig, validateFirebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

export function initializeFirebase() {
  if (typeof window === 'undefined') {
    return null;
  }

  const validation = validateFirebaseConfig();
  if (!validation.isValid) {
    console.warn(validation.error);
    return null;
  }

  let app: FirebaseApp;
  
  if (!getApps().length) {
    try {
      app = initializeApp(firebaseConfig);
      
      // Initialize Analytics only on client and if supported
      if (firebaseConfig.measurementId) {
        isSupported().then(supported => {
          if (supported) getAnalytics(app);
        });
      }
    } catch (e) {
      console.error('Error initializing Firebase App:', e);
      return null;
    }
  } else {
    app = getApp();
  }

  return getSdks(app);
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
