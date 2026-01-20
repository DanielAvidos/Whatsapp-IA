'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/context/language-provider';

interface QrCodeDialogProps {
  qrDataUrl: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QrCodeDialog({ qrDataUrl, isOpen, onOpenChange }: QrCodeDialogProps) {
  const { t } = useLanguage();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('scan.qr.code')}</DialogTitle>
          <DialogDescription>
            {qrDataUrl ? t('scan.qr.instruction') : "No hay código QR disponible todavía."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center p-4">
          {qrDataUrl ? (
            <div className="rounded-lg bg-white p-4">
               <img src={qrDataUrl} alt="WhatsApp QR Code" width={256} height={256} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 w-64 bg-muted rounded-lg">
                <p className="text-center text-sm text-muted-foreground p-4">
                    No hay QR disponible todavía.
                </p>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-center">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
