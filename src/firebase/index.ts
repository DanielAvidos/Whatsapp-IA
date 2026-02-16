
'use client';

import { firebaseConfig, validateFirebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export function initializeFirebase() {
  if (typeof window === 'undefined') {
    // Evitar inicialización en el servidor si no es necesario o si faltan credenciales
    return null;
  }

  const validation = validateFirebaseConfig();
  
  if (!getApps().length) {
    if (!validation.isValid) {
      console.error(validation.error);
      // No lanzamos un Error fatal aquí para no romper el renderizado inicial de Next.js, 
      // pero devolvemos un estado que los hooks manejarán.
      return null;
    }

    try {
      const app = initializeApp(firebaseConfig);
      return getSdks(app);
    } catch (e) {
      console.error('Error al inicializar Firebase App:', e);
      return null;
    }
  }

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
