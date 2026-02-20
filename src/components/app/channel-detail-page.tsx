
"use client";

import { useState, useEffect, useRef } from 'react';
import { Loader2, ScanQrCode, LogOut, RotateCcw, MessageSquare, Link as LinkIcon, Send, Bot, FileText, Save, History, Brain, Info, AlertCircle, CheckCircle2, Clock, PlusCircle, Trash2, Settings2, MoreVertical, User, CalendarClock } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useUser, setDocumentNonBlocking, useFirebase } from '@/firebase';
import { doc, collection, query, orderBy, limit, Timestamp, serverTimestamp, setDoc, updateDoc, deleteDoc, where, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
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
import { format, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { getIsSuperAdmin } from '@/lib/auth-helpers';

/**
 * Unified helper to determine trial state from channel document.
 */
function getTrialState(channel: WhatsappChannel | null | undefined) {
  if (!channel?.trial?.endsAt) return { isActive: true, endsMs: null }; // Fallback or lazy init
  const endsAt = channel.trial.endsAt;
  const endsMs = endsAt?.toDate ? endsAt.toDate().getTime() : (endsAt?.seconds ? endsAt.seconds * 1000 : 0);
  const now = Date.now();
  const isActive = !!endsMs && endsMs > now;
  return { isActive, endsMs };
}

export function ChannelDetailPage({ channelId }: { channelId: string }) {
  const { t } = useLanguage();
  const { firestore, user, functions } = useFirebase();
  const { toast } = useToast();
  
  const channelRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId);
  }, [firestore, channelId]);

  const { data: channel, isLoading } = useDoc<WhatsappChannel>(channelRef);

  const [isQrModalOpen, setQrModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('connection');
  const [isExtending, setIsExtending] = useState(false);

  const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL;
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
      console.log(`[TRIAL] Extending channel ${channelId} for ${days} days`);
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
                  <Button variant="outline" onClick={handleGenerateQr} disabled={isLoading || !workerUrl}><ScanQrCode className="mr-2 h-4 w-4" />Generar QR</Button>
                  <Button variant="outline" onClick={handleResetSession} disabled={isLoading || !workerUrl}><RotateCcw className="mr-2 h-4 w-4" />Reiniciar Sesión</Button>
                  <Button variant="destructive" onClick={handleDisconnect} disabled={isLoading || !workerUrl || channel?.status !== 'CONNECTED'}><LogOut className="mr-2 h-4 w-4" />Desconectar</Button>
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

  useEffect(() => {
    setHasInitialLoad(false);
  }, [channelId]);

  useEffect(() => {
    if (config) {
      setFormData(config);
      setHasInitialLoad(true);
    } else if (!isLoading && firestore && user && !hasInitialLoad) {
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
      
      const ref = doc(firestore, 'channels', channelId, 'runtime', 'followup');
      setDoc(ref, { 
        ...defaults, 
        updatedAt: serverTimestamp(), 
        updatedByUid: user.uid, 
        updatedByEmail: user.email 
      }, { merge: true });
      
      setFormData(defaults);
      setHasInitialLoad(true);
    }
  }, [config, isLoading, firestore, user, channelId, hasInitialLoad]);

  const handleSave = async () => {
    if (!followupRef || !user || blocked) return;
    
    const payload = {
      enabled: formData.enabled === true,
      businessHours: {
        startHour: Number(formData.businessHours?.startHour ?? 8),
        endHour: Number(formData.businessHours?.endHour ?? 22),
        timezone: formData.businessHours?.timezone ?? "America/Mexico_City"
      },
      maxTouches: Number(formData.maxTouches ?? 9),
      cadenceHours: formData.cadenceHours ?? [1, 3, 5, 8, 13, 21, 34, 55, 89],
      stopKeywords: formData.stopKeywords ?? [],
      resumeKeywords: formData.resumeKeywords ?? [],
      toneProfile: formData.toneProfile ?? "",
      goal: formData.goal ?? "",
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByEmail: user.email || '',
    };

    console.log("FOLLOWUP SAVE payload", payload);

    try {
      await setDoc(followupRef, payload, { merge: true });
      const verify = await getDoc(followupRef);
      console.log("FOLLOWUP AFTER SAVE", verify.data());
      toast({ title: 'Configuración de seguimiento guardada' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al guardar configuración' });
    }
  };

  if (isLoading && !hasInitialLoad) return <div className="space-y-4"><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>;

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
                value={formData.cadenceHours?.join(', ') ?? ''} 
                onChange={(e) => {
                  const arr = e.target.value.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
                  setFormData(prev => ({ ...prev, cadenceHours: arr, maxTouches: arr.length }));
                }} 
                disabled={blocked}
              />
              <p className="text-[10px] text-muted-foreground">Ejemplo: 1, 3, 5, 24, 48... (horas desde el último mensaje del cliente)</p>
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[650px]">
      <Card className="md:col-span-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Conversaciones</CardTitle></CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            {isLoadingConversations ? <div className="p-4 space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : conversations?.length === 0 ? <div className="p-8 text-center text-sm">No hay conversaciones.</div> : (
              <div className="flex flex-col">
                {conversations?.map((conv) => (
                  <button 
                    key={conv.jid} 
                    onClick={() => setSelectedJid(conv.jid)} 
                    className={cn("flex flex-col items-start gap-1 p-4 text-left border-b hover:bg-muted/50 transition-colors", selectedJid === conv.jid && "bg-muted")}
                  >
                    <div className="flex justify-between w-full font-semibold text-sm truncate">
                      <span className="truncate flex-1">{conv.displayName || conv.name || conv.jid}</span>
                      <div className="flex items-center gap-1 shrink-0">
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
        {selectedJid ? (
          <MessageThread 
            channelId={channelId} 
            jid={selectedJid} 
            conversation={conversations?.find(c => c.jid === selectedJid)!} 
            blocked={blocked}
          />
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

function MessageThread({ channelId, jid, conversation, blocked }: { channelId: string, jid: string, conversation: Conversation, blocked: boolean }) {
  const { firestore, functions } = useFirebase();
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const messagesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'conversations', jid, 'messages'), orderBy('timestamp', 'asc'), limit(100));
  }, [firestore, channelId, jid]);

  const { data: messages, isLoading } = useCollection<Message>(messagesQuery);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || !functions || blocked) return;
    setIsSending(true);
    try {
      const sendFn = httpsCallable(functions, 'sendMessageProxy');
      await sendFn({ channelId, to: jid, text: inputText.trim() });
      setInputText('');
    } catch (e: any) { 
      const msg = e.details?.reason === 'TRIAL_EXPIRED' ? 'Prueba expirada. No puedes enviar mensajes.' : String(e);
      toast({ variant: 'destructive', title: 'Error', description: msg }); 
    } finally { 
      setIsSending(false); 
    }
  };

  const handleToggleFollowup = async () => {
    if (!firestore || blocked) return;
    const convRef = doc(firestore, 'channels', channelId, 'conversations', jid);
    await updateDoc(convRef, { followupEnabled: !conversation.followupEnabled });
    toast({ title: conversation.followupEnabled ? 'Seguimiento desactivado' : 'Seguimiento activado' });
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

  return (
    <>
      <CardHeader className="border-b py-3 px-4 flex-row justify-between items-center bg-card">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-sm font-bold truncate">{conversation?.displayName || conversation?.name || jid}</CardTitle>
          <CardDescription className="text-[10px] truncate">{jid}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setIsProfileOpen(true)}>
            <User className="h-4 w-4" />
          </Button>
          {conversation.followupEnabled ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">
              FU ACTIVO
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">FU INACTIVO</Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleToggleFollowup} disabled={blocked}>
                {conversation.followupEnabled ? 'Desactivar Seguimiento' : 'Activar Seguimiento'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResetFollowup} disabled={blocked}>
                Reiniciar Seguimiento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/20">
        <ScrollArea className="h-full p-4">
          {isLoading ? <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-10 w-1/2 ml-auto" /></div> : (
            <div className="flex flex-col gap-2">
              {messages?.map((msg) => (
                <div key={msg.id} className={cn("max-w-[80%] rounded-lg p-3 text-sm shadow-sm", msg.fromMe ? "bg-primary text-primary-foreground ml-auto rounded-tr-none" : "bg-card mr-auto rounded-tl-none")}>
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                  <div className="text-[10px] mt-1 opacity-70 flex justify-end gap-1">
                    {format(new Date(msg.timestamp), 'HH:mm')}
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
                    <span className={conversation.followupEnabled ? 'text-green-600 font-bold' : ''}>{conversation.followupEnabled ? 'SÍ' : 'NO'}</span>
                    
                    <span className="text-muted-foreground">Etapa Actual:</span>
                    <span>{conversation.followupStage ?? 0}</span>
                    
                    <span className="text-muted-foreground">Próximo Envío:</span>
                    <span>{conversation.followupNextAt ? format((conversation.followupNextAt as Timestamp).toDate(), 'PPpp') : '---'}</span>
                    
                    <span className="text-muted-foreground">Detección STOP:</span>
                    <span>{conversation.followupStopped ? `SÍ (${conversation.followupStopReason})` : 'NO'}</span>
                    
                    <span className="text-muted-foreground">Último del Cliente:</span>
                    <span>{conversation.followupLastCustomerAt ? format((conversation.followupLastCustomerAt as Timestamp).toDate(), 'PPpp') : '---'}</span>
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
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <Input 
            placeholder={blocked ? "Canal expirado..." : "Escribe un mensaje..."}
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            disabled={isSending || blocked} 
          />
          <Button type="submit" size="icon" disabled={isSending || !inputText.trim() || blocked}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>

      <CustomerProfileDialog 
        channelId={channelId} 
        conversation={conversation} 
        isOpen={isProfileOpen} 
        onOpenChange={setIsProfileOpen} 
      />
    </>
  );
}
