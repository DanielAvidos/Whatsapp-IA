
'use client';

import React, { useMemo, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const firebaseServices = useMemo(() => {
    return initializeFirebase();
  }, []);

  if (!firebaseServices) {
    // Mostrar un estado de error amigable si Firebase no pudo inicializarse
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Error de Configuración</AlertTitle>
          <AlertDescription>
            No se pudo inicializar Firebase. Asegúrate de que todas las variables de entorno NEXT_PUBLIC_FIREBASE_* estén correctamente configuradas.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}
