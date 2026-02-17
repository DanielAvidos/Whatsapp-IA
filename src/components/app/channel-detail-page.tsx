
"use client";

import { useState, useEffect, useRef } from 'react';
import { Loader2, ScanQrCode, LogOut, RotateCcw, MessageSquare, Link as LinkIcon, Send, Bot, FileText, Save, History, Brain, Info, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { doc, collection, query, orderBy, limit, Timestamp, setDoc, serverTimestamp } from 'firebase/firestore';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/context/language-provider';
import type { WhatsappChannel, Conversation, Message, AITrainingDoc, AISettings } from '@/lib/types';
import { StatusBadge } from '@/components/app/status-badge';
import { QrCodeDialog } from '@/components/app/qr-code-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

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

  const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL;

  const handleApiCall = async (endpoint: string, successMessage: string, errorMessage: string) => {
    if (!workerUrl) {
      toast({ variant: 'destructive', title: 'Worker URL not configured', description: 'Please set NEXT_PUBLIC_BAILEYS_WORKER_URL' });
      return;
    }
    toast({ title: successMessage });
    try {
      await fetch(`${workerUrl}/v1/channels/${channelId}${endpoint}`, { method: 'POST', mode: 'cors' });
    } catch (error) {
      toast({ variant: 'destructive', title: errorMessage, description: String(error) });
    }
  }

  const handleGenerateQr = () => handleApiCall('/qr', 'Generating new QR code...', 'Failed to request QR code');
  const handleDisconnect = () => handleApiCall('/disconnect', 'Disconnecting...', 'Failed to disconnect');
  const handleResetSession = () => handleApiCall('/resetSession', 'Resetting session...', 'Failed to reset session');

  return (
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
          <AlertTitle>Incomplete Configuration</AlertTitle>
          <AlertDescription>The environment variable NEXT_PUBLIC_BAILEYS_WORKER_URL is not configured.</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="connection" className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4" />
            Connection
          </TabsTrigger>
          <TabsTrigger value="chats" className="flex items-center gap-2" disabled={channel?.status !== 'CONNECTED'}>
            <MessageSquare className="h-4 w-4" />
            Chats
          </TabsTrigger>
          <TabsTrigger value="chatbot" className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Chatbot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connection">
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
                      <span className="font-medium">{channel?.displayName ?? 'Main Channel'}</span>
                      <StatusBadge status={channel?.status === 'QR' ? 'CONNECTING' : (channel?.status || 'DISCONNECTED')} />
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
                      Generate/Refresh QR
                  </Button>
                  <Button variant="outline" onClick={handleResetSession} disabled={isLoading || !workerUrl}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset Session
                  </Button>
                  <Button variant="destructive" onClick={handleDisconnect} disabled={isLoading || !workerUrl || channel?.status !== 'CONNECTED'}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Disconnect
                  </Button>
                </div>
                 {channel?.lastError && (
                   <Alert variant="destructive">
                     <AlertTitle>Last Error</AlertTitle>
                     <AlertDescription>{channel.lastError?.message || JSON.stringify(channel.lastError)}</AlertDescription>
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
                         {channel?.status === 'CONNECTING' ? 'Generating QR...' : 'No QR available yet. Generate one to start.'}
                      </p>
                  </div>
                )}
                 <p className="text-center text-sm text-muted-foreground">
                      {t('scan.qr.instruction')}
                  </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="chats">
          {workerUrl && <ChatInterface channelId={channelId} workerUrl={workerUrl} />}
        </TabsContent>

        <TabsContent value="chatbot">
          <ChatbotConfig channelId={channelId} channel={channel} />
        </TabsContent>
      </Tabs>

      <QrCodeDialog 
        qrDataUrl={channel?.qrDataUrl ?? null} 
        isOpen={isQrModalOpen}
        onOpenChange={setQrModalOpen} 
      />
    </main>
  );
}

