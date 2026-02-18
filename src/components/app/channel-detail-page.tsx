
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, ScanQrCode, LogOut, RotateCcw, MessageSquare, Link as LinkIcon, Send, Bot, FileText, Save, History, Brain, Info, AlertCircle, CheckCircle2, ShieldAlert, ChevronDown, Terminal, RefreshCw } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useUser, setDocumentNonBlocking } from '@/firebase';
import { doc, collection, query, orderBy, limit, Timestamp, serverTimestamp } from 'firebase/firestore';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/context/language-provider';
import type { WhatsappChannel, Conversation, Message, BotConfig } from '@/lib/types';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

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
  const [activeTab, setActiveTab] = useState('connection');

  const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL;

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

  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <PageHeader title={channel?.displayName || 'Cargando...'} description={t('manage.connection')}>
        <Button variant="outline" asChild><Link href="/channels">Volver a Canales</Link></Button>
      </PageHeader>
      
      {!workerUrl && (
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
          {workerUrl && <ChatInterface channelId={channelId} workerUrl={workerUrl} />}
        </TabsContent>

        <TabsContent value="chatbot">
          <ChatbotConfig channelId={channelId} />
        </TabsContent>
      </Tabs>

      <QrCodeDialog qrDataUrl={channel?.qrDataUrl ?? null} isOpen={isQrModalOpen} onOpenChange={setQrModalOpen} />
    </main>
  );
}

