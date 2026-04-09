
"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2, ScanQrCode, LogOut, RotateCcw, MessageSquare, Link as LinkIcon, Send, Bot, FileText, Save, History, Brain, Info, AlertCircle, CheckCircle2, Clock, PlusCircle, Trash2, Settings2, MoreVertical, User, CalendarClock, XCircle, Image as ImageIcon, Paperclip, Music, Mic, Square, Trash } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useUser, setDocumentNonBlocking, useFirebase } from '@/firebase';
import { doc, collection, query, orderBy, limit, Timestamp, serverTimestamp, setDoc, updateDoc, deleteDoc, where, getDoc, addDoc, writeBatch, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/context/language-provider';
import type { WhatsappChannel, Conversation, Message, BotConfig, FollowupConfig } from '@/lib/types';
import { StatusBadge } from '@/components/app/status-badge';
import { QrCodeDialog } from '@/components/app/qr-code-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
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
 */
function resolveConversationDisplayName(conv: Conversation | null | undefined) {
  if (!conv) return 'Cargando...';
  
  const { displayName, name, phoneE164, jid } = conv;
  
  // 1. Prioritize real display name from CRM/Capture (if it's not the JID)
  if (displayName && displayName !== jid) return displayName;
  
  // 2. Prioritize pushName from WhatsApp profile
  if (name && name !== jid) return name;
  
  // 3. Use resolved phone number
  if (phoneE164) return phoneE164;
  
  // 4. Technical fallback
  return jid;
}

export function ChannelDetailPage({ channelId }: { channelId: string }) {
  const { t } = useLanguage();
  const { firestore, user, firebaseApp } = useFirebase();
  const { toast } = useToast();
  
  const channelRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId);
  }, [firestore, channelId]);

  const { data: channel, isLoading } = useDoc<WhatsappChannel>(channelRef);

  const [isQrModalOpen, setQrModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('connection');
  const [isExtending, setIsExtending] = useState(false);

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

  const handleGenerateQr = () => handleApiCall('/qr', 'Generando código QR...', 'Error al solicitar QR');
  const handleDisconnect = () => handleApiCall('/disconnect', 'Desconectando...', 'Error al desconectar');
  const handleResetSession = () => handleApiCall('/resetSession', 'Reiniciando sesión...', 'Error al reiniciar sesión');

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
          <Button variant="outline" asChild><Link href="/channels">Volver a Canales</Link></Button>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="connection" className="flex items-center gap-2"><LinkIcon className="h-4 w-4" />Conexión</TabsTrigger>
          <TabsTrigger value="chats" className="flex items-center gap-2" disabled={channel?.status !== 'CONNECTED'}><MessageSquare className="h-4 w-4" />Chats</TabsTrigger>
          <TabsTrigger value="chatbot" className="flex items-center gap-2"><Bot className="h-4 w-4" />Chatbot</TabsTrigger>
        </TabsList>

        <TabsContent value="connection">
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

        <TabsContent value="chats">
          {workerUrl && <ChatInterface channelId={channelId} blocked={isBlocked} />}
        </TabsContent>

        <TabsContent value="chatbot">
          <ChatbotConfig channelId={channelId} blocked={isBlocked} />
        </TabsContent>
      </Tabs>

      <QrCodeDialog qrDataUrl={channel?.qrDataUrl ?? null} isOpen={isQrModalOpen} onOpenChange={setQrModalOpen} />
    </main>
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
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="training" className="flex items-center gap-2"><Brain className="h-4 w-4" />Entrenamiento</TabsTrigger>
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

function ChatInterface({ channelId, blocked }: { channelId: string, blocked: boolean }) {
  const firestore = useFirestore();
  const [selectedJid, setSelectedJid] = useState<string | null>(null);

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
                      <span className="truncate flex-1">{resolveConversationDisplayName(conv)}</span>
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

  useEffect(() => {
    if (conversation?.customer) {
      setFormData({
        name: conversation.customer.name || '',
        email: conversation.customer.email || '',
        phone: conversation.customer.phone || '',
        company: conversation.customer.company || '',
        notes: conversation.customer.notes || ''
      });
    } else {
      setFormData({ name: '', email: '', phone: '', company: '', notes: '' });
    }
  }, [conversation]);

  const handleSave = async () => {
    if (!firestore || !conversation) return;
    const convRef = doc(firestore, 'channels', channelId, 'conversations', conversation.jid);
    const displayName = formData.name || formData.email || formData.phone || conversation.jid;
    
    try {
      await updateDoc(convRef, {
        customer: {
          ...formData,
          updatedAt: serverTimestamp(),
          source: 'manual'
        },
        displayName
      });
      toast({ title: 'Perfil actualizado' });
      onOpenChange(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al actualizar perfil' });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Perfil del Cliente</DialogTitle>
          <DialogDescription>Información capturada automáticamente o editada manualmente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Nombre</Label>
            <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Nombre completo" />
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="correo@ejemplo.com" />
          </div>
          <div className="grid gap-2">
            <Label>Teléfono</Label>
            <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="+521234567890" />
          </div>
          <div className="grid gap-2">
            <Label>Empresa</Label>
            <Input value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} placeholder="Nombre de la empresa" />
          </div>
          <div className="grid gap-2">
            <Label>Notas</Label>
            <Textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Notas adicionales sobre el cliente..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>Guardar Perfil</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageThread({ channelId, jid, conversation, blocked, onDeleteSuccess }: { channelId: string, jid: string, conversation: Conversation, blocked: boolean, onDeleteSuccess?: () => void }) {
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
      // Rule: primary dedupe by clientMessageId, secondary by waMessageId
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
    
    if (!text) return;
    if (blocked) {
      toast({ variant: 'destructive', title: 'Canal bloqueado', description: 'Trial expirado.' });
      return;
    }
    if (isSending) return;

    if (!firebaseApp || !functions || !firestore) {
      toast({ variant: 'destructive', title: 'Config Firebase incompleta' });
      return;
    }

    setIsSending(true);
    
    const clientMessageId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const msgDocRef = doc(firestore, 'channels', channelId, 'conversations', jid, 'messages', clientMessageId);

    try {
      // OPTIMISTIC WRITE
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
      
      await sendFn({ 
        channelId, 
        to: jid, 
        text, 
        clientMessageId 
      });

    } catch (err: any) { 
      console.error('[CHAT_SEND] error', err);
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
        body: JSON.stringify({
          to: jid,
          storagePath,
          caption,
          meta: { clientMessageId, source: 'manual' }
        })
      });

      if (!response.ok) throw new Error("Worker failed to send image");

    } catch (err: any) {
      console.error('[IMAGE_SEND] error', err);
      toast({ variant: 'destructive', title: 'Error al enviar imagen', description: err.message });
    } finally {
      setIsSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- RECORDING LOGIC ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: 'audio/webm;codecs=opus' };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
        setRecordedBlob(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setRecordingState('recording');
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Mic error', err);
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setRecordingState('idle');
    setRecordedBlob(null);
    setRecordingDuration(0);
  };

  const handleSendRecordedAudio = async () => {
    if (!recordedBlob || !firebaseApp || !firestore) return;

    setIsSending(true);
    const clientMessageId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const ext = 'webm'; // Browser native format (audio/webm;codecs=opus)
    const storagePath = `channels/${channelId}/conversations/${jid}/messages/${clientMessageId}/original.${ext}`;

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
        media: {
          kind: 'audio',
          storagePath,
          status: 'uploaded',
          mimeType: recordedBlob.type,
          fileSize: recordedBlob.size,
          seconds: recordingDuration,
          ptt: false // Standard audio for delivery safety
        },
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
        timestampServer: serverTimestamp(),
      }, { merge: true });

      if (!workerUrl) throw new Error("Worker URL not configured");
      
      const response = await fetch(`${workerUrl}/v1/channels/${channelId}/messages/send-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: jid,
          storagePath,
          mimetype: recordedBlob.type,
          ptt: false, // AUDIO NORMAL (converted by worker)
          seconds: recordingDuration,
          meta: { clientMessageId, source: 'manual', isWebRecording: true }
        })
      });

      if (!response.ok) throw new Error("Worker failed to send audio");

      cancelRecording();
    } catch (err: any) {
      console.error('[AUDIO_SEND] error', err);
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

  const handleResetFollowup = async () => {
    if (!firestore || blocked) return;
    const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
    await updateDoc(convRef, {
      followupStage: 0,
      followupNextAt: null,
      followupStopped: false,
      followupStopReason: null,
      followupStopAt: null,
      updatedAt: serverTimestamp()
    });
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
          <CardTitle className="text-sm font-bold truncate">
            {resolveConversationDisplayName(conversation)}
          </CardTitle>
          <CardDescription className="text-[10px] truncate">{jid}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setIsProfileOpen(true)}>
            <User className="h-4 w-4" />
          </Button>
          {conversation?.botEnabled !== false ? (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">
              IA ACTIVA
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">IA INACTIVA</Badge>
          )}
          {conversation?.followupEnabled ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">
              FU ACTIVO
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">FU INACTIVO</Badge>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleToggleBot} disabled={blocked}>
                {conversation?.botEnabled === false ? 'Activar IA' : 'Desactivar IA'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleToggleFollowup} disabled={blocked}>
                {conversation?.followupEnabled ? 'Desactivar Seguimiento' : 'Activar Seguimiento'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResetFollowup} disabled={blocked}>
                Reiniciar Seguimiento
              </DropdownMenuItem>
              {isSuperAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="text-destructive focus:text-destructive" 
                    onSelect={(e) => {
                      e.preventDefault();
                      setIsClearOpen(true);
                    }}
                    disabled={isClearing || isDeleting}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Limpiar chat
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="text-destructive focus:text-destructive" 
                    onSelect={(e) => {
                      e.preventDefault();
                      setIsDeleteOpen(true);
                    }}
                    disabled={isClearing || isDeleting}
                  >
                    <XCircle className="mr-2 h-4 w-4" /> Eliminar conversación
                  </DropdownMenuItem>
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
                  {msg.type === 'image' && (
                    <div className="mb-2 rounded overflow-hidden bg-black/5 flex flex-col justify-center items-center min-h-[100px]">
                      {msg.media?.storagePath ? (
                        <ResolvedImage 
                          storagePath={msg.media.storagePath} 
                          alt={msg.text || "WhatsApp Image"} 
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 p-4 text-muted-foreground italic text-xs">
                          <AlertCircle className="h-5 w-5 opacity-50" />
                          <span>[Imagen no disponible]</span>
                        </div>
                      )}
                    </div>
                  )}
                  {msg.type === 'audio' && msg.media?.storagePath && (
                    <div className="mb-1">
                      <ResolvedAudio storagePath={msg.media.storagePath} ptt={msg.media.ptt} />
                    </div>
                  )}
                  {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
                  <div className="text-[10px] mt-1 opacity-70 flex justify-end gap-1">
                    {(() => {
                      const d = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
                      return format(d, 'HH:mm');
                    })()}
                    {msg.fromMe && <span>{msg.status || 'sent'}</span>}
                    {msg.isBot && <Bot className="h-3 w-3" />}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
              <div className="mt-8 border-t pt-4">
                <div className="bg-card/50 rounded-lg p-3 border border-dashed text-[10px] space-y-2">
                  <p className="font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Settings2 className="h-3 w-3" /> Estado del Seguimiento
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span className="text-muted-foreground">Habilitado:</span>
                    <span className={conversation?.followupEnabled ? 'text-green-600 font-bold' : ''}>{conversation?.followupEnabled ? 'SÍ' : 'NO'}</span>
                    <span className="text-muted-foreground">Etapa Actual:</span>
                    <span>{conversation?.followupStage ?? 0}</span>
                    <span className="text-muted-foreground">Próximo Envío:</span>
                    <span>{conversation?.followupNextAt ? format((conversation.followupNextAt as Timestamp).toDate(), 'PPpp') : '---'}</span>
                    <span className="text-muted-foreground">Detección STOP:</span>
                    <span>{conversation?.followupStopped ? `SÍ (${conversation.followupStopReason})` : 'NO'}</span>
                    <span className="text-muted-foreground">Último del Cliente:</span>
                    <span>{conversation?.followupLastCustomerAt ? format((conversation.followupLastCustomerAt as Timestamp).toDate(), 'PPpp') : '---'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </ScrollArea>
      </CardContent>
      <div className="p-4 border-t bg-card">
        {blocked && (
          <Alert variant="destructive" className="mb-2 py-2">
            <AlertCircle className="h-3 w-3" />
            <AlertDescription className="text-xs">Trial expirado. Funciones bloqueadas.</AlertDescription>
          </Alert>
        )}
        
        {recordingState === 'idle' ? (
          <div className="flex gap-2 items-center">
            <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleImageUpload} />
            
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" disabled={isSending || blocked}>
                  <Paperclip className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <ImageIcon className="mr-2 h-4 w-4" /> Imagen
                </DropdownMenuItem>
                <DropdownMenuItem onClick={startRecording}>
                  <Mic className="mr-2 h-4 w-4" /> Grabar Audio
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <form onSubmit={handleSendMessage} className="flex-1 flex gap-2">
              <Input 
                placeholder={blocked ? "Canal expirado..." : "Escribe un mensaje..."}
                value={inputText} 
                onChange={(e) => setInputText(e.target.value)} 
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e as any);
                  }
                }}
                disabled={isSending || blocked} 
              />
              <Button type="submit" size="icon" disabled={isSending || !inputText.trim() || blocked}>
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 p-2 bg-muted/50 rounded-lg animate-in fade-in duration-200">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-destructive animate-pulse">
                <div className="size-2 rounded-full bg-destructive" />
                <span className="text-xs font-bold font-mono">{formatTimer(recordingDuration)}</span>
              </div>
              <span className="text-xs text-muted-foreground font-medium">
                {recordingState === 'recording' ? 'Grabando nota de voz...' : 'Audio listo'}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={cancelRecording} disabled={isSending}>
                <Trash className="h-4 w-4" />
              </Button>
              
              {recordingState === 'recording' ? (
                <Button size="icon" className="h-8 w-8 rounded-full" onClick={stopRecording}>
                  <Square className="h-3 w-3" />
                </Button>
              ) : (
                <Button size="icon" className="h-8 w-8 rounded-full bg-primary" onClick={handleSendRecordedAudio} disabled={isSending}>
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <CustomerProfileDialog channelId={channelId} conversation={conversation} isOpen={isProfileOpen} onOpenChange={setIsProfileOpen} />
      <AlertDialog open={isClearOpen} onOpenChange={setIsClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpiar chat</AlertDialogTitle>
            <AlertDialogDescription>Esta acción eliminará todos los mensajes de esta conversación.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); clearChatMessages(); }} className="bg-destructive text-destructive-foreground" disabled={isClearing}>
              {isClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Eliminar mensajes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar conversación completa?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción eliminará la conversación completa y todos sus mensajes de forma permanente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); deleteFullConversation(); }} className="bg-destructive text-destructive-foreground" disabled={isDeleting}>
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Borrar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
