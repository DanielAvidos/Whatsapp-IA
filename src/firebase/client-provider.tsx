'use client';

import React, { useMemo, useState, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { validateFirebaseConfig } from '@/firebase/config';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [configError, setConfigError] = useState<string[] | null>(null);

  useEffect(() => {
    setIsMounted(true);
    const validation = validateFirebaseConfig();
    if (!validation.isValid) {
      setConfigError(validation.missingVars || ['Unknown variables']);
    }
  }, []);

  const firebaseServices = useMemo(() => {
    if (!isMounted || configError) return null;
    return initializeFirebase();
  }, [isMounted, configError]);

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

  if (configError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background">
        <Alert variant="destructive" className="max-w-xl">
          <AlertTitle>Error de Configuración de Entorno</AlertTitle>
          <AlertDescription>
            <p className="mb-2">Faltan las siguientes variables de entorno requeridas:</p>
            <ul className="list-disc pl-5 font-mono text-xs">
              {configError.map(v => <li key={v}>{v}</li>)}
            </ul>
            <p className="mt-4 text-xs opacity-70 italic">Asegúrate de configurar estas variables en tu archivo .env.local o en el panel de App Hosting.</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!firebaseServices) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Error Crítico</AlertTitle>
          <AlertDescription>
            No se pudo inicializar Firebase. Revisa la consola del navegador para más detalles.
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
