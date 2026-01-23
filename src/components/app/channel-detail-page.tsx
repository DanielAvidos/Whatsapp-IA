"use client";

import { useState, useEffect } from 'react';
import { Loader2, ScanQrCode, LogOut, RotateCcw } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/context/language-provider';
import type { WhatsappChannel } from '@/lib/types';
import { StatusBadge } from '@/components/app/status-badge';
import { QrCodeDialog } from '@/components/app/qr-code-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import Link from 'next/link';

export function ChannelDetailPage({ channelId }: { channelId: string }) {
  const { t } = useLanguage();
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const channelRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId);
  }, [firestore, channelId]);

  const { data: channel, isLoading } = useDoc<WhatsappChannel>(channelRef);

  const [isQrModalOpen, setQrModalOpen] = useState(false);

  const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || "https://baileys-worker-701554958520.us-central1.run.app";

  const handleApiCall = async (endpoint: string, successMessage: string, errorMessage: string) => {
     if (!workerUrl) {
        toast({ variant: 'destructive', title: 'Worker URL no configurado' });
        return;
    }
    toast({ title: successMessage });
    try {
        await fetch(`${workerUrl}/v1/channels/${channelId}${endpoint}`, { method: 'POST', mode: 'cors' });
        // onSnapshot se encargará de actualizar el estado
    } catch (error) {
        toast({ variant: 'destructive', title: errorMessage, description: String(error) });
    }
  }

  const handleGenerateQr = () => handleApiCall('/qr', 'Generando nuevo código QR...', 'Fallo al solicitar el código QR');
  const handleDisconnect = () => handleApiCall('/disconnect', 'Desconectando...', 'Fallo al desconectar');
  const handleResetSession = () => handleApiCall('/resetSession', 'Reseteando sesión...', 'Fallo al resetear la sesión');

  const renderError = (error: any) => {
    if (!error) return null;
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null) {
      return `[${error.statusCode || 'N/A'}] ${error.message || JSON.stringify(error)}`;
    }
    return 'Se produjo un error desconocido.';
  };

  const getStatusForBadge = (status: WhatsappChannel['status'] | undefined) => {
    if (!status) return 'DISCONNECTED';
    if (status === 'QR') return 'CONNECTING'; // Treat QR state as 'Connecting' for the badge
    return status;
  };
  
  return (
    <>
      <main className="container mx-auto p-4 md:p-6 lg:p-8">
        <PageHeader
          title={channel?.displayName || 'Loading...'}
          description={t('manage.connection')}
        >
          <Button variant="outline" asChild>
            <Link href="/channels">Back to Channels</Link>
          </Button>
        </PageHeader>
        
        {!workerUrl && (
            <Alert variant="destructive" className="mb-4">
                <AlertTitle>Configuración Incompleta</AlertTitle>
                <AlertDescription>La variable de entorno NEXT_PUBLIC_BAILEYS_WORKER_URL no está configurada.</AlertDescription>
            </Alert>
        )}

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('connection.status')}</CardTitle>
              <CardDescription>{t('link.device.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                  <Skeleton className="h-9 w-36" />
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    {channel?.status === 'CONNECTING' && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                    <span className="font-medium">{channel?.displayName ?? 'Canal Principal'}</span>
                    <StatusBadge status={getStatusForBadge(channel?.status)} />
                  </div>
                   {channel?.status === 'CONNECTED' ? (
                     <span className="text-sm text-muted-foreground">{channel.phoneE164}</span>
                   ) : (
                    <Button variant="outline" onClick={() => setQrModalOpen(true)} disabled={channel?.status === 'CONNECTING' || !channel?.qrDataUrl}>{t('scan.qr.code')}</Button>
                   )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Button variant="outline" onClick={handleGenerateQr} disabled={isLoading || !workerUrl}>
                    <ScanQrCode className="mr-2 h-4 w-4" />
                    Generar/Refrescar QR
                </Button>
                <Button variant="outline" color="amber" onClick={handleResetSession} disabled={isLoading || !workerUrl}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Resetear Sesión
                </Button>
                <Button variant="destructive" onClick={handleDisconnect} disabled={isLoading || !workerUrl || channel?.status !== 'CONNECTED'}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Desconectar
                </Button>
              </div>
               {channel?.lastError && (
                 <Alert variant="destructive">
                   <AlertTitle>Último Error</AlertTitle>
                   <AlertDescription>{renderError(channel.lastError)}</AlertDescription>
                 </Alert>
               )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 flex flex-col items-center justify-center gap-4 h-full">
              {isLoading ? (
                  <Skeleton className="w-64 h-64" />
              ) : channel?.status === 'QR' && channel.qrDataUrl ? (
                 <div className="w-64 h-64 rounded-lg bg-white p-4 flex items-center justify-center">
                    <img src={channel.qrDataUrl} alt="WhatsApp QR Code" width={224} height={224} />
                 </div>
              ) : (
                <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg">
                    <p className="text-center text-sm text-muted-foreground p-4">
                       {channel?.status === 'CONNECTING' ? 'Generando QR...' : 'Aún no hay QR. Genera uno para comenzar.'}
                    </p>
                </div>
              )}
               <p className="text-center text-sm text-muted-foreground">
                    {t('scan.qr.instruction')}
                </p>
            </CardContent>
          </Card>
        </div>
      </main>
      <QrCodeDialog 
        qrDataUrl={channel?.qrDataUrl ?? null} 
        isOpen={isQrModalOpen}
        onOpenChange={setQrModalOpen} 
      />
    </>
  );
}
