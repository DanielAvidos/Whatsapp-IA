
'use client';

import React, { useMemo, useState, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const firebaseServices = useMemo(() => {
    if (!isMounted) return null;
    return initializeFirebase();
  }, [isMounted]);

  // Durante el renderizado inicial (servidor y cliente), mostramos un estado de carga
  // para evitar desajustes de hidratación (Hydration Mismatch).
  if (!isMounted) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background p-8">
        <div className="flex w-full flex-col gap-4">
          <Skeleton className="h-12 w-1/4" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // Si después de montar en el cliente, Firebase no puede inicializarse (falta de variables de entorno)
  if (!firebaseServices) {
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
