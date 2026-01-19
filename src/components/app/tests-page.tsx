"use client";

import { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';
import { Loader2, RefreshCw } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/context/language-provider';
import type { WhatsappChannel } from '@/lib/types';
import {
  ensureDefaultChannel,
  subscribeToDefaultChannel,
  updateDefaultChannel,
} from '@/lib/firestore/channels';
import { StatusBadge } from '@/components/app/status-badge';
import { QrCodeDialog } from '@/components/app/qr-code-dialog';
import { Skeleton } from '@/components/ui/skeleton';

export function TestsPage() {
  const { t } = useLanguage();
  const firestore = useFirestore();
  const [channel, setChannel] = useState<WhatsappChannel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isQrModalOpen, setQrModalOpen] = useState(false);

  useEffect(() => {
    if (!firestore) return;

    let isMounted = true;

    // 1. Ensure the default document exists
    ensureDefaultChannel(firestore).then(() => {
      if (!isMounted) return;
      // 2. Subscribe to real-time updates
      const unsubscribe = subscribeToDefaultChannel(firestore, (data) => {
        setChannel(data);
        if (isLoading) {
          setIsLoading(false);
        }
      });

      // Cleanup subscription on component unmount
      return () => unsubscribe();
    });

    return () => {
      isMounted = false;
    }
  }, [firestore, isLoading]);

  const handleToggleConnection = () => {
    if (!firestore) return;

    const currentStatus = channel?.status;
    if (currentStatus === 'DISCONNECTED') {
      updateDefaultChannel(firestore, {
        status: 'CONNECTING',
        qr: `DEMO_QR_${Date.now()}`,
      });
    } else {
      updateDefaultChannel(firestore, {
        status: 'DISCONNECTED',
        qr: null,
      });
    }
  };
  
  const getStatusForBadge = (status: WhatsappChannel['status'] | undefined) => {
     if (!status) return 'DISCONNECTED';
     // The status badge component can handle these directly
     return status;
  }

  return (
    <>
      <main className="container mx-auto p-4 md:p-6 lg:p-8">
        <PageHeader
          title={t('linked.device')}
          description={t('manage.connection')}
        />

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
                    <span className="font-medium">{channel?.displayName ?? '...'}</span>
                    <StatusBadge status={getStatusForBadge(channel?.status)} />
                  </div>
                  <Button variant="outline" onClick={() => setQrModalOpen(true)}>{t('scan.qr.code')}</Button>
                </div>
              )}

              <Button variant="outline" className="w-full" onClick={handleToggleConnection} disabled={isLoading}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('force.relink')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 flex flex-col items-center justify-center gap-4 h-full">
              {isLoading ? (
                  <Skeleton className="w-64 h-64" />
              ) : channel?.qr ? (
                 <div className="w-64 h-64 rounded-lg bg-white p-4 flex items-center justify-center">
                    <QRCode value={channel.qr} size={224} />
                 </div>
              ) : (
                <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg">
                    <p className="text-center text-sm text-muted-foreground p-4">
                       Aún no hay QR. Genera o espera a que el sistema lo publique.
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
        qr={channel?.qr ?? null} 
        isOpen={isQrModalOpen}
        onOpenChange={setQrModalOpen} 
      />
    </>
  );
}