function ChatbotConfig({ channelId }: { channelId: string }) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState('training');
  const [workerHealth, setWorkerHealth] = useState<'loading' | 'ok' | 'fail'>('loading');

  const botRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId, 'runtime', 'bot');
  }, [firestore, channelId]);

  const { data: botConfig, isLoading } = useDoc<BotConfig>(botRef);

  // Local state for editing
  const [localProductContent, setLocalProductContent] = useState('');
  const [localSalesContent, setLocalSalesContent] = useState('');

  useEffect(() => {
    if (botConfig) {
      setLocalProductContent(botConfig.productDetails || '');
      setLocalSalesContent(botConfig.salesStrategy || '');
    }
  }, [botConfig]);

  const checkHealth = useCallback(async () => {
    setWorkerHealth('loading');
    const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL;
    if (!workerUrl) {
      setWorkerHealth('fail');
      return;
    }
    try {
      const res = await fetch(`${workerUrl}/health`, { mode: 'cors' });
      setWorkerHealth(res.ok ? 'ok' : 'fail');
    } catch {
      setWorkerHealth('fail');
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const handleSave = async (overrides: Partial<BotConfig> = {}) => {
    if (!firestore || !user || !botRef) return;
    
    const data = {
      enabled: overrides.enabled !== undefined ? overrides.enabled : (botConfig?.enabled || false),
      productDetails: overrides.productDetails !== undefined ? overrides.productDetails : localProductContent,
      salesStrategy: overrides.salesStrategy !== undefined ? overrides.salesStrategy : localSalesContent,
      model: botConfig?.model || 'gemini-1.5-flash',
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByEmail: user.email || '',
    };

    setDocumentNonBlocking(botRef, data, { merge: true });
    toast({ title: 'Configuración guardada en Firestore' });
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
      <div className="grid gap-4 md:grid-cols-2">
        <Alert className="bg-primary/5 border-primary/20">
          <Info className="h-4 w-4" />
          <AlertTitle>Configuración Interna (Firestore)</AlertTitle>
          <AlertDescription>El bot se activa automáticamente al recibir mensajes si el switch está ON.</AlertDescription>
        </Alert>

        {botConfig?.lastAutoReplyAt && (
          <Alert className="bg-green-500/5 border-green-500/20">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle>Actividad del Bot</AlertTitle>
            <AlertDescription>Última respuesta: {formatDate(botConfig.lastAutoReplyAt)}</AlertDescription>
          </Alert>
        )}
      </div>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="training" className="flex items-center gap-2"><Brain className="h-4 w-4" />Entrenamiento</TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2"><FileText className="h-4 w-4" />Documentos</TabsTrigger>
        </TabsList>

        <TabsContent value="training" className="space-y-4 pt-4">
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
                  onCheckedChange={(checked) => handleSave({ enabled: checked } as any)}
                  disabled={isLoading}
                />
                <Label htmlFor="bot-enabled">IA Activada</Label>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
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
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Estrategia y Personalidad</Label>
                    <Textarea 
                      placeholder="Tono, preguntas clave, objetivos de venta..." 
                      className="min-h-[150px]"
                      value={localSalesContent}
                      onChange={(e) => setLocalSalesContent(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <History className="h-3 w-3" />
                      {botConfig?.updatedAt ? `Actualizado por ${botConfig.updatedByEmail} el ${formatDate(botConfig.updatedAt)}` : 'Sin datos'}
                    </div>
                    <Button onClick={() => handleSave()} disabled={isLoading}>
                      <Save className="mr-2 h-4 w-4" />
                      Guardar en Firestore
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

          <Card className="border-muted bg-muted/20">
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                  <Terminal className="h-4 w-4" />
                  Salud del Sistema
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-[10px]" 
                  onClick={checkHealth}
                >
                  <RefreshCw className={cn("mr-1 h-3 w-3", workerHealth === 'loading' && "animate-spin")} />
                  Verificar Worker
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
               <div className="flex items-center gap-2 text-xs">
                 <span className="text-muted-foreground">Estado Worker:</span>
                 {workerHealth === 'ok' ? (
                   <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">OPERATIVO ✅</Badge>
                 ) : workerHealth === 'fail' ? (
                   <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">DESCONECTADO ❌</Badge>
                 ) : (
                   <span className="animate-pulse">Cargando...</span>
                 )}
               </div>
               <p className="mt-2 text-[10px] text-muted-foreground font-mono truncate">
                 Worker URL: {process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || 'No configurada'}
               </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <Card className="h-48 flex flex-col items-center justify-center border-dashed"><FileText className="h-10 w-10 text-muted-foreground/30" /><p className="font-medium">Carga de Documentos</p><p className="text-xs text-muted-foreground">Próximamente disponible.</p></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChatInterface({ channelId, workerUrl }: { channelId: string, workerUrl: string }) {
  const firestore = useFirestore();
  const [selectedJid, setSelectedJid] = useState<string | null>(null);

  const conversationsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'conversations'), orderBy('lastMessageAt', 'desc'), limit(50));
  }, [firestore, channelId]);

  const { data: conversations, isLoading: isLoadingConversations } = useCollection<Conversation>(conversationsQuery);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]">
      <Card className="md:col-span-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-3"><CardTitle className="text-lg">Conversaciones</CardTitle></CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            {isLoadingConversations ? <div className="p-4 space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : conversations?.length === 0 ? <div className="p-8 text-center text-sm">No hay conversaciones.</div> : (
              <div className="flex flex-col">
                {conversations?.map((conv) => (
                  <button key={conv.jid} onClick={() => setSelectedJid(conv.jid)} className={cn("flex flex-col items-start gap-1 p-4 text-left border-b hover:bg-muted/50", selectedJid === conv.jid && "bg-muted")}>
                    <div className="flex justify-between w-full font-semibold text-sm truncate">{conv.name || conv.jid}{conv.unreadCount > 0 && <span className="bg-primary text-primary-foreground rounded-full size-5 flex items-center justify-center text-[10px]">{conv.unreadCount}</span>}</div>
                    <div className="flex justify-between w-full text-xs text-muted-foreground truncate">{conv.lastMessageText || 'Sin mensajes'}<span>{conv.lastMessageAt ? format((conv.lastMessageAt as Timestamp).toDate(), 'HH:mm') : ''}</span></div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
      <Card className="md:col-span-2 flex flex-col overflow-hidden">{selectedJid ? <MessageThread channelId={channelId} jid={selectedJid} workerUrl={workerUrl} name={conversations?.find(c => c.jid === selectedJid)?.name || selectedJid} /> : <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8"><MessageSquare className="size-12 mb-4 opacity-20" /><p>Selecciona un chat.</p></div>}</Card>
    </div>
  );
}

function MessageThread({ channelId, jid, workerUrl, name }: { channelId: string, jid: string, workerUrl: string, name: string }) {
  const firestore = useFirestore();
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const messagesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'channels', channelId, 'conversations', jid, 'messages'), orderBy('timestamp', 'asc'), limit(100));
  }, [firestore, channelId, jid]);

  const { data: messages, isLoading } = useCollection<Message>(messagesQuery);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (jid && workerUrl) fetch(`${workerUrl}/v1/channels/${channelId}/conversations/${encodeURIComponent(jid)}/markRead`, { method: 'POST', mode: 'cors' }).catch(() => {});
  }, [jid, channelId, workerUrl]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || !workerUrl) return;
    setIsSending(true);
    try {
      const res = await fetch(`${workerUrl}/v1/channels/${channelId}/messages/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: jid, text: inputText.trim() }) });
      if (!res.ok) throw new Error('Error al enviar');
      setInputText('');
    } catch (e) { toast({ variant: 'destructive', title: 'Error', description: String(e) }); } finally { setIsSending(false); }
  };

  return (
    <>
      <CardHeader className="border-b py-3 px-4 flex-row justify-between"><div><CardTitle className="text-sm font-bold">{name}</CardTitle><CardDescription className="text-[10px]">{jid}</CardDescription></div></CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/20">
        <ScrollArea className="h-full p-4">
          {isLoading ? <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-10 w-1/2 ml-auto" /></div> : (
            <div className="flex flex-col gap-2">
              {messages?.map((msg) => (
                <div key={msg.id} className={cn("max-w-[80%] rounded-lg p-3 text-sm shadow-sm", msg.fromMe ? "bg-primary text-primary-foreground ml-auto rounded-tr-none" : "bg-card mr-auto rounded-tl-none")}>
                  <p>{msg.text}</p><div className="text-[10px] mt-1 opacity-70 flex justify-end gap-1">{format(new Date(msg.timestamp), 'HH:mm')}{msg.fromMe && <span>{msg.status || 'sent'}</span>}</div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          )}
        </ScrollArea>
      </CardContent>
      <div className="p-4 border-t">
        <form onSubmit={handleSendMessage} className="flex gap-2"><Input placeholder="Escribe un mensaje..." value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={isSending} /><Button type="submit" size="icon" disabled={isSending || !inputText.trim()}>{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></form>
      </div>
    </>
  );
}
