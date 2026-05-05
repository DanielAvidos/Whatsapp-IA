
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, ScanQrCode, LogOut, RotateCcw, MessageSquare, Link as LinkIcon, Send, Bot, FileText, Save, History, Brain, Info, AlertCircle, CheckCircle2, Clock, PlusCircle, Trash2, Settings2, MoreVertical, User, UserPlus, CalendarClock, XCircle, Image as ImageIcon, Paperclip, Music, Mic, Square, Trash, Edit3, LayoutGrid, ChevronRight, Tag, Tags, Search, X, Upload, FileSpreadsheet, CheckCircle, AlertTriangle } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useUser, setDocumentNonBlocking, useFirebase, deleteDocumentNonBlocking } from '@/firebase';
import { doc, collection, query, orderBy, limit, Timestamp, serverTimestamp, setDoc, updateDoc, deleteDoc, where, getDoc, addDoc, writeBatch, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/context/language-provider';
import type { WhatsappChannel, Conversation, Message, BotConfig, FollowupConfig, ImageResponse, FunnelStageConfig, ChannelLabel } from '@/lib/types';
import { StatusBadge } from '@/components/app/status-badge';
import { QrCodeDialog } from '@/components/app/qr-code-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getIsSuperAdmin } from '@/lib/auth-helpers';

const GEMINI_MODEL_LOCKED = "gemini-2.5-flash";

const DEFAULT_STAGES: FunnelStageConfig[] = [
  { id: 1, name: 'Prospecto' },
  { id: 2, name: 'Contactado' },
  { id: 3, name: 'Calificado' },
  { id: 4, name: 'Propuesta' },
  { id: 5, name: 'Cierre' },
];

/**
 * Unified helper to determine trial state from channel document.
 */
function getTrialState(channel: WhatsappChannel | null | undefined) {
  if (!channel?.trial?.endsAt) return { isActive: true, endsMs: null };
  const endsAt = channel.trial.endsAt;
  const endsMs = endsAt?.toDate ? endsAt.toDate().getTime() : (endsAt?.seconds ? endsAt.seconds * 1000 : 0);
  const now = Date.now();
  const isActive = !!endsMs && endsMs > now;
  return { isActive, endsMs };
}

/**
 * Resolves a Storage path to a download URL directly on the client.
 */
function ResolvedImage({ storagePath, alt }: { storagePath: string; alt: string }) {
  const { firebaseApp } = useFirebase();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!storagePath || !firebaseApp) {
      setLoading(false);
      return;
    }

    const resolve = async () => {
      try {
        const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
        const storage = getStorage(firebaseApp);
        const pathRef = ref(storage, storagePath);
        const downloadUrl = await getDownloadURL(pathRef);
        if (active) setUrl(downloadUrl);
      } catch (e) {
        console.error("[ResolvedImage] Failed to resolve URL", e);
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    resolve();
    return () => { active = false; };
  }, [storagePath, firebaseApp]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-4 text-muted-foreground italic text-xs">
        <AlertCircle className="h-5 w-5 opacity-50" />
        <span>[Imagen no disponible]</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 w-full">
        <Loader2 className="h-6 w-6 animate-spin opacity-20" />
      </div>
    );
  }

  return (
    <img 
      src={url!} 
      alt={alt} 
      className="max-w-full h-auto object-contain rounded hover:scale-[1.02] transition-transform cursor-pointer"
      onClick={() => window.open(url!, '_blank')}
      loading="lazy"
    />
  );
}

/**
 * Resolves a Storage path to a download URL for audio and renders a player.
 */
function ResolvedAudio({ storagePath, ptt }: { storagePath: string; ptt?: boolean }) {
  const { firebaseApp } = useFirebase();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!storagePath || !firebaseApp) {
      setLoading(false);
      return;
    }

    const resolve = async () => {
      try {
        const { getStorage, ref, getDownloadURL } = await import('firebase/storage');
        const storage = getStorage(firebaseApp);
        const pathRef = ref(storage, storagePath);
        const downloadUrl = await getDownloadURL(pathRef);
        if (active) setUrl(downloadUrl);
      } catch (e) {
        console.error("[ResolvedAudio] Failed to resolve URL", e);
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    resolve();
    return () => { active = false; };
  }, [storagePath, firebaseApp]);

  if (error) {
    return (
      <div className="flex items-center gap-2 p-2 text-muted-foreground italic text-xs">
        <AlertCircle className="h-4 w-4 opacity-50" />
        <span>[Audio no disponible]</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-2 w-full">
        <Loader2 className="h-4 w-4 animate-spin opacity-20" />
        <div className="h-2 flex-1 bg-muted rounded-full animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[200px] py-1">
      <audio controls className="h-8 w-full">
        <source src={url!} />
        Tu navegador no soporta el elemento de audio.
      </audio>
      {ptt && (
        <span className="text-[8px] uppercase tracking-tighter font-bold text-muted-foreground flex items-center gap-1 opacity-60 ml-1">
          <Music className="size-2" /> Nota de voz
        </span>
      )}
    </div>
  );
}

/**
 * Robust display name resolver for conversations.
 * Priorities:
 * 1. Manual contact name (isContact: true)
 * 2. Previous displayName
 * 3. pushName from Baileys
 * 4. Resolved phone number
 * 5. technical JID
 */
function resolveConversationDisplayName(conv: Conversation | null | undefined) {
  if (!conv) return 'Cargando...';
  
  const { displayName, name, phoneE164, jid, customer, isContact } = conv;
  
  // 1. Prioritize manual contact name
  if ((isContact || customer?.isContact) && customer?.name) return customer.name;

  // 2. Prioritize real display name from CRM/Capture (if it's not the JID)
  if (displayName && displayName !== jid) return displayName;
  
  // 3. Prioritize pushName from WhatsApp profile
  if (name && name !== jid) return name;
  
  // 4. Use resolved phone number
  if (phoneE164) return phoneE164;
  
  // 5. Technical fallback
  return jid;
}

