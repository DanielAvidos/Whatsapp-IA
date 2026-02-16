'use client';

import { useEffect, useState } from 'react';

/**
 * Indicador visual que muestra información crítica del entorno actual.
 * Solo se renderiza en modo desarrollo (process.env.NODE_ENV === 'development').
 */
export function DevIndicator() {
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    setIsDev(process.env.NODE_ENV === 'development');
    
    // Log de seguridad adicional en consola
    if (process.env.NODE_ENV === 'development') {
      console.log('--- ENVIRONMENT INFO ---');
      console.log('Project ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
      console.log('Worker URL:', process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL);
      console.log('------------------------');
    }
  }, []);

  if (!isDev) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] rounded-md bg-black/95 p-3 text-[10px] font-mono text-white shadow-2xl pointer-events-none border border-white/20 backdrop-blur-sm">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse"></div>
          <span className="font-bold text-yellow-400">ENV INFO (DEV MODE)</span>
        </div>
        <div className="h-px bg-white/10 my-1"></div>
        <div className="flex flex-col gap-1">
          <div>
            <span className="text-gray-400">FIREBASE PROJECT:</span> 
            <span className="ml-2 text-white font-bold">{process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'NOT SET'}</span>
          </div>
          <div className="max-w-[300px]">
            <span className="text-gray-400">WORKER URL:</span> 
            <span className="ml-2 text-white truncate inline-block w-full align-bottom">
              {process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || 'NOT SET'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