function ChatbotConfig({ channelId, channel }: { channelId: string, channel: WhatsappChannel | null }) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('training');

  // Firestore Refs
  const productDetailsRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId, 'ai_training', 'product_details');
  }, [firestore, channelId]);

  const salesStrategyRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId, 'ai_training', 'sales_strategy');
  }, [firestore, channelId]);

  const aiSettingsRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return doc(firestore, 'channels', channelId, 'ai_training', 'settings');
  }, [firestore, channelId]);

  // Data
  const { data: productDetails, isLoading: isLoadingProduct } = useDoc<AITrainingDoc>(productDetailsRef);
  const { data: salesStrategy, isLoading: isLoadingStrategy } = useDoc<AITrainingDoc>(salesStrategyRef);
  const { data: aiSettings, isLoading: isLoadingSettings } = useDoc<AISettings>(aiSettingsRef);

  // Local State for Editing
  const [localProductContent, setLocalProductContent] = useState('');
  const [localSalesContent, setLocalSalesContent] = useState('');
  const [localEnabled, setLocalEnabled] = useState(false);

  useEffect(() => {
    if (productDetails) setLocalProductContent(productDetails.content || '');
  }, [productDetails]);

  useEffect(() => {
    if (salesStrategy) setLocalSalesContent(salesStrategy.content || '');
  }, [salesStrategy]);

  useEffect(() => {
    if (aiSettings) setLocalEnabled(aiSettings.enabled || false);
  }, [aiSettings]);

  const handleSave = async () => {
    if (!firestore || !user) return;
    setIsSaving(true);
    try {
      const commonData = {
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
        updatedByEmail: user.email || '',
      };

      await Promise.all([
        setDoc(productDetailsRef!, { ...commonData, content: localProductContent }, { merge: true }),
        setDoc(salesStrategyRef!, { ...commonData, content: localSalesContent }, { merge: true }),
        setDoc(aiSettingsRef!, { ...commonData, enabled: localEnabled }, { merge: true }),
      ]);

      toast({ title: 'Conocimiento guardado', description: 'La configuración de la IA ha sido actualizada.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (val: any) => {
    if (!val) return null;
    if (val instanceof Timestamp) return format(val.toDate(), 'PPpp');
    if (val?.toDate) return format(val.toDate(), 'PPpp');
    return 'Recién actualizado';
  };

  const isLoading = isLoadingProduct || isLoadingStrategy || isLoadingSettings;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Alert className="bg-primary/5 border-primary/20">
          <Info className="h-4 w-4" />
          <AlertTitle>Configuración de Estrategia</AlertTitle>
          <AlertDescription>
            Define el conocimiento y la personalidad del asistente. 
            <strong> Nota:</strong> Las respuestas automáticas se activan con el switch.
          </AlertDescription>
        </Alert>

        {aiSettings?.lastAutoReplyAt && (
          <Alert className="bg-green-500/5 border-green-500/20">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle>Estado del Bot</AlertTitle>
            <AlertDescription>
              Última auto-respuesta: <span className="font-medium">{formatDate(aiSettings.lastAutoReplyAt)}</span>
            </AlertDescription>
          </Alert>
        )}

        {channel?.lastBotError && (
          <Alert variant="destructive" className="md:col-span-2">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error en la última ejecución del Bot</AlertTitle>
            <AlertDescription>
              {channel.lastBotError.message} <span className="text-[10px] opacity-70">({formatDate(channel.lastBotError.at)})</span>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="training" className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Entrenamiento
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Documentos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="training" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-lg">Conocimiento y Personalidad</CardTitle>
                <CardDescription>Define qué sabe y cómo habla tu asistente.</CardDescription>
              </div>
              <div className="flex items-center space-x-2">
                <Switch 
                  id="bot-enabled" 
                  checked={localEnabled} 
                  onCheckedChange={setLocalEnabled}
                />
                <Label htmlFor="bot-enabled" className="cursor-pointer">Activar chatbot</Label>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Detalles del Producto (Knowledge Base)</Label>
                    <Textarea 
                      placeholder="Pega información objetiva del producto/servicio: características, precios, ubicación, etc." 
                      className="min-h-[150px] resize-none"
                      value={localProductContent}
                      onChange={(e) => setLocalProductContent(e.target.value)}
                    />
                    {productDetails?.updatedAt && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <History className="h-3 w-3" />
                        <span>Actualizado el {formatDate(productDetails.updatedAt)} por {productDetails.updatedByEmail}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Estrategia de Ventas (Personalidad)</Label>
                    <Textarea 
                      placeholder="Define tono, preguntas clave, manejo de objeciones, etc." 
                      className="min-h-[150px] resize-none"
                      value={localSalesContent}
                      onChange={(e) => setLocalSalesContent(e.target.value)}
                    />
                    {salesStrategy?.updatedAt && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <History className="h-3 w-3" />
                        <span>Actualizado el {formatDate(salesStrategy.updatedAt)} por {salesStrategy.updatedByEmail}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <Button 
                      onClick={handleSave} 
                      disabled={isSaving}
                      className="w-full sm:w-auto"
                    >
                      {isSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Guardar Conocimiento
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Documentos y Archivos</CardTitle>
              <CardDescription>Sube PDFs o archivos de texto para ampliar el conocimiento.</CardDescription>
            </CardHeader>
            <CardContent className="h-48 flex flex-col items-center justify-center text-center space-y-3 bg-muted/20 rounded-lg border-2 border-dashed mx-6 mb-6">
              <FileText className="h-10 w-10 text-muted-foreground/30" />
              <div className="space-y-1">
                <p className="font-medium">Próximamente</p>
                <p className="text-xs text-muted-foreground">
                  Estamos trabajando para que puedas subir tus manuales y documentos.
                </p>
              </div>
            </CardContent>
          </Card>
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
    return query(
      collection(firestore, 'channels', channelId, 'conversations'),
      orderBy('lastMessageAt', 'desc'),
      limit(50)
    );
  }, [firestore, channelId]);

  const { data: conversations, isLoading: isLoadingConversations } = useCollection<Conversation>(conversationsQuery);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]">
      <Card className="md:col-span-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Conversations</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            {isLoadingConversations ? (
              <div className="p-4 space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : conversations?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No conversations yet.
              </div>
            ) : (
              <div className="flex flex-col">
                {conversations?.map((conv) => (
                  <button
                    key={conv.jid}
                    onClick={() => setSelectedJid(conv.jid)}
                    className={cn(
                      "flex flex-col items-start gap-1 p-4 text-left border-b transition-colors hover:bg-muted/50",
                      selectedJid === conv.jid && "bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-semibold text-sm truncate max-w-[150px]">
                        {conv.name || conv.jid}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full size-5">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
                      <span className="truncate max-w-[180px]">
                        {conv.lastMessageText || 'No message'}
                      </span>
                      <span>
                        {conv.lastMessageAt ? format((conv.lastMessageAt as Timestamp).toDate(), 'HH:mm') : ''}
                      </span>
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
            workerUrl={workerUrl} 
            name={conversations?.find(c => c.jid === selectedJid)?.name || selectedJid}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <MessageSquare className="size-12 mb-4 opacity-20" />
            <p>Select a conversation to start chatting.</p>
          </div>
        )}
      </Card>
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
    return query(
      collection(firestore, 'channels', channelId, 'conversations', jid, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(100)
    );
  }, [firestore, channelId, jid]);

  const { data: messages, isLoading } = useCollection<Message>(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Mark as read when opening thread
  useEffect(() => {
    if (jid && workerUrl) {
       fetch(`${workerUrl}/v1/channels/${channelId}/conversations/${encodeURIComponent(jid)}/markRead`, { method: 'POST', mode: 'cors' })
        .catch(() => {});
    }
  }, [jid, channelId, workerUrl]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || !workerUrl) return;

    setIsSending(true);
    try {
      const response = await fetch(`${workerUrl}/v1/channels/${channelId}/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: jid, text: inputText.trim() }),
      });

      if (!response.ok) throw new Error('Failed to send message');
      
      setInputText('');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error sending message', description: String(error) });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <CardHeader className="border-b py-3 px-4 flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm font-bold">{name}</CardTitle>
          <CardDescription className="text-[10px] truncate">{jid}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/20">
        <ScrollArea className="h-full p-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-10 w-1/2 ml-auto" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {messages?.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "max-w-[80%] rounded-lg p-3 text-sm shadow-sm",
                    msg.fromMe 
                      ? "bg-primary text-primary-foreground ml-auto rounded-tr-none" 
                      : "bg-card text-card-foreground mr-auto rounded-tl-none"
                  )}
                >
                  <p>{msg.text}</p>
                  <div className={cn(
                    "text-[10px] mt-1 opacity-70 flex justify-end items-center gap-1",
                    msg.fromMe ? "text-primary-foreground" : "text-muted-foreground"
                  )}>
                    {format(new Date(msg.timestamp), 'HH:mm')}
                    {msg.fromMe && (
                       <span className="capitalize">{msg.status || 'sent'}</span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          )}
        </ScrollArea>
      </CardContent>
      <div className="p-4 border-t">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isSending}
          />
          <Button type="submit" size="icon" disabled={isSending || !inputText.trim()}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </>
  );
}