export function ChannelDetailPage({ channelId }: { channelId: string }) {
  const { t } = useLanguage();
  const { firestore, user, firebaseApp } = useFirebase();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const channelRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId);
  }, [firestore, channelId]);

  const { data: channel, isLoading } = useDoc<WhatsappChannel>(channelRef);

  const [isQrModalOpen, setQrModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('connection');
  const [isExtending, setIsExtending] = useState(false);

  // Sync activeTab with URL search params
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['connection', 'chats', 'chatbot', 'funnel', 'contacts', 'labels'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Unified environment variable for Worker URL
  const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL;
  const isSuperAdmin = getIsSuperAdmin(user);

  const trial = getTrialState(channel);
  const isBlocked = !trial.isActive;

  const handleApiCall = async (endpoint: string, successMessage: string, errorMessage: string) => {
    if (!workerUrl) {
      toast({ variant: 'destructive', title: 'Worker URL no configurada', description: 'Por favor configura NEXT_PUBLIC_BAILEYS_WORKER_URL' });
      return;
    }
    toast({ title: successMessage });
    try {
      // Correct pattern: /v1/channels/{channelId}/endpoint
      await fetch(`${workerUrl}/v1/channels/${channelId}${endpoint}`, { method: 'POST', mode: 'cors' });
    } catch (error) {
      toast({ variant: 'destructive', title: errorMessage, description: String(error) });
    }
  }

  const handleExtendTrial = async (days: number) => {
    if (!firestore || !user || isExtending) return;
    setIsExtending(true);
    try {
      const channelRef = doc(firestore, 'channels', channelId);
      const channelSnap = await getDoc(channelRef);
      
      if (!channelSnap.exists()) throw new Error("Canal no encontrado");
      
      const data = channelSnap.data();
      const endsAt = data?.trial?.endsAt;
      const currentMs = endsAt?.toDate ? endsAt.toDate().getTime() : 0;
      
      const baseMs = Math.max(Date.now(), currentMs);
      const newMs = baseMs + days * 24 * 60 * 60 * 1000;
      const newEndsAt = Timestamp.fromDate(new Date(newMs));

      await updateDoc(channelRef, {
        "trial.endsAt": newEndsAt,
        "trial.status": "ACTIVE",
        "trial.extendedAt": serverTimestamp(),
        "trial.extendedByEmail": user.email,
        "trial.extendedByUid": user.uid,
        "trial.reason": "manual unblock",
        "updatedAt": serverTimestamp(),
      });

      toast({ title: "Trial extendido correctamente" });
    } catch (error: any) {
      console.error("Extend error", error);
      toast({ variant: 'destructive', title: "Error al extender", description: error.message || String(error) });
    } finally {
      setIsExtending(false);
    }
  };

  const isFromFunnel = searchParams.get('source') === 'funnel';

  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <PageHeader title={channel?.displayName || 'Cargando...'} description={t('manage.connection')}>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isExtending}>
                  {isExtending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
                  Trial
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExtendTrial(7)}>Extender +7 días</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExtendTrial(30)}>Extender +30 días</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExtendTrial(90)}>Extender +90 días</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isFromFunnel ? (
            <Button variant="outline" asChild>
              <Link href={`/channels/${channelId}?tab=funnel`}>Regresar</Link>
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/channels">Volver a Canales</Link>
            </Button>
          )}
        </div>
      </PageHeader>
      
      {isBlocked && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Periodo de Prueba Expirado</AlertTitle>
          <AlertDescription>
            Este canal ha superado su periodo de prueba. El envío de mensajes y las funciones automáticas están deshabilitadas. Contacta con soporte para activar un plan.
          </AlertDescription>
        </Alert>
      )}

      {!workerUrl && (activeTab === 'connection' || activeTab === 'chats') && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Configuración Incompleta</AlertTitle>
          <AlertDescription>La variable de entorno NEXT_PUBLIC_BAILEYS_WORKER_URL no está configurada.</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} className="space-y-4 border-none">
        <TabsContent value="connection" className="m-0 border-none outline-none">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('connection.status')}</CardTitle>
                <CardDescription>{t('link.device.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    {channel?.status === 'CONNECTING' && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                    <span className="font-medium">{channel?.displayName ?? 'Canal Principal'}</span>
                    <StatusBadge status={channel?.status === 'QR' ? 'CONNECTING' : (channel?.status || 'DISCONNECTED')} />
                  </div>
                   {channel?.status === 'CONNECTED' ? (
                     <span className="text-sm text-muted-foreground">{channel.phoneE164}</span>
                   ) : (
                    <Button variant="outline" onClick={() => setQrModalOpen(true)} disabled={channel?.status === 'CONNECTING' || !channel?.qrDataUrl}>{t('scan.qr.code')}</Button>
                   )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Button variant="outline" onClick={handleApiCall.bind(null, '/qr', 'Generando código QR...', 'Error al solicitar QR')} disabled={isLoading || !workerUrl}><ScanQrCode className="mr-2 h-4 w-4" />Generar QR</Button>
                  <Button variant="outline" onClick={handleApiCall.bind(null, '/resetSession', 'Reiniciando sesión...', 'Error al reiniciar sesión')} disabled={isLoading || !workerUrl}><RotateCcw className="mr-2 h-4 w-4" />Reiniciar Sesión</Button>
                  <Button variant="destructive" onClick={handleApiCall.bind(null, '/disconnect', 'Desconectando...', 'Error al desconectar')} disabled={isLoading || !workerUrl || channel?.status !== 'CONNECTED'}><LogOut className="mr-2 h-4 w-4" />Desconectar</Button>
                </div>
                 {channel?.lastError && (
                   <Alert variant="destructive"><AlertTitle>Último Error</AlertTitle><AlertDescription>{channel.lastError?.message || JSON.stringify(channel.lastError)}</AlertDescription></Alert>
                 )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex flex-col items-center justify-center gap-4 h-full">
                {isLoading ? <Skeleton className="w-64 h-64" /> : channel?.status === 'QR' && channel.qrDataUrl ? (
                   <div className="w-64 h-64 rounded-lg bg-white p-4 flex items-center justify-center"><img src={channel.qrDataUrl} alt="WhatsApp QR" width={224} height={224} /></div>
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg"><p className="text-center text-sm text-muted-foreground p-4">{channel?.status === 'CONNECTING' ? 'Generando QR...' : 'QR no disponible.'}</p></div>
                )}
                 <p className="text-center text-sm text-muted-foreground">{t('scan.qr.instruction')}</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="chats" className="m-0 border-none outline-none">
          {workerUrl && <ChatInterface channelId={channelId} blocked={isBlocked} funnelStages={channel?.funnelConfig?.stages || DEFAULT_STAGES} />}
        </TabsContent>

        <TabsContent value="chatbot" className="m-0 border-none outline-none">
          <ChatbotConfig channelId={channelId} blocked={isBlocked} />
        </TabsContent>

        <TabsContent value="funnel" className="m-0 border-none outline-none">
          <SalesFunnel channelId={channelId} blocked={isBlocked} channel={channel} />
        </TabsContent>

        <TabsContent value="contacts" className="m-0 border-none outline-none">
          <ContactsView channelId={channelId} />
        </TabsContent>

        <TabsContent value="labels" className="m-0 border-none outline-none">
          <LabelsView channelId={channelId} />
        </TabsContent>
      </Tabs>

      <QrCodeDialog qrDataUrl={channel?.qrDataUrl ?? null} isOpen={isQrModalOpen} onOpenChange={setQrModalOpen} />
    </main>
  );
}

function LabelsView({ channelId }: { channelId: string }) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const labelsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'channels', channelId, 'labels'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, channelId]);

  const { data: labels, isLoading } = useCollection<ChannelLabel>(labelsQuery);

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<ChannelLabel | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirmation state
  const [deletingLabel, setDeletingLabel] = useState<ChannelLabel | null>(null);

  const openCreate = () => {
    setEditingLabel(null);
    setFormName('');
    setFormDescription('');
    setIsFormOpen(true);
  };

  const openEdit = (label: ChannelLabel) => {
    setEditingLabel(label);
    setFormName(label.name);
    setFormDescription(label.description || '');
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!firestore || !user || !formName.trim()) return;
    setIsSaving(true);
    try {
      if (editingLabel) {
        const ref = doc(firestore, 'channels', channelId, 'labels', editingLabel.id);
        await updateDoc(ref, {
          name: formName.trim(),
          description: formDescription.trim() || null,
          updatedAt: serverTimestamp(),
        });
        toast({ title: 'Etiqueta actualizada' });
      } else {
        const ref = collection(firestore, 'channels', channelId, 'labels');
        await addDoc(ref, {
          name: formName.trim(),
          description: formDescription.trim() || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast({ title: 'Etiqueta creada' });
      }
      setIsFormOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al guardar etiqueta' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!firestore || !deletingLabel) return;
    try {
      await deleteDoc(doc(firestore, 'channels', channelId, 'labels', deletingLabel.id));
      toast({ title: 'Etiqueta eliminada' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al eliminar etiqueta' });
    } finally {
      setDeletingLabel(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          Etiquetas
          <Badge variant="secondary" className="ml-1">{labels?.length ?? 0}</Badge>
        </h3>
        <Button size="sm" onClick={openCreate}>
          <PlusCircle className="h-4 w-4 mr-2" />
          Nueva etiqueta
        </Button>
      </div>

      {(!labels || labels.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <Tag className="h-12 w-12 opacity-20" />
          <p className="text-sm">Aún no hay etiquetas creadas.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {labels.map((label) => (
            <Card key={label.id} className="shadow-none">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex items-center justify-center size-7 rounded-full bg-primary/10 shrink-0">
                      <Tag className="size-3.5 text-primary" />
                    </div>
                    <p className="font-semibold text-sm truncate">{label.name}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(label)}>
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeletingLabel(label)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {label.description && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{label.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLabel ? 'Editar etiqueta' : 'Nueva etiqueta'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="label-name">Nombre <span className="text-destructive">*</span></Label>
              <Input
                id="label-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ej: Cliente VIP"
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-description">Descripción (opcional)</Label>
              <Textarea
                id="label-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Breve descripción de esta etiqueta"
                className="min-h-[80px]"
                disabled={isSaving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!formName.trim() || isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingLabel} onOpenChange={(open) => { if (!open) setDeletingLabel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar etiqueta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la etiqueta <strong>"{deletingLabel?.name}"</strong>. Esta acción no borra contactos ni conversaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContactsView({ channelId }: { channelId: string }) {
  const firestore = useFirestore();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const conversationsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'channels', channelId, 'conversations'),
      orderBy('lastMessageAt', 'desc'),
      limit(200)
    );
  }, [firestore, channelId]);

  const labelsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'channels', channelId, 'labels'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, channelId]);

  const { data: conversations, isLoading } = useCollection<Conversation>(conversationsQuery);
  const { data: labels } = useCollection<ChannelLabel>(labelsQuery);

  const tagById = useMemo(() => {
    const map = new Map<string, ChannelLabel>();
    labels?.forEach(l => map.set(l.id, l));
    return map;
  }, [labels]);

  const contacts = useMemo(() => {
    if (!conversations) return [];
    return conversations.filter(
      (conv) => conv.isContact === true || conv.customer?.isContact === true
    );
  }, [conversations]);

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          Contactos
          <Badge variant="secondary" className="ml-1">{contacts.length}</Badge>
        </h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setIsImportOpen(true)} id="btn-import-contacts">
            <Upload className="h-4 w-4 mr-2" />
            Importar
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)} id="btn-add-contact">
            <UserPlus className="h-4 w-4 mr-2" />
            Nuevo contacto
          </Button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <User className="h-12 w-12 opacity-20" />
          <p className="text-sm">Aún no hay contactos guardados.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Importar CSV/Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Agregar contacto
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {contacts.map((conv) => (
            <ContactCard
              key={conv.id}
              conv={conv}
              channelId={channelId}
              tags={labels || []}
              tagById={tagById}
            />
          ))}
        </div>
      )}

      <CreateContactDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        channelId={channelId}
      />

      <ImportContactsDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        channelId={channelId}
        existingConversations={conversations || []}
        existingLabels={labels || []}
      />
    </div>
  );
}

// ─── CreateContactDialog ─────────────────────────────────────────────────────

function CreateContactDialog({
  open,
  onOpenChange,
  channelId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channelId: string;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    notes: '',
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setFormData({ name: '', phone: '', email: '', company: '', notes: '' });
    }
  }, [open]);

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      toast({
        variant: 'destructive',
        title: 'Campos obligatorios',
        description: 'Nombre y Teléfono son requeridos.',
      });
      return;
    }
    if (!firestore) return;
    setIsSaving(true);
    try {
      const colRef = collection(firestore, 'channels', channelId, 'conversations');
      await addDoc(colRef, {
        // Contact identity – no jid / conversationId for manual contacts
        jid: null,
        type: 'user',
        name: formData.name.trim(),
        displayName: formData.name.trim(),
        phoneE164: formData.phone.trim() || null,
        lastMessageText: null,
        lastMessageAt: null,
        unreadCount: 0,
        isContact: true,
        labelIds: [],
        source: 'manual',
        customer: {
          name: formData.name.trim(),
          phone: formData.phone.trim() || null,
          email: formData.email.trim() || null,
          company: formData.company.trim() || null,
          notes: formData.notes.trim() || null,
          isContact: true,
          source: 'manual',
          updatedAt: serverTimestamp(),
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'Contacto creado', description: formData.name.trim() });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[CreateContactDialog] error', e);
      toast({ variant: 'destructive', title: 'Error al crear contacto', description: e?.message || String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar contacto</DialogTitle>
          <DialogDescription>Crea un contacto manual para este canal.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="create-contact-name" className="flex items-center gap-1">
              Nombre <span className="text-destructive">*</span>
            </Label>
            <Input
              id="create-contact-name"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nombre completo"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-contact-phone" className="flex items-center gap-1">
              Teléfono <span className="text-destructive">*</span>
            </Label>
            <Input
              id="create-contact-phone"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+52..."
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-contact-email">Email</Label>
            <Input
              id="create-contact-email"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              placeholder="correo@ejemplo.com"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-contact-company">Empresa</Label>
            <Input
              id="create-contact-company"
              value={formData.company}
              onChange={e => setFormData({ ...formData, company: e.target.value })}
              placeholder="Nombre de la empresa"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-contact-notes">Notas</Label>
            <Textarea
              id="create-contact-notes"
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Notas adicionales..."
              disabled={isSaving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !formData.name.trim() || !formData.phone.trim()}
          >
            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
            Crear contacto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ImportContactsDialog ─────────────────────────────────────────────────────

/** Normalise a phone string for deduplication comparison */
function normalisePhone(p: string | null | undefined): string {
  if (!p) return '';
  return p.replace(/[\s\-().+]/g, '').toLowerCase();
}

/** Normalise a label name for deduplication comparison */
function normaliseLabelName(n: string): string {
  return n.trim().toLowerCase();
}

interface ImportRow {
  rowNum: number;
  nombre: string;
  telefono: string;
  email: string;
  empresa: string;
  notas: string;
  etiquetas: string[];   // raw label names from file
  error: string | null;
}

type ImportPhase = 'upload' | 'preview' | 'importing' | 'done';

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  labelsCreated: number;
}

function ImportContactsDialog({
  open,
  onOpenChange,
  channelId,
  existingConversations,
  existingLabels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channelId: string;
  existingConversations: Conversation[];
  existingLabels: ChannelLabel[];
}) {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [phase, setPhase] = useState<ImportPhase>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = rows.filter(r => !r.error);
  const errorRows = rows.filter(r => r.error);
  // Unique label names across all valid rows
  const detectedLabels = useMemo(() => {
    const set = new Set<string>();
    validRows.forEach(r => r.etiquetas.forEach(e => set.add(e)));
    return Array.from(set).sort();
  }, [validRows]);

  // Reset when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setPhase('upload');
        setRows([]);
        setFileName('');
        setProgress(0);
        setResult(null);
        setIsDragging(false);
      }, 300);
    }
  }, [open]);

  /** Parse raw row object from xlsx into ImportRow */
  function parseRawRow(rawRow: Record<string, any>, rowNum: number): ImportRow {
    // Flexible column name matching (case-insensitive)
    const get = (keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(rawRow).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
        if (found && rawRow[found] != null) return String(rawRow[found]).trim();
      }
      return '';
    };

    const nombre = get(['nombre', 'name', 'nombre completo', 'full name', 'contacto']);
    const telefono = get(['telefono', 'teléfono', 'phone', 'tel', 'celular', 'móvil', 'movil', 'whatsapp']);
    const email = get(['email', 'correo', 'e-mail', 'mail']);
    const empresa = get(['empresa', 'company', 'compañia', 'compañía', 'negocio']);
    const notas = get(['notas', 'notes', 'nota', 'comentarios', 'observaciones']);
    const etiquetasRaw = get(['etiquetas', 'tags', 'labels', 'etiqueta', 'tag', 'label']);

    const etiquetas = etiquetasRaw
      ? etiquetasRaw.split(',').map(e => e.trim()).filter(Boolean)
      : [];

    let error: string | null = null;
    if (!nombre && !telefono) error = 'Fila vacía';
    else if (!nombre) error = 'Falta nombre';
    else if (!telefono) error = 'Falta teléfono';

    return { rowNum, nombre, telefono, email, empresa, notas, etiquetas, error };
  }

  /** Parse a file (csv / xlsx / xls) using dynamic import of xlsx library */
  async function parseFile(file: File): Promise<ImportRow[]> {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: '',
      raw: false,
    });

    return rawRows
      .map((row, i) => parseRawRow(row, i + 2)) // +2 because row 1 is header
      .filter(r => !(r.error === 'Fila vacía' && !r.nombre && !r.telefono && !r.email)); // skip fully blank rows
  }

  async function handleFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
      toast({ variant: 'destructive', title: 'Formato no soportado', description: 'Solo se aceptan archivos .csv, .xlsx y .xls' });
      return;
    }
    try {
      setFileName(file.name);
      const parsed = await parseFile(file);
      setRows(parsed);
      setPhase('preview');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al leer el archivo', description: e?.message || String(e) });
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ''; // allow re-selecting same file
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  /** Main import handler — runs after user confirms preview */
  async function handleImport() {
    if (!firestore || validRows.length === 0) return;
    setPhase('importing');
    setProgress(0);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let labelsCreated = 0;

    try {
      // ── Step 1: Resolve / create labels ──────────────────────────────────────
      // Build a map: normalisedName → labelId
      const labelMap = new Map<string, string>();
      existingLabels.forEach(l => labelMap.set(normaliseLabelName(l.name), l.id));

      const labelsColRef = collection(firestore, 'channels', channelId, 'labels');

      for (const labelName of detectedLabels) {
        const key = normaliseLabelName(labelName);
        if (!labelMap.has(key)) {
          // Create missing label
          const newLabelRef = await addDoc(labelsColRef, {
            name: labelName,
            description: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          labelMap.set(key, newLabelRef.id);
          labelsCreated++;
        }
      }

      // ── Step 2: Build phone → existing contact map ────────────────────────────
      // Use existing conversations passed in (already loaded, real-time)
      const phoneToConv = new Map<string, Conversation>();
      existingConversations.forEach(conv => {
        const p1 = normalisePhone(conv.phoneE164);
        const p2 = normalisePhone(conv.customer?.phone);
        if (p1) phoneToConv.set(p1, conv);
        if (p2 && p2 !== p1) phoneToConv.set(p2, conv);
      });

      // ── Step 3: Process each valid row ────────────────────────────────────────
      const convsColRef = collection(firestore, 'channels', channelId, 'conversations');
      const total = validRows.length;

      for (let i = 0; i < total; i++) {
        const row = validRows[i];
        setProgress(Math.round(((i + 1) / total) * 100));

        const normPhone = normalisePhone(row.telefono);
        const newLabelIds = row.etiquetas
          .map(e => labelMap.get(normaliseLabelName(e)))
          .filter((id): id is string => !!id);

        const existing = phoneToConv.get(normPhone);

        if (existing) {
          // ── UPDATE existing contact ─────────────────────────────────────────
          const convRef = doc(firestore, 'channels', channelId, 'conversations', existing.id);
          // Merge label IDs (add new, keep old)
          const existingLabelIds = existing.labelIds || [];
          const mergedLabelIds = Array.from(new Set([...existingLabelIds, ...newLabelIds]));

          const updatePayload: Record<string, any> = {
            isContact: true,
            labelIds: mergedLabelIds,
            updatedAt: serverTimestamp(),
          };

          // Only overwrite optional fields if they come from the file
          const customerUpdate: Record<string, any> = {
            ...(existing.customer || {}),
            name: row.nombre || existing.customer?.name || '',
            phone: row.telefono || existing.customer?.phone || null,
            isContact: true,
            source: existing.customer?.source || 'import',
            updatedAt: serverTimestamp(),
          };
          if (row.email) customerUpdate.email = row.email;
          if (row.empresa) customerUpdate.company = row.empresa;
          if (row.notas) customerUpdate.notes = row.notas;

          updatePayload.customer = customerUpdate;
          // Also keep displayName fresh
          if (row.nombre) {
            updatePayload.displayName = row.nombre;
            updatePayload.name = row.nombre;
          }

          await updateDoc(convRef, updatePayload);
          updated++;
        } else {
          // ── CREATE new contact ──────────────────────────────────────────────
          await addDoc(convsColRef, {
            jid: null,
            type: 'user',
            name: row.nombre,
            displayName: row.nombre,
            phoneE164: row.telefono || null,
            lastMessageText: null,
            lastMessageAt: null,
            unreadCount: 0,
            isContact: true,
            labelIds: newLabelIds,
            source: 'import',
            customer: {
              name: row.nombre,
              phone: row.telefono || null,
              email: row.email || null,
              company: row.empresa || null,
              notes: row.notas || null,
              isContact: true,
              source: 'import',
              updatedAt: serverTimestamp(),
            },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          created++;
        }
      }

      setResult({ created, updated, skipped, labelsCreated });
      setPhase('done');
    } catch (e: any) {
      console.error('[ImportContactsDialog] error', e);
      toast({
        variant: 'destructive',
        title: 'Error durante la importación',
        description: e?.message || String(e),
      });
      setPhase('preview');
    }
  }

  // ── Preview table (capped at 50 visible rows) ──────────────────────────────
  const PREVIEW_CAP = 50;

  return (
    <Dialog open={open} onOpenChange={phase === 'importing' ? undefined : onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            {phase === 'upload' && 'Importar contactos'}
            {phase === 'preview' && 'Previsualización de importación'}
            {phase === 'importing' && 'Importando contactos...'}
            {phase === 'done' && 'Importación completada'}
          </DialogTitle>
          <DialogDescription>
            {phase === 'upload' && 'Sube un archivo CSV o Excel con tus contactos.'}
            {phase === 'preview' && `${validRows.length} contacto${validRows.length !== 1 ? 's' : ''} válido${validRows.length !== 1 ? 's' : ''} · ${errorRows.length} con error`}
            {phase === 'importing' && `Procesando... ${progress}%`}
            {phase === 'done' && 'Los contactos ya están disponibles en tu lista.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── PHASE: UPLOAD ───────────────────────────────────────────────── */}
          {phase === 'upload' && (
            <div className="space-y-4 py-2">
              {/* Drag-and-drop zone */}
              <div
                className={cn(
                  'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'
                )}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium mb-1">Arrastra tu archivo aquí</p>
                <p className="text-xs text-muted-foreground">o haz clic para seleccionar</p>
                <p className="text-xs text-muted-foreground mt-2">Formatos aceptados: .csv · .xlsx · .xls</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={onFileInputChange}
                />
              </div>

              {/* Format instructions */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Formato esperado</p>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full border-collapse">
                    <thead>
                      <tr className="border-b">
                        {['nombre *', 'telefono *', 'email', 'empresa', 'notas', 'etiquetas'].map(h => (
                          <th key={h} className="text-left py-1 pr-3 font-semibold text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-1 pr-3 text-foreground">Juan López</td>
                        <td className="py-1 pr-3 text-foreground">+5213141234</td>
                        <td className="py-1 pr-3 text-muted-foreground">juan@mail.com</td>
                        <td className="py-1 pr-3 text-muted-foreground">Acme SA</td>
                        <td className="py-1 pr-3 text-muted-foreground">Cliente frecuente</td>
                        <td className="py-1 pr-3 text-muted-foreground">VIP, Prospecto</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground">* Columnas obligatorias. Las etiquetas se separan por coma.</p>
              </div>
            </div>
          )}

          {/* ── PHASE: PREVIEW ─────────────────────────────────────────────── */}
          {phase === 'preview' && (
            <div className="space-y-4 py-2">
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-medium">
                  <CheckCircle className="h-3 w-3" />
                  {validRows.length} válido{validRows.length !== 1 ? 's' : ''}
                </span>
                {errorRows.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 font-medium">
                    <AlertTriangle className="h-3 w-3" />
                    {errorRows.length} con error
                  </span>
                )}
                {detectedLabels.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
                    <Tag className="h-3 w-3" />
                    {detectedLabels.length} etiqueta{detectedLabels.length !== 1 ? 's' : ''} detectada{detectedLabels.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Detected labels */}
              {detectedLabels.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Etiquetas detectadas (se crearán si no existen):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedLabels.map(label => {
                      const exists = existingLabels.some(l => normaliseLabelName(l.name) === normaliseLabelName(label));
                      return (
                        <span
                          key={label}
                          className={cn(
                            'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium',
                            exists
                              ? 'bg-primary/10 text-primary'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                          )}
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {label}
                          {!exists && <span className="opacity-60 ml-0.5">(nueva)</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Valid rows table */}
              {validRows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Contactos a importar{validRows.length > PREVIEW_CAP ? ` (mostrando ${PREVIEW_CAP} de ${validRows.length})` : ''}:
                  </p>
                  <div className="rounded-lg border overflow-hidden">
                    <div className="overflow-x-auto max-h-48">
                      <table className="text-xs w-full">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            {['Nombre', 'Teléfono', 'Email', 'Empresa', 'Etiquetas'].map(h => (
                              <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {validRows.slice(0, PREVIEW_CAP).map(row => (
                            <tr key={row.rowNum} className="border-t hover:bg-muted/20">
                              <td className="px-3 py-1.5 font-medium truncate max-w-[120px]">{row.nombre}</td>
                              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{row.telefono}</td>
                              <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[120px]">{row.email || '—'}</td>
                              <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[100px]">{row.empresa || '—'}</td>
                              <td className="px-3 py-1.5">
                                {row.etiquetas.length > 0 ? (
                                  <div className="flex flex-wrap gap-0.5">
                                    {row.etiquetas.slice(0, 3).map(e => (
                                      <span key={e} className="inline-block bg-primary/10 text-primary rounded px-1 py-0.5 text-[10px]">{e}</span>
                                    ))}
                                    {row.etiquetas.length > 3 && (
                                      <span className="text-muted-foreground text-[10px]">+{row.etiquetas.length - 3}</span>
                                    )}
                                  </div>
                                ) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Error rows */}
              {errorRows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Filas con error (se omitirán):</p>
                  <div className="rounded-lg border border-red-200 dark:border-red-900/40 overflow-hidden">
                    <div className="overflow-x-auto max-h-32">
                      <table className="text-xs w-full">
                        <thead className="bg-red-50 dark:bg-red-900/20 sticky top-0">
                          <tr>
                            {['Fila', 'Nombre', 'Teléfono', 'Error'].map(h => (
                              <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {errorRows.map(row => (
                            <tr key={row.rowNum} className="border-t bg-red-50/30 dark:bg-red-900/10">
                              <td className="px-3 py-1.5 text-muted-foreground">{row.rowNum}</td>
                              <td className="px-3 py-1.5">{row.nombre || '—'}</td>
                              <td className="px-3 py-1.5">{row.telefono || '—'}</td>
                              <td className="px-3 py-1.5 text-red-600 dark:text-red-400 font-medium">{row.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PHASE: IMPORTING ───────────────────────────────────────────── */}
          {phase === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="w-full max-w-xs space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Importando contactos...</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">No cierres esta ventana.</p>
            </div>
          )}

          {/* ── PHASE: DONE ────────────────────────────────────────────────── */}
          {phase === 'done' && result && (
            <div className="py-6 space-y-4">
              <div className="flex items-center justify-center">
                <div className="flex items-center justify-center size-16 rounded-full bg-green-100 dark:bg-green-900/30">
                  <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Creados', value: result.created, color: 'text-green-600 dark:text-green-400' },
                  { label: 'Actualizados', value: result.updated, color: 'text-blue-600 dark:text-blue-400' },
                  { label: 'Con error', value: result.skipped + errorRows.length, color: 'text-red-500 dark:text-red-400' },
                  { label: 'Etiquetas creadas', value: result.labelsCreated, color: 'text-primary' },
                ].map(stat => (
                  <div key={stat.label} className="rounded-lg border bg-muted/30 p-3 text-center">
                    <p className={cn('text-2xl font-bold', stat.color)}>{stat.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-center text-muted-foreground">
                Los contactos importados ya aparecen en la lista.
              </p>
            </div>
          )}

        </div>

        {/* ── Footer buttons ────────────────────────────────────────────────── */}
        <DialogFooter className="pt-2 border-t gap-2">
          {phase === 'upload' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          )}
          {phase === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setPhase('upload')}>
                Cambiar archivo
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0}
              >
                <Upload className="h-4 w-4 mr-2" />
                Importar {validRows.length} contacto{validRows.length !== 1 ? 's' : ''}
              </Button>
            </>
          )}
          {phase === 'done' && (
            <Button onClick={() => onOpenChange(false)}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Listo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ContactLabelChips ────────────────────────────────────────────────────────

const MAX_VISIBLE_TAGS = 3;

function ContactLabelChips({
  labelIds,
  tagById,
}: {
  labelIds: string[];
  tagById: Map<string, ChannelLabel>;
}) {
  const resolved = labelIds
    .map(id => tagById.get(id))
    .filter((l): l is ChannelLabel => !!l);

  if (resolved.length === 0) return null;

  const visible = resolved.slice(0, MAX_VISIBLE_TAGS);
  const overflow = resolved.slice(MAX_VISIBLE_TAGS);

  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      {visible.map(label => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium leading-none"
        >
          <Tag className="size-2.5 shrink-0" />
          <span className="max-w-[80px] truncate">{label.name}</span>
        </span>
      ))}
      {overflow.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium leading-none hover:bg-muted/80 transition-colors cursor-pointer"
              type="button"
            >
              +{overflow.length} más
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3" align="start">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <Tags className="size-3" /> Todas las etiquetas
            </p>
            <div className="flex flex-wrap gap-1">
              {resolved.map(label => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium leading-none"
                >
                  <Tag className="size-2.5 shrink-0" />
                  {label.name}
                </span>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ─── AssignLabelsDialog ───────────────────────────────────────────────────────

function AssignLabelsDialog({
  open,
  onOpenChange,
  conv,
  channelId,
  tags,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conv: Conversation;
  channelId: string;
  tags: ChannelLabel[];
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Sync local state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedIds(conv.labelIds || []);
      setSearch('');
    }
  }, [open, conv.labelIds]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.trim().toLowerCase();
    return tags.filter(t => t.name.toLowerCase().includes(q));
  }, [tags, search]);

  const toggle = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!firestore) return;
    setIsSaving(true);
    try {
      const convRef = doc(firestore, 'channels', channelId, 'conversations', conv.id);
      await updateDoc(convRef, { labelIds: selectedIds });
      toast({ title: 'Etiquetas guardadas' });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[AssignLabelsDialog] save error', e);
      toast({ variant: 'destructive', title: 'Error al guardar', description: e?.message || String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const displayName =
    conv.customer?.name ||
    (conv.displayName && conv.displayName !== conv.jid ? conv.displayName : null) ||
    (conv.name && conv.name !== conv.jid ? conv.name : null) ||
    conv.phoneE164 ||
    conv.jid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-primary" />
            Asignar etiquetas
          </DialogTitle>
          <DialogDescription className="truncate text-xs">{displayName}</DialogDescription>
        </DialogHeader>

        {tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground gap-2">
            <Tag className="h-8 w-8 opacity-20" />
            <p className="text-sm">No hay etiquetas creadas todavía.</p>
            <p className="text-xs opacity-70">Crea etiquetas desde la sección <strong>Etiquetas</strong>.</p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Buscar etiqueta..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch('')}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
              {filtered.length === 0 ? (
                <p className="text-xs text-center text-muted-foreground py-4">Sin resultados.</p>
              ) : (
                filtered.map(tag => {
                  const checked = selectedIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-2 cursor-pointer transition-colors select-none',
                        checked ? 'bg-primary/8' : 'hover:bg-muted/60'
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(tag.id)}
                        id={`label-chk-${tag.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-none truncate">{tag.name}</p>
                        {tag.description && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{tag.description}</p>
                        )}
                      </div>
                      {checked && (
                        <span className="shrink-0 size-1.5 rounded-full bg-primary" />
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          {tags.length > 0 && (
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Guardar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ContactCard ──────────────────────────────────────────────────────────────

function ContactCard({
  conv,
  channelId,
  tags,
  tagById,
}: {
  conv: Conversation;
  channelId: string;
  tags: ChannelLabel[];
  tagById: Map<string, ChannelLabel>;
}) {
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const displayName =
    conv.customer?.name ||
    (conv.displayName && conv.displayName !== conv.jid ? conv.displayName : null) ||
    (conv.name && conv.name !== conv.jid ? conv.name : null) ||
    conv.phoneE164 ||
    conv.jid ||
    'Sin nombre';

  const phone = conv.customer?.phone || conv.phoneE164 || null;
  const email = conv.customer?.email || null;
  const company = conv.customer?.company || null;
  const notes = conv.customer?.notes || null;

  return (
    <>
      <Card className="shadow-none">
        <CardContent className="p-4 space-y-2">
          {/* Header: avatar + name + action buttons */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 shrink-0">
              <User className="size-4 text-primary" />
            </div>
            <p className="font-semibold text-sm truncate flex-1">{displayName}</p>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setEditOpen(true)}
              title="Editar contacto"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setLabelsOpen(true)}
              title="Administrar etiquetas"
            >
              <Tags className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              title="Eliminar contacto"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Contact details */}
          {phone && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium min-w-[52px]">Teléfono:</span>
              <span>{phone}</span>
            </div>
          )}
          {email && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium min-w-[52px]">Email:</span>
              <span className="truncate">{email}</span>
            </div>
          )}
          {company && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium min-w-[52px]">Empresa:</span>
              <span className="truncate">{company}</span>
            </div>
          )}
          {notes && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="font-medium min-w-[52px] pt-0.5">Notas:</span>
              <span className="line-clamp-3 whitespace-pre-line">{notes}</span>
            </div>
          )}

          {/* Label chips */}
          {conv.labelIds && conv.labelIds.length > 0 && (
            <ContactLabelChips labelIds={conv.labelIds} tagById={tagById} />
          )}
        </CardContent>
      </Card>

      <AssignLabelsDialog
        open={labelsOpen}
        onOpenChange={setLabelsOpen}
        conv={conv}
        channelId={channelId}
        tags={tags}
      />

      <EditContactDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        conv={conv}
        channelId={channelId}
      />

      <DeleteContactDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        conv={conv}
        channelId={channelId}
        displayName={displayName}
      />
    </>
  );
}

// ─── DeleteContactDialog ──────────────────────────────────────────────────────

function DeleteContactDialog({
  open,
  onOpenChange,
  conv,
  channelId,
  displayName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conv: Conversation;
  channelId: string;
  displayName: string;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  // A "manual" contact has no real WhatsApp jid (jid is null/undefined or doesn't end in @s.whatsapp.net)
  const isManualContact = !conv.jid || conv.jid === null;

  const handleDelete = async () => {
    if (!firestore) return;
    setIsDeleting(true);
    try {
      const convRef = doc(firestore, 'channels', channelId, 'conversations', conv.id);

      if (isManualContact) {
        // Manual contact: safe to delete the whole document — no real conversation exists
        await deleteDoc(convRef);
      } else {
        // Real conversation: only remove contact fields, preserve conversation + messages
        await updateDoc(convRef, {
          isContact: false,
          customer: null,
          labelIds: [],
          updatedAt: serverTimestamp(),
        });
      }

      toast({ title: 'Contacto eliminado' });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[DeleteContactDialog] error', e);
      toast({
        variant: 'destructive',
        title: 'Error al eliminar contacto',
        description: e?.message || String(e),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar contacto?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Se eliminará <strong className="text-foreground">{displayName}</strong> de tu lista de contactos.
              </p>
              <p>Esta acción eliminará únicamente el contacto. No se eliminará la conversación ni el historial de mensajes asociado.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleDelete(); }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Eliminar contacto
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}


// ─── EditContactDialog ────────────────────────────────────────────────────────

function EditContactDialog({
  open,
  onOpenChange,
  conv,
  channelId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conv: Conversation;
  channelId: string;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    notes: '',
  });

  useEffect(() => {
    if (open) {
      setFormData({
        name: conv.customer?.name || conv.displayName || conv.name || '',
        phone: conv.customer?.phone || conv.phoneE164 || '',
        email: conv.customer?.email || '',
        company: conv.customer?.company || '',
        notes: conv.customer?.notes || '',
      });
    }
  }, [open, conv]);

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.phone.trim()) {
      toast({
        variant: 'destructive',
        title: 'Campos obligatorios',
        description: 'Nombre y Teléfono son requeridos.',
      });
      return;
    }
    if (!firestore) return;
    setIsSaving(true);
    try {
      // Use conv.id (Firestore doc ID) — works for both manual and real contacts
      const convRef = doc(firestore, 'channels', channelId, 'conversations', conv.id);
      await updateDoc(convRef, {
        displayName: formData.name.trim(),
        name: formData.name.trim(),
        phoneE164: formData.phone.trim() || null,
        isContact: true,
        customer: {
          ...(conv.customer || {}),
          name: formData.name.trim(),
          phone: formData.phone.trim() || null,
          email: formData.email.trim() || null,
          company: formData.company.trim() || null,
          notes: formData.notes.trim() || null,
          isContact: true,
          source: (conv.customer?.source as any) || 'manual',
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'Contacto actualizado' });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[EditContactDialog] error', e);
      toast({ variant: 'destructive', title: 'Error al actualizar contacto', description: e?.message || String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modificar contacto</DialogTitle>
          <DialogDescription>Actualiza la información manual de este contacto.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-contact-name" className="flex items-center gap-1">
              Nombre <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-contact-name"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nombre completo"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-contact-phone" className="flex items-center gap-1">
              Teléfono <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-contact-phone"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+52..."
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-contact-email">Email</Label>
            <Input
              id="edit-contact-email"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              placeholder="correo@ejemplo.com"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-contact-company">Empresa</Label>
            <Input
              id="edit-contact-company"
              value={formData.company}
              onChange={e => setFormData({ ...formData, company: e.target.value })}
              placeholder="Nombre de la empresa"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-contact-notes">Notas</Label>
            <Textarea
              id="edit-contact-notes"
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Notas adicionales..."
              disabled={isSaving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !formData.name.trim() || !formData.phone.trim()}
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SalesFunnel({ channelId, blocked, channel }: { channelId: string, blocked: boolean, channel: WhatsappChannel | null | undefined }) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingStages, setEditingStages] = useState<FunnelStageConfig[]>([]);

  const stages = channel?.funnelConfig?.stages || DEFAULT_STAGES;

  const conversationsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'conversations'), orderBy('lastMessageAt', 'desc'), limit(150));
  }, [firestore, channelId]);

  const { data: conversations, isLoading } = useCollection<Conversation>(conversationsQuery);

  const handleOpenSettings = () => {
    setEditingStages(JSON.parse(JSON.stringify(stages)));
    setIsSettingsOpen(true);
  };

  const handleSaveStages = async () => {
    if (!firestore || !channelId) return;
    try {
      const ref = doc(firestore, 'channels', channelId);
      await updateDoc(ref, {
        "funnelConfig.stages": editingStages,
        updatedAt: serverTimestamp()
      });
      toast({ title: 'Nombres de etapas actualizados' });
      setIsSettingsOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al guardar etapas' });
    }
  };

  const updateStageName = (id: number, name: string) => {
    setEditingStages(prev => prev.map(s => s.id === id ? { ...s, name } : s));
  };

  const moveConversation = async (jid: string, newStage: number) => {
    if (!firestore || blocked) return;
    try {
      const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
      await updateDoc(convRef, { funnelStage: newStage, updatedAt: serverTimestamp() });
      toast({ title: 'Conversación movida' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al mover' });
    }
  };

  const handleConversationClick = (jid: string) => {
    router.push(`/channels/${channelId}?tab=chats&jid=${encodeURIComponent(jid)}&source=funnel`);
  };

  if (isLoading) return <div className="flex h-[400px] items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" />
          Seguimiento Comercial
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenSettings} disabled={blocked}>
            <Settings2 className="h-4 w-4 mr-2" />
            Configurar Etapas
          </Button>
        </div>
      </div>

      <ScrollArea className="w-full pb-4">
        <div className="flex gap-4 min-w-[1200px]">
          {stages.map((stage) => {
            const stageConvs = conversations?.filter(c => (c.funnelStage || 1) === stage.id) || [];
            return (
              <div key={stage.id} className="flex-1 min-w-[240px] flex flex-col gap-3">
                <div className="flex items-center justify-between px-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px]">{stage.id}</span>
                    {stage.name}
                  </h4>
                  <Badge variant="secondary" className="text-[10px]">{stageConvs.length}</Badge>
                </div>
                
                <div className="flex-1 bg-muted/30 rounded-lg p-2 flex flex-col gap-2 min-h-[500px]">
                  {stageConvs.map(conv => (
                    <Card 
                      key={conv.jid} 
                      className={cn("cursor-pointer hover:border-primary/50 transition-colors shadow-none")}
                      onClick={() => handleConversationClick(conv.jid)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <p className="text-xs font-bold truncate flex-1 flex items-center gap-1">
                            {(conv.isContact || conv.customer?.isContact) && <User className="size-3 text-primary" />}
                            {resolveConversationDisplayName(conv)}
                          </p>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={(e) => e.stopPropagation()}>
                                <ChevronRight className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Mover a etapa</DropdownMenuLabel>
                              {stages.filter(s => s.id !== stage.id).map(s => (
                                <DropdownMenuItem key={s.id} onClick={(e) => { e.stopPropagation(); moveConversation(conv.jid, s.id); }}>
                                  {s.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2 mb-2 italic">
                          {conv.lastMessageText || 'Sin mensajes'}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {conv.botEnabled === false && <Badge variant="outline" className="text-[8px] h-4 px-1 border-amber-500/20 text-amber-600">IA OFF</Badge>}
                          {conv.followupEnabled && !conv.followupStopped && <Badge variant="outline" className="text-[8px] h-4 px-1 bg-green-500/10 text-green-600 border-green-500/20">FU</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {stageConvs.length === 0 && (
                    <div className="flex flex-col items-center justify-center p-8 text-center opacity-20">
                      <LayoutGrid className="h-8 w-8 mb-2" />
                      <p className="text-[10px]">Vacío</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Configuración de Etapas */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Personalizar Etapas</DialogTitle>
            <DialogDescription>Define los nombres de las 5 etapas de tu embudo de ventas.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {editingStages.map((s) => (
              <div key={s.id} className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Etapa {s.id}</Label>
                <Input value={s.name} onChange={(e) => updateStageName(s.id, e.target.value)} className="col-span-3" />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveStages}>Guardar Nombres</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChatbotConfig({ channelId, blocked }: { channelId: string, blocked: boolean }) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState('training');

  const botRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId, 'runtime', 'bot');
  }, [firestore, channelId]);

  const { data: botConfig, isLoading: isBotLoading } = useDoc<BotConfig>(botRef);

  const [localProductContent, setLocalProductContent] = useState('');
  const [localSalesContent, setLocalSalesContent] = useState('');

  useEffect(() => {
    if (botConfig) {
      setLocalProductContent(botConfig.productDetails || '');
      setLocalSalesContent(botConfig.salesStrategy || '');
    }
  }, [botConfig]);

  const handleSaveBot = async (overrides: Partial<BotConfig> = {}) => {
    if (!firestore || !user || !botRef || blocked) return;
    
    const data = {
      enabled: overrides.enabled !== undefined ? overrides.enabled : (botConfig?.enabled || false),
      productDetails: overrides.productDetails !== undefined ? overrides.productDetails : localProductContent,
      salesStrategy: overrides.salesStrategy !== undefined ? overrides.salesStrategy : localSalesContent,
      model: GEMINI_MODEL_LOCKED,
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByEmail: user.email || '',
    };

    setDocumentNonBlocking(botRef, data, { merge: true });
    toast({ title: 'Configuración de IA guardada' });
  };

  const formatDate = (val: any) => {
    if (!val) return null;
    try {
      const date = val instanceof Timestamp ? val.toDate() : new Date(val);
      return format(date, 'PPpp');
    } catch (e) { return 'Recientemente'; }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="training" className="flex items-center gap-2"><Brain className="h-4 w-4" />Entrenamiento</TabsTrigger>
          <TabsTrigger value="visual" className="flex items-center gap-2"><ImageIcon className="h-4 w-4" />Respuestas Visuales</TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2"><FileText className="h-4 w-4" />Documentos</TabsTrigger>
          <TabsTrigger value="followup" className="flex items-center gap-2"><History className="h-4 w-4" />Seguimiento</TabsTrigger>
        </TabsList>

        <TabsContent value="training" className="space-y-4 pt-4">
          <div className="grid gap-4 md:grid-cols-2 mb-4">
            <Alert className="bg-primary/5 border-primary/20">
              <Info className="h-4 w-4" />
              <AlertTitle>Configuración de IA</AlertTitle>
              <AlertDescription>El bot responde automáticamente usando conocimiento base y estrategia de ventas.</AlertDescription>
            </Alert>
            {botConfig?.lastAutoReplyAt && (
              <Alert className="bg-green-500/5 border-green-500/20">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertTitle>Actividad del Bot</AlertTitle>
                <AlertDescription>Última respuesta: {formatDate(botConfig.lastAutoReplyAt)}</AlertDescription>
              </Alert>
            )}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-lg">Conocimiento y Estrategia</CardTitle>
                <CardDescription>Personaliza cómo el bot ayuda a tus clientes.</CardDescription>
              </div>
              <div className="flex items-center space-x-2">
                <Switch 
                  id="bot-enabled" 
                  checked={botConfig?.enabled || false} 
                  onCheckedChange={(checked) => handleSaveBot({ enabled: checked })}
                  disabled={isBotLoading || blocked}
                />
                <Label htmlFor="bot-enabled">IA Activada</Label>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {isBotLoading ? (
                <div className="space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Base de Conocimientos (Producto/Servicio)</Label>
                    <Textarea 
                      placeholder="Características, precios, horarios..." 
                      className="min-h-[150px]"
                      value={localProductContent}
                      onChange={(e) => setLocalProductContent(e.target.value)}
                      disabled={blocked}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Estrategia y Personalidad</Label>
                    <Textarea 
                      placeholder="Tono, preguntas clave, objetivos de venta..." 
                      className="min-h-[150px]"
                      value={localSalesContent}
                      onChange={(e) => setLocalSalesContent(e.target.value)}
                      disabled={blocked}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <History className="h-3 w-3" />
                      {botConfig?.updatedAt ? `Actualizado por ${botConfig.updatedByEmail} el ${formatDate(botConfig.updatedAt)}` : 'Sin datos'}
                    </div>
                    <Button onClick={() => handleSaveBot()} disabled={blocked}>
                      <Save className="mr-2 h-4 w-4" />
                      Guardar Conocimiento
                    </Button>
                  </div>
                  
                  {botConfig?.lastError && (
                    <Alert variant="destructive" className="mt-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Error en Auto-respuesta</AlertTitle>
                      <AlertDescription>
                        {botConfig.lastError}
                        <div className="mt-1 text-[10px] opacity-70">Detectado el: {formatDate(botConfig.lastErrorAt)}</div>
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="visual" className="pt-4">
          <VisualResponsesTab channelId={channelId} blocked={blocked} />
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <DocumentsTab channelId={channelId} />
        </TabsContent>

        <TabsContent value="followup" className="pt-4">
          <FollowupConfigTab channelId={channelId} blocked={blocked} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function VisualResponsesTab({ channelId, blocked }: { channelId: string, blocked: boolean }) {
  const { firestore, firebaseApp, user } = useFirebase();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingResponse, setEditingResponse] = useState<ImageResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const responsesRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'image_responses'), orderBy('priority', 'desc'));
  }, [firestore, channelId]);

  const { data: responses, isLoading } = useCollection<ImageResponse>(responsesRef);

  const handleOpenDialog = (resp: ImageResponse | null = null) => {
    setEditingResponse(resp);
    setSelectedFile(null);
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore || !firebaseApp || !user || blocked || isSaving) return;

    const formData = new FormData(e.currentTarget);
    const title = formData.get('title') as string;
    const keywordsRaw = formData.get('keywords') as string;
    const caption = formData.get('caption') as string;
    const priority = parseInt(formData.get('priority') as string) || 0;
    const enabled = formData.get('enabled') === 'on';

    const keywords = keywordsRaw.split(',').map(k => k.trim().toLowerCase()).filter(k => k);

    if (!title || keywords.length === 0) {
      toast({ variant: 'destructive', title: 'Campos incompletos', description: 'El título y las palabras clave son obligatorios.' });
      return;
    }

    if (!editingResponse && !selectedFile) {
      toast({ variant: 'destructive', title: 'Imagen faltante', description: 'Debes seleccionar una imagen para la respuesta.' });
      return;
    }

    setIsSaving(true);
    try {
      const respId = editingResponse?.id || Math.random().toString(36).substring(7);
      let storagePath = editingResponse?.storagePath || '';

      if (selectedFile) {
        const { getStorage, ref, uploadBytes } = await import('firebase/storage');
        const storage = getStorage(firebaseApp);
        const ext = selectedFile.name.split('.').pop() || 'jpg';
        storagePath = `channels/${channelId}/image_responses/${respId}/original.${ext}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, selectedFile);
      }

      const docRef = doc(firestore, 'channels', channelId, 'image_responses', respId);
      const data: Partial<ImageResponse> = {
        title,
        keywords,
        caption,
        storagePath,
        priority,
        enabled,
        updatedAt: serverTimestamp(),
      };

      if (!editingResponse) {
        data.createdAt = serverTimestamp();
      }

      await setDoc(docRef, data, { merge: true });
      toast({ title: 'Respuesta guardada' });
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (resp: ImageResponse) => {
    if (!firestore || !firebaseApp || blocked) return;
    try {
      const docRef = doc(firestore, 'channels', channelId, 'image_responses', resp.id);
      await deleteDoc(docRef);
      
      // Cleanup storage
      const { getStorage, ref, deleteObject } = await import('firebase/storage');
      const storage = getStorage(firebaseApp);
      const fileRef = ref(storage, resp.storagePath);
      await deleteObject(fileRef).catch(e => console.warn("Storage delete failed", e));

      toast({ title: 'Respuesta eliminada' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al eliminar', description: e.message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Respuestas Visuales (Imagen)</h3>
        <Button onClick={() => handleOpenDialog()} disabled={blocked}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Nueva Respuesta
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : responses?.length === 0 ? (
          <Card className="col-span-full border-dashed p-8 flex flex-col items-center justify-center text-muted-foreground">
            <ImageIcon className="h-12 w-12 mb-2 opacity-20" />
            <p>No hay respuestas visuales configuradas.</p>
          </Card>
        ) : (
          responses?.map(resp => (
            <Card key={resp.id} className="overflow-hidden flex flex-col">
              <div className="aspect-video relative bg-muted border-b overflow-hidden">
                <ResolvedImage storagePath={resp.storagePath} alt={resp.title} />
                <div className="absolute top-2 right-2 flex gap-1">
                  <Badge variant={resp.enabled ? 'default' : 'outline'} className="text-[10px] h-5">
                    {resp.enabled ? 'Activa' : 'Pausada'}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] h-5">P:{resp.priority}</Badge>
                </div>
              </div>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-bold truncate">{resp.title}</CardTitle>
                <CardDescription className="text-[10px] line-clamp-1">
                  Keywords: {resp.keywords.join(', ')}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 flex-1">
                {resp.caption && <p className="text-[10px] text-muted-foreground line-clamp-2 italic">"{resp.caption}"</p>}
              </CardContent>
              <div className="p-2 border-t flex justify-end gap-1 bg-muted/20">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(resp)} disabled={blocked}>
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(resp)} disabled={blocked}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingResponse ? 'Editar Respuesta Visual' : 'Nueva Respuesta Visual'}</DialogTitle>
            <DialogDescription>Configura una imagen que se enviará automáticamente al detectar palabras clave.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="title">Nombre Interno (Título)</Label>
              <Input id="title" name="title" defaultValue={editingResponse?.title} placeholder="Ej: Catálogo Verano" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="keywords">Palabras Clave (Separadas por comas)</Label>
              <Input id="keywords" name="keywords" defaultValue={editingResponse?.keywords.join(', ')} placeholder="precio, catalogo, ver productos" required />
              <p className="text-[10px] text-muted-foreground">Si el cliente escribe algo que incluya esto, se enviará la imagen.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="caption">Mensaje de Imagen (Caption opcional)</Label>
              <Textarea id="caption" name="caption" defaultValue={editingResponse?.caption || ''} placeholder="¡Claro! Aquí tienes nuestra información..." rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priority">Prioridad (0-100)</Label>
                <Input id="priority" name="priority" type="number" defaultValue={editingResponse?.priority || 0} />
              </div>
              <div className="flex items-center gap-2 pt-8">
                <Switch id="enabled" name="enabled" defaultChecked={editingResponse?.enabled ?? true} />
                <Label htmlFor="enabled">Activada</Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="image">Imagen</Label>
              <div className="flex flex-col gap-2">
                <Input id="image" type="file" accept="image/*" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
                {editingResponse?.storagePath && !selectedFile && (
                  <p className="text-[10px] text-muted-foreground">Mantén vacío para conservar la imagen actual.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>Cancelar</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FollowupConfigTab({ channelId, blocked }: { channelId: string, blocked: boolean }) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const followupRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId, 'runtime', 'followup');
  }, [firestore, channelId]);

  const { data: config, isLoading } = useDoc<FollowupConfig>(followupRef);

  // Stats
  const activeFollowupsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'conversations'), where('followupEnabled', '==', true));
  }, [firestore, channelId]);
  const { data: activeConversations } = useCollection(activeFollowupsQuery);

  const [formData, setFormData] = useState<Partial<FollowupConfig>>({});
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const [cadenceText, setCadenceText] = useState<string>("");

  useEffect(() => {
    setHasInitialLoad(false);
  }, [channelId]);

  useEffect(() => {
    async function checkAndInit() {
      if (!firestore || !user || !channelId || hasInitialLoad || isLoading) return;
      
      const ref = doc(firestore, 'channels', channelId, 'runtime', 'followup');
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        const defaults: Partial<FollowupConfig> = {
          enabled: false,
          businessHours: { startHour: 8, endHour: 22, timezone: "America/Mexico_City" },
          maxTouches: 9,
          cadenceHours: [1, 3, 5, 8, 13, 21, 34, 55, 89],
          stopKeywords: ["alto", "stop", "no me interesa", "deja de escribir", "cancelar", "baja"],
          resumeKeywords: ["info", "información", "precio", "cotizar", "quiero"],
          toneProfile: "Profesional, cercano, breve. 1 pregunta por mensaje.",
          goal: "Convertir a cita/llamada o solicitar datos de contacto.",
        };
        
        await setDoc(ref, { 
          ...defaults, 
          updatedAt: serverTimestamp(), 
          updatedByUid: user.uid, 
          updatedByEmail: user.email 
        }, { merge: true });
        
        setFormData(defaults);
        setCadenceText(defaults.cadenceHours!.join(', '));
      } else {
        // ya existe: cargarlo a formData
        const d = snap.data();
        const loaded = { ...d } as any;
        setFormData(loaded);
        setCadenceText((loaded.cadenceHours ?? [1,3,5,8,13,21,34,55,89]).join(', '));
      }
      setHasInitialLoad(true);
    }

    if (config) {
      setFormData(config);
      if (config.cadenceHours) {
        setCadenceText(config.cadenceHours.join(", "));
      }
      setHasInitialLoad(true);
    } else if (!isLoading && firestore && user && !hasInitialLoad) {
      checkAndInit();
    }
  }, [config, isLoading, firestore, user, channelId, hasInitialLoad]);

  const parseCadenceText = (text: string) => {
    const arr = text
      .split(',')
      .map(v => Number(v.trim()))
      .filter(n => Number.isFinite(n) && n > 0);
    return arr.length > 0 ? arr : [1, 3, 5, 8, 13, 21, 34, 55, 89];
  };

  const handleSave = async () => {
    if (!followupRef || !user || blocked) return;
    
    const parsedCadence = parseCadenceText(cadenceText);

    const payload = {
      enabled: formData.enabled === true,
      businessHours: {
        startHour: Number(formData.businessHours?.startHour ?? 8),
        endHour: Number(formData.businessHours?.endHour ?? 22),
        timezone: formData.businessHours?.timezone ?? "America/Mexico_City"
      },
      cadenceHours: parsedCadence,
      maxTouches: parsedCadence.length,
      stopKeywords: formData.stopKeywords ?? [],
      resumeKeywords: formData.resumeKeywords ?? [],
      toneProfile: formData.toneProfile ?? "",
      goal: formData.goal ?? "",
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByEmail: user.email || '',
    };

    try {
      await setDoc(followupRef, payload, { merge: true });
      
      // Update local state to avoid jumping back to old values
      setFormData(prev => ({
        ...prev,
        cadenceHours: parsedCadence,
        maxTouches: parsedCadence.length,
      }));
      setCadenceText(parsedCadence.join(', '));

      toast({ title: 'Configuración de seguimiento guardada' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error al guardar configuración' });
    }
  };

  if (isLoading && !hasInitialLoad) return <div className="space-y-4"><Skeleton className="h-48 w-full" /></div>;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Reglas de Seguimiento</CardTitle>
              <CardDescription>Configura cuándo y cómo el bot contacta proactivamente.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="global-followup-switch" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Global Canal</Label>
              <Switch 
                id="global-followup-switch"
                checked={formData.enabled === true} 
                onCheckedChange={(val) => setFormData(prev => ({ ...prev, enabled: val }))}
                disabled={blocked}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hora Inicio (0-23)</Label>
                <Input 
                  type="number" 
                  value={formData.businessHours?.startHour ?? ''} 
                  onChange={(e) => setFormData(prev => ({ ...prev, businessHours: { ...prev.businessHours!, startHour: parseInt(e.target.value) || 0 } }))} 
                  disabled={blocked}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora Fin (0-23)</Label>
                <Input 
                  type="number" 
                  value={formData.businessHours?.endHour ?? ''} 
                  onChange={(e) => setFormData(prev => ({ ...prev, businessHours: { ...prev.businessHours!, endHour: parseInt(e.target.value) || 0 } }))} 
                  disabled={blocked}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cadencia (Horas separadas por coma)</Label>
              <Input 
                value={cadenceText} 
                onChange={(e) => setCadenceText(e.target.value)} 
                onBlur={() => {
                  const parsed = parseCadenceText(cadenceText);
                  setCadenceText(parsed.join(", "));
                }}
                disabled={blocked}
              />
              <p className="text-[10px] text-muted-foreground">Ejemplo: 0.1, 0.5, 1, 24... (horas decimales permitidas desde el último mensaje del cliente)</p>
            </div>

            <div className="space-y-2">
              <Label>Palabras para detener (Separadas por coma)</Label>
              <Input 
                value={formData.stopKeywords?.join(', ') ?? ''} 
                onChange={(e) => setFormData(prev => ({ ...prev, stopKeywords: e.target.value.split(',').map(v => v.trim()).filter(v => v) }))} 
                disabled={blocked}
              />
            </div>

            <div className="space-y-2">
              <Label>Objetivo de los mensajes</Label>
              <Textarea 
                value={formData.goal ?? ''} 
                onChange={(e) => setFormData(prev => ({ ...prev, goal: e.target.value }))}
                placeholder="Ej: Conseguir una llamada de diagnóstico"
                disabled={blocked}
              />
            </div>

            <Button className="w-full" onClick={handleSave} disabled={blocked}><Save className="mr-2 h-4 w-4" /> Guardar Cambios</Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Estado del Seguimiento</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">Global Canal:</span>
              <StatusBadge status={config?.enabled ? 'active' : 'disabled'} />
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">Conversaciones Activas:</span>
              <span className="font-bold">{activeConversations?.length || 0}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">Pasos Configurados:</span>
              <span className="font-bold">{config?.maxTouches || 0}</span>
            </div>
            {config?.updatedAt && (
              <div className="text-[10px] text-muted-foreground mt-2">
                Último cambio por {config.updatedByEmail} el {format((config.updatedAt as Timestamp).toDate(), 'PPpp')}
              </div>
            )}
          </CardContent>
        </Card>

        <Alert className="bg-amber-500/5 border-amber-500/20">
          <Clock className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-xs">Ventana Horaria</AlertTitle>
          <AlertDescription className="text-[10px]">
            El seguimiento solo enviará mensajes de {config?.businessHours?.startHour ?? 8}:00 a {config?.businessHours?.endHour ?? 22}:00 ({config?.businessHours?.timezone || 'GMT'}).
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

function DocumentsTab({ channelId }: { channelId: string }) {
  const { firestore, firebaseApp } = useFirebase();
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const docsRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'kb_docs'), orderBy('createdAt', 'desc'));
  }, [firestore, channelId]);

  const { data: docs, isLoading } = useCollection<any>(docsRef);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firebaseApp || !firestore) return;

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({ variant: 'destructive', title: 'Archivo no soportado', description: 'Sube PDF o imágenes (PNG, JPG, WEBP)' });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const { getStorage, ref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
      const storage = getStorage(firebaseApp);
      const docId = Math.random().toString(36).substring(7);
      const storagePath = `channels/${channelId}/kb/${docId}/${file.name}`;
      const fileRef = ref(storage, storagePath);

      const kbDocRef = doc(firestore, 'channels', channelId, 'kb_docs', docId);
      await setDoc(kbDocRef, {
        docId,
        fileName: file.name,
        contentType: file.type,
        storagePath,
        sizeBytes: file.size,
        status: 'PROCESSING',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const uploadTask = uploadBytesResumable(fileRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          toast({ variant: 'destructive', title: 'Error en subida', description: error.message });
          setIsUploading(false);
        },
        async () => {
          const downloadUrl = await getDownloadURL(fileRef);
          await updateDoc(kbDocRef, {
            downloadUrl,
            updatedAt: serverTimestamp(),
          });
          setIsUploading(false);
          toast({ title: 'Archivo subido', description: 'El archivo se está procesando...' });
        }
      );
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: String(error) });
      setIsUploading(false);
    }
  };

  const handleDelete = async (docId: string, storagePath: string) => {
    if (!firestore || !firebaseApp) return;
    try {
      const { getStorage, ref, deleteObject } = await import('firebase/storage');
      const storage = getStorage(firebaseApp);
      
      const fileRef = ref(storage, storagePath);
      await deleteObject(fileRef).catch(e => console.warn("Storage delete failed", e));

      const kbDocRef = doc(firestore, 'channels', channelId, 'kb_docs', docId);
      await deleteDoc(kbDocRef);

      toast({ title: 'Documento eliminado' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error al eliminar', description: String(error) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Documentos de Conocimiento</h3>
        <div className="relative">
          <input 
            type="file" 
            className="hidden" 
            id="file-upload" 
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            onChange={handleUpload}
            disabled={isUploading}
          />
          <Button asChild disabled={isUploading}>
            <label htmlFor="file-upload" className="cursor-pointer">
              {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              Subir Archivo
            </label>
          </Button>
        </div>
      </div>

      {isUploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span>Subiendo...</span>
            <span>{Math.round(uploadProgress)}%</span>
          </div>
          <Progress value={uploadProgress} className="h-1" />
        </div>
      )}

      <div className="grid gap-4">
        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : docs?.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg text-muted-foreground">
            <FileText className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-sm text-center">No hay documentos cargados.<br/>Sube PDFs o imágenes para entrenar al bot.</p>
          </div>
        ) : (
          docs?.map((doc) => (
            <Card key={doc.id} className="overflow-hidden">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded bg-primary/10 flex items-center justify-center text-primary">
                    {doc.contentType.includes('pdf') ? <FileText className="h-5 w-5" /> : (
                      doc.downloadUrl ? <img src={doc.downloadUrl} className="size-10 object-cover rounded" alt="" /> : <FileText className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium line-clamp-1">{doc.fileName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={doc.status} className="text-[10px] h-4 px-1" />
                      <span className="text-[10px] text-muted-foreground">{(doc.sizeBytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {doc.status === 'READY' && doc.downloadUrl && (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={doc.downloadUrl} target="_blank" rel="noreferrer"><LinkIcon className="h-4 w-4" /></a>
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(doc.id, doc.storagePath)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
              {doc.status === 'ERROR' && doc.error && (
                <div className="px-4 pb-4">
                  <Alert variant="destructive" className="py-2 text-[10px]">
                    <AlertCircle className="h-3 w-3" />
                    <AlertTitle className="text-[10px]">Error de procesamiento</AlertTitle>
                    <AlertDescription className="text-[10px]">{doc.error}</AlertDescription>
                  </Alert>
                </div>
              )}
              {doc.status === 'READY' && doc.summary && (
                <Accordion type="single" collapsible className="border-t px-4">
                  <AccordionItem value="summary" className="border-0">
                    <AccordionTrigger className="py-2 text-[10px] hover:no-underline font-bold uppercase tracking-wider text-muted-foreground">Ver Resumen de Conocimiento</AccordionTrigger>
                    <AccordionContent className="text-[11px] pb-4">
                      <div className="bg-muted/30 p-2 rounded whitespace-pre-wrap">{doc.summary}</div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function ChatInterface({ channelId, blocked, funnelStages }: { channelId: string, blocked: boolean, funnelStages: FunnelStageConfig[] }) {
  const firestore = useFirestore();
  const searchParams = useSearchParams();
  const [selectedJid, setSelectedJid] = useState<string | null>(null);

  useEffect(() => {
    const jidParam = searchParams.get('jid');
    if (jidParam) {
      setSelectedJid(decodeURIComponent(jidParam));
    }
  }, [searchParams]);

  const conversationsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'conversations'), orderBy('lastMessageAt', 'desc'), limit(50));
  }, [firestore, channelId]);

  const { data: conversations, isLoading: isLoadingConversations } = useCollection<Conversation>(conversationsQuery);

  const activeConversation = useMemo(() => {
    return conversations?.find(c => c.jid === selectedJid);
  }, [conversations, selectedJid]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[650px]">
      <Card className="md:col-span-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Conversaciones</CardTitle></CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            {isLoadingConversations ? <div className="p-4 space-y-4"><Skeleton className="h-12 w-full" /></div> : conversations?.length === 0 ? <div className="p-8 text-center text-sm">No hay conversaciones.</div> : (
              <div className="flex flex-col">
                {conversations?.map((conv) => (
                  <button 
                    key={conv.jid} 
                    onClick={() => setSelectedJid(conv.jid)} 
                    className={cn("flex flex-col items-start gap-1 p-4 text-left border-b hover:bg-muted/50 transition-colors", selectedJid === conv.jid && "bg-muted")}
                  >
                    <div className="flex justify-between w-full font-semibold text-sm truncate">
                      <span className="truncate flex-1 flex items-center gap-1">
                        {(conv.isContact || conv.customer?.isContact) && <User className="size-3 text-primary" />}
                        {resolveConversationDisplayName(conv)}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {conv.botEnabled === false && <Badge variant="outline" className="text-[8px] h-4 px-1 border-amber-500/20 text-amber-600">IA OFF</Badge>}
                        {conv.followupStopped && <Badge variant="destructive" className="text-[8px] h-4 px-1">STOP</Badge>}
                        {conv.followupEnabled && !conv.followupStopped && (
                          <Badge variant="outline" className="text-[8px] h-4 px-1 bg-green-500/10 text-green-600 border-green-500/20">
                            FU {conv.followupStage ? `S#${conv.followupStage}` : 'ON'}
                          </Badge>
                        )}
                        {conv.unreadCount > 0 && <span className="bg-primary text-primary-foreground rounded-full size-5 flex items-center justify-center text-[10px]">{conv.unreadCount}</span>}
                      </div>
                    </div>
                    <div className="flex justify-between w-full text-[10px] text-muted-foreground truncate">
                      <span className="truncate flex-1">{conv.lastMessageText || 'Sin mensajes'}</span>
                      <span className="shrink-0 ml-2">{conv.lastMessageAt ? format((conv.lastMessageAt as Timestamp).toDate(), 'HH:mm') : ''}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
      <Card className="md:col-span-2 flex flex-col overflow-hidden">
        {selectedJid && activeConversation ? (
          <MessageThread 
            channelId={channelId} 
            jid={selectedJid} 
            conversation={activeConversation} 
            blocked={blocked}
            onDeleteSuccess={() => setSelectedJid(null)}
            funnelStages={funnelStages}
          />
        ) : selectedJid ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
            <Loader2 className="size-8 mb-4 animate-spin" />
            <p>Cargando detalles del chat...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
            <MessageSquare className="size-12 mb-4 opacity-20" />
            <p>Selecciona un chat para ver los mensajes.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function CustomerProfileDialog({ channelId, conversation, isOpen, onOpenChange }: { channelId: string, conversation: Conversation, isOpen: boolean, onOpenChange: (open: boolean) => void }) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    notes: ''
  });

  const isAlreadyContact = conversation?.isContact || conversation?.customer?.isContact;

  useEffect(() => {
    if (isOpen && conversation) {
      if (isAlreadyContact && conversation.customer) {
        setFormData({
          name: conversation.customer.name || '',
          email: conversation.customer.email || '',
          phone: conversation.customer.phone || '',
          company: conversation.customer.company || '',
          notes: conversation.customer.notes || ''
        });
      } else {
        // Autocomplete phone for new contact
        let suggestedPhone = conversation.customer?.phone || conversation.phoneE164 || '';
        if (!suggestedPhone && conversation.jid?.endsWith('@s.whatsapp.net')) {
          suggestedPhone = conversation.jid.split('@')[0];
        }
        setFormData({ name: '', email: '', phone: suggestedPhone, company: '', notes: '' });
      }
    }
  }, [isOpen, conversation, isAlreadyContact]);

  const handleSave = async () => {
    if (!firestore || !conversation) return;
    
    if (!formData.name.trim() || !formData.phone.trim()) {
      toast({ variant: 'destructive', title: 'Campos obligatorios', description: 'Nombre y Teléfono son requeridos para guardar como contacto.' });
      return;
    }

    const convRef = doc(firestore, 'channels', channelId, 'conversations', conversation.jid);
    
    try {
      await updateDoc(convRef, {
        customer: {
          ...formData,
          isContact: true,
          updatedAt: serverTimestamp(),
          source: 'manual'
        },
        isContact: true,
        displayName: formData.name.trim(),
        updatedAt: serverTimestamp()
      });
      toast({ title: isAlreadyContact ? 'Contacto actualizado' : 'Contacto guardado' });
      onOpenChange(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al actualizar contacto' });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isAlreadyContact ? 'Modificar contacto' : 'Crear contacto'}</DialogTitle>
          <DialogDescription>
            {isAlreadyContact 
              ? 'Actualiza la información manual de este contacto.' 
              : 'Guarda esta conversación en tu agenda de contactos manual.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label className="flex items-center gap-1">Nombre <span className="text-destructive">*</span></Label>
            <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Nombre completo" />
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-1">Teléfono <span className="text-destructive">*</span></Label>
            <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="+52..." />
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="correo@ejemplo.com" />
          </div>
          <div className="grid gap-2">
            <Label>Empresa</Label>
            <Input value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} placeholder="Nombre de la empresa" />
          </div>
          <div className="grid gap-2">
            <Label>Notas</Label>
            <Textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Notas adicionales..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>
            {isAlreadyContact ? 'Guardar cambios' : 'Guardar contacto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageThread({ channelId, jid, conversation, blocked, onDeleteSuccess, funnelStages }: { channelId: string, jid: string, conversation: Conversation, blocked: boolean, onDeleteSuccess?: () => void, funnelStages: FunnelStageConfig[] }) {
  const { user, firestore, firebaseApp } = useFirebase();
  const functions = firebaseApp ? getFunctions(firebaseApp, "us-central1") : null;
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isClearOpen, setIsClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // RECORDER STATES
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'finished'>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const isSuperAdmin = getIsSuperAdmin(user);
  const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL;

  const messagesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'conversations', jid, 'messages'), orderBy('timestamp', 'asc'), limit(100));
  }, [firestore, channelId, jid]);

  const { data: messages, isLoading } = useCollection<Message>(messagesQuery);

  const currentStageName = funnelStages.find(s => s.id === (conversation?.funnelStage || 1))?.name || 'Etapa 1';

  // IDEMPOTENT UI DEDUPLICATION
  const dedupedMessages = useMemo(() => {
    const seen = new Set<string>();
    const out: Message[] = [];
    
    const sorted = [...(messages ?? [])].sort((a, b) => {
      const ta = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : Number(a.timestamp || 0);
      const tb = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : Number(b.timestamp || 0);
      return ta - tb;
    });

    for (const m of sorted) {
      const key = m.clientMessageId ? `cid:${m.clientMessageId}` : `waid:${m.waMessageId || m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }, [messages]);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [dedupedMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || blocked || isSending) return;

    if (!firebaseApp || !functions || !firestore) {
      toast({ variant: 'destructive', title: 'Config Firebase incompleta' });
      return;
    }

    setIsSending(true);
    const clientMessageId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const msgDocRef = doc(firestore, 'channels', channelId, 'conversations', jid, 'messages', clientMessageId);

    try {
      await setDoc(msgDocRef, {
        id: clientMessageId,
        clientMessageId,
        jid,
        text,
        fromMe: true,
        direction: "OUT",
        status: "sending",
        isBot: false,
        source: "manual",
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
        timestampServer: serverTimestamp(),
      }, { merge: true });

      setInputText('');
      const sendFn = httpsCallable(functions, "sendMessageProxy");
      await sendFn({ channelId, to: jid, text, clientMessageId });
    } catch (err: any) { 
      toast({ variant: 'destructive', title: 'No se pudo enviar', description: err.message }); 
      await setDoc(msgDocRef, { status: 'error' }, { merge: true }).catch(() => {});
    } finally { 
      setIsSending(false); 
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firebaseApp || !firestore) return;

    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Archivo no soportado', description: 'Por favor selecciona una imagen.' });
      return;
    }

    setIsSending(true);
    const caption = inputText.trim();
    setInputText(''); 

    const clientMessageId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const ext = file.name.split('.').pop() || 'jpg';
    const storagePath = `channels/${channelId}/conversations/${jid}/messages/${clientMessageId}/original.${ext}`;

    try {
      const { getStorage, ref, uploadBytes } = await import('firebase/storage');
      const storage = getStorage(firebaseApp);
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file);

      const msgDocRef = doc(firestore, 'channels', channelId, 'conversations', jid, 'messages', clientMessageId);
      await setDoc(msgDocRef, {
        id: clientMessageId,
        clientMessageId,
        jid,
        text: caption || null,
        type: 'image',
        fromMe: true,
        direction: "OUT",
        status: "sending",
        isBot: false,
        source: "manual",
        media: {
          kind: 'image',
          storagePath,
          status: 'uploaded',
          mimeType: file.type,
          fileSize: file.size
        },
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
        timestampServer: serverTimestamp(),
      }, { merge: true });

      if (!workerUrl) throw new Error("Worker URL not configured");
      const response = await fetch(`${workerUrl}/v1/channels/${channelId}/messages/send-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: jid, storagePath, caption, meta: { clientMessageId, source: 'manual' } })
      });
      if (!response.ok) throw new Error("Worker failed to send image");
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al enviar imagen', description: err.message });
    } finally {
      setIsSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: 'audio/webm;codecs=opus' };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
        setRecordedBlob(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      setRecordingState('recording');
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error de micrófono', description: 'Asegúrate de dar permisos de acceso.' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordingState('finished');
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecordingState('idle');
    setRecordedBlob(null);
    setRecordingDuration(0);
  };

  const handleSendRecordedAudio = async () => {
    if (!recordedBlob || !firebaseApp || !firestore) return;
    setIsSending(true);
    const clientMessageId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const storagePath = `channels/${channelId}/conversations/${jid}/messages/${clientMessageId}/original.webm`;
    try {
      const { getStorage, ref, uploadBytes } = await import('firebase/storage');
      const storage = getStorage(firebaseApp);
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, recordedBlob);
      const msgDocRef = doc(firestore, 'channels', channelId, 'conversations', jid, 'messages', clientMessageId);
      await setDoc(msgDocRef, {
        id: clientMessageId,
        clientMessageId,
        jid,
        text: null,
        type: 'audio',
        fromMe: true,
        direction: "OUT",
        status: "sending",
        isBot: false,
        source: "manual",
        media: { kind: 'audio', storagePath, status: 'uploaded', mimeType: recordedBlob.type, fileSize: recordedBlob.size, seconds: recordingDuration, ptt: false },
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
        timestampServer: serverTimestamp(),
      }, { merge: true });

      if (!workerUrl) throw new Error("Worker URL not configured");
      const response = await fetch(`${workerUrl}/v1/channels/${channelId}/messages/send-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: jid, storagePath, mimetype: recordedBlob.type, ptt: false, seconds: recordingDuration, meta: { clientMessageId, source: 'manual', isWebRecording: true } })
      });
      if (!response.ok) throw new Error("Worker failed to send audio");
      cancelRecording();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al enviar audio', description: err.message });
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleFollowup = async () => {
    if (!firestore || blocked || !conversation) return;
    const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
    await updateDoc(convRef, { followupEnabled: !conversation.followupEnabled });
    toast({ title: conversation.followupEnabled ? 'Seguimiento desactivado' : 'Seguimiento activado' });
  };

  const handleToggleBot = async () => {
    if (!firestore || blocked || !conversation) return;
    const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
    const newState = conversation.botEnabled === false ? true : false;
    await updateDoc(convRef, { botEnabled: newState });
    toast({ title: newState ? 'IA activada para este chat' : 'IA desactivada para este chat' });
  };

  const handleChangeFunnelStage = async (stageId: number) => {
    if (!firestore || blocked) return;
    try {
      const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
      await updateDoc(convRef, { funnelStage: stageId, updatedAt: serverTimestamp() });
      toast({ title: 'Etapa comercial actualizada' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al cambiar etapa' });
    }
  };

  const handleResetFollowup = async () => {
    if (!firestore || blocked) return;
    const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
    await updateDoc(convRef, { followupStage: 0, followupNextAt: null, followupStopped: false, followupStopReason: null, followupStopAt: null, updatedAt: serverTimestamp() });
    toast({ title: 'Seguimiento reiniciado' });
  };

  const clearChatMessages = async () => {
    if (!firestore || !channelId || !jid) return;
    setIsClearing(true);
    try {
      const messagesRef = collection(firestore, 'channels', channelId, 'conversations', jid, 'messages');
      while (true) {
        const q = query(messagesRef, limit(400));
        const snapshot = await getDocs(q);
        if (snapshot.empty) break;
        const batch = writeBatch(firestore);
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      toast({ title: 'Chat limpiado' });
      setIsClearOpen(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al limpiar chat', description: error.message });
    } finally {
      setIsClearing(false);
    }
  };

  const deleteFullConversation = async () => {
    if (!firestore || !channelId || !jid) return;
    setIsDeleting(true);
    try {
      const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
      const deleteCollection = async (collectionPath: string) => {
        const colRef = collection(firestore, collectionPath);
        while (true) {
          const q = query(colRef, limit(400));
          const snapshot = await getDocs(q);
          if (snapshot.empty) break;
          const batch = writeBatch(firestore);
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
      };
      await deleteCollection(`channels/${channelId}/conversations/${jid}/messages`);
      await deleteCollection(`channels/${channelId}/conversations/${jid}/followup_locks`);
      await deleteCollection(`channels/${channelId}/conversations/${jid}/profile_processed`);
      await deleteDoc(convRef);
      toast({ title: 'Conversación eliminada' });
      setIsDeleteOpen(false);
      if (onDeleteSuccess) onDeleteSuccess();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al eliminar', description: error.message });
    } finally {
      setIsDeleting(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <CardHeader className="border-b py-3 px-4 flex-row justify-between items-center bg-card">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-sm font-bold truncate flex items-center gap-1">
            {(conversation?.isContact || conversation?.customer?.isContact) && <User className="size-3 text-primary" />}
            {resolveConversationDisplayName(conversation)}
          </CardTitle>
          <CardDescription className="text-[10px] truncate">{jid}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setIsProfileOpen(true)}>
            <User className="h-4 w-4" />
          </Button>
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px] hidden sm:inline-flex">ETAPA: {currentStageName}</Badge>
          {conversation?.botEnabled !== false ? <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">IA ACTIVA</Badge> : <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">IA INACTIVA</Badge>}
          {conversation?.followupEnabled ? <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">FU ACTIVO</Badge> : <Badge variant="outline" className="text-[10px]">FU INACTIVO</Badge>}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub><DropdownMenuSubTrigger><LayoutGrid className="mr-2 h-4 w-4" /> Mover a etapa</DropdownMenuSubTrigger><DropdownMenuPortal><DropdownMenuSubContent>{funnelStages.map(s => (<DropdownMenuItem key={s.id} onClick={() => handleChangeFunnelStage(s.id)}>{s.name}</DropdownMenuItem>))}</DropdownMenuSubContent></DropdownMenuPortal></DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleToggleBot} disabled={blocked}>{conversation?.botEnabled === false ? 'Activar IA' : 'Desactivar IA'}</DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleFollowup} disabled={blocked}>{conversation?.followupEnabled ? 'Desactivar Seguimiento' : 'Activar Seguimiento'}</DropdownMenuItem>
              <DropdownMenuItem onClick={handleResetFollowup} disabled={blocked}>Reiniciar Seguimiento</DropdownMenuItem>
              {isSuperAdmin && (
                <><DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(e) => { e.preventDefault(); setIsClearOpen(true); }} disabled={isClearing || isDeleting}><Trash2 className="mr-2 h-4 w-4" /> Limpiar chat</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(e) => { e.preventDefault(); setIsDeleteOpen(true); }} disabled={isClearing || isDeleting}><XCircle className="mr-2 h-4 w-4" /> Eliminar conversación</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/20">
        <ScrollArea className="h-full p-4">
          {isLoading ? <div className="p-4 space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-10 w-1/2 ml-auto" /></div> : (
            <div className="flex flex-col gap-2">
              {dedupedMessages.map((msg) => (
                <div key={msg.id} className={cn("max-w-[80%] rounded-lg p-3 text-sm shadow-sm", msg.fromMe ? "bg-primary text-primary-foreground ml-auto rounded-tr-none" : "bg-card mr-auto rounded-tl-none")}>
                  {msg.type === 'image' && msg.media?.storagePath && <div className="mb-2 rounded overflow-hidden bg-black/5 min-h-[100px] flex items-center justify-center"><ResolvedImage storagePath={msg.media.storagePath} alt={msg.text || "WhatsApp Image"} /></div>}
                  {msg.type === 'audio' && msg.media?.storagePath && <div className="mb-1"><ResolvedAudio storagePath={msg.media.storagePath} ptt={msg.media.ptt} /></div>}
                  {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
                  <div className="text-[10px] mt-1 opacity-70 flex justify-end gap-1">
                    {(() => { const d = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp); return format(d, 'HH:mm'); })()}
                    {msg.fromMe && <span>{msg.status || 'sent'}</span>}
                    {msg.isBot && <Bot className="h-3 w-3" />}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          )}
        </ScrollArea>
      </CardContent>
      <div className="p-4 border-t bg-card">
        {blocked && <Alert variant="destructive" className="mb-2 py-2"><AlertCircle className="h-3 w-3" /><AlertDescription className="text-xs">Trial expirado. Funciones bloqueadas.</AlertDescription></Alert>}
        {recordingState === 'idle' ? (
          <div className="flex gap-2 items-center">
            <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleImageUpload} />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" disabled={isSending || blocked}><Paperclip className="h-5 w-5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top"><DropdownMenuItem onClick={() => fileInputRef.current?.click()}><ImageIcon className="mr-2 h-4 w-4" /> Imagen</DropdownMenuItem><DropdownMenuItem onClick={startRecording}><Mic className="mr-2 h-4 w-4" /> Grabar Audio</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
            <form onSubmit={handleSendMessage} className="flex-1 flex gap-2"><Input placeholder={blocked ? "Canal expirado..." : "Escribe un mensaje..."} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(e as any); } }} disabled={isSending || blocked} /><Button type="submit" size="icon" disabled={isSending || !inputText.trim() || blocked}>{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></form>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 p-2 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3"><div className="flex items-center gap-2 text-destructive animate-pulse"><div className="size-2 rounded-full bg-destructive" /><span className="text-xs font-bold font-mono">{formatTimer(recordingDuration)}</span></div><span className="text-xs text-muted-foreground font-medium">{recordingState === 'recording' ? 'Grabando...' : 'Audio listo'}</span></div>
            <div className="flex items-center gap-2"><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={cancelRecording} disabled={isSending}><Trash className="h-4 w-4" /></Button>{recordingState === 'recording' ? (<Button size="icon" className="h-8 w-8 rounded-full" onClick={stopRecording}><Square className="h-3 w-3" /></Button>) : (<Button size="icon" className="h-8 w-8 rounded-full bg-primary" onClick={handleSendRecordedAudio} disabled={isSending}>{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>)}</div>
          </div>
        )}
      </div>

      <CustomerProfileDialog channelId={channelId} conversation={conversation} isOpen={isProfileOpen} onOpenChange={setIsProfileOpen} />
      <AlertDialog open={isClearOpen} onOpenChange={setIsClearOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Limpiar chat</AlertDialogTitle><AlertDialogDescription>Esta acción eliminará todos los mensajes de esta conversación.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isClearing}>Cancelar</AlertDialogCancel><AlertDialogAction onClick={(e) => { e.preventDefault(); clearChatMessages(); }} className="bg-destructive text-destructive-foreground" disabled={isClearing}>{isClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Eliminar mensajes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar conversación?</AlertDialogTitle><AlertDialogDescription>Esta acción eliminará la conversación completa y todos sus mensajes permanentemente.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel><AlertDialogAction onClick={(e) => { e.preventDefault(); deleteFullConversation(); }} className="bg-destructive text-destructive-foreground" disabled={isDeleting}>{isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Borrar definitivamente</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  );
}
