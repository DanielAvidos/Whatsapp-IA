'use client';

import { useEffect, useState } from 'react';
import { Settings2, X, Copy, Check, ChevronRight, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

/**
 * Indicador visual colapsable que muestra información crítica del entorno.
 * Solo se renderiza en modo desarrollo.
 */
export function DevIndicator() {
  const [isDev, setIsDev] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { toast } = useToast();

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'NOT SET';
  const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || 'NOT SET';

  useEffect(() => {
    setIsDev(process.env.NODE_ENV === 'development');
  }, []);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: 'Copiado', description: `${field} copiado al portapapeles.` });
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (!isDev) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 font-mono">
      {isOpen ? (
        <div className="w-80 rounded-lg border border-border bg-card p-4 shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200">
          <div className="flex items-center justify-between mb-4 border-b pb-2">
            <div className="flex items-center gap-2 text-yellow-500">
              <Terminal className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Entorno DEV</span>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6" 
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Firebase Project</label>
              <div className="flex items-center gap-2 rounded bg-muted/50 p-2">
                <span className="flex-1 truncate text-[11px] font-bold">{projectId}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 shrink-0" 
                  onClick={() => copyToClipboard(projectId, 'Project ID')}
                >
                  {copiedField === 'Project ID' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Worker URL</label>
              <div className="flex items-center gap-2 rounded bg-muted/50 p-2">
                <span className="flex-1 truncate text-[11px] font-bold">{workerUrl}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 shrink-0" 
                  onClick={() => copyToClipboard(workerUrl, 'Worker URL')}
                >
                  {copiedField === 'Worker URL' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setIsOpen(true)}
          className="h-10 w-10 rounded-full bg-black/90 text-yellow-400 shadow-xl hover:bg-black hover:scale-105 transition-all border border-yellow-500/20"
          size="icon"
        >
          <Settings2 className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
