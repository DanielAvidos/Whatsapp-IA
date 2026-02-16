'use client';

import { useEffect, useState } from 'react';

export function DevIndicator() {
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    setIsDev(process.env.NODE_ENV === 'development');
  }, []);

  if (!isDev) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] rounded-md bg-black/90 p-3 text-[10px] font-mono text-white shadow-2xl pointer-events-none border border-white/20">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse"></div>
          <span className="font-bold text-yellow-400">DEV MODE</span>
        </div>
        <div className="h-px bg-white/10 my-1"></div>
        <div><span className="text-gray-400">PROJECT:</span> {process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'NOT SET'}</div>
        <div><span className="text-gray-400">WORKER:</span> {process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || 'NOT SET'}</div>
      </div>
    </div>
  );
}
