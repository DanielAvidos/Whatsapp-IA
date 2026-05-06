"use client";
import { useState, useMemo } from 'react';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { collection, query, orderBy, addDoc, updateDoc, doc, serverTimestamp, Timestamp, limit } from 'firebase/firestore';
import type { Conversation, ChannelLabel, Campaign, CampaignStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Megaphone, Plus, Users, Tag, ChevronRight, ChevronLeft, Play, Pause, XCircle, Eye, Loader2, Search, Info, User, AlertTriangle, Calendar } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_CFG: Record<CampaignStatus, { label: string; cls: string }> = {
  created:   { label: 'Creada',     cls: 'bg-secondary text-secondary-foreground' },
  scheduled: { label: 'Programada', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  active:    { label: 'Activa',     cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  paused:    { label: 'Pausada',    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  completed: { label: 'Terminada',  cls: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400' },
  cancelled: { label: 'Cancelada',  cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  failed:    { label: 'Error',      cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

function phone(c: Conversation): string | null { return c.customer?.phone || c.phoneE164 || null; }
function dname(c: Conversation): string {
  return (c.customer?.name || (c.displayName !== c.jid ? c.displayName : null) || (c.name !== c.jid ? c.name : null) || c.phoneE164 || c.jid || 'Sin nombre') as string;
}

function StatusBadge({ s }: { s: CampaignStatus }) {
  const { label, cls } = STATUS_CFG[s] ?? { label: s, cls: 'bg-muted' };
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', cls)}>{label}</span>;
}

export function CampaignsView({ channelId }: { channelId: string }) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detail, setDetail] = useState<Campaign | null>(null);
  const [action, setAction] = useState<{ c: Campaign; s: CampaignStatus; label: string } | null>(null);

  const cq = useMemoFirebase(() => firestore ? query(collection(firestore, 'channels', channelId, 'campaigns'), orderBy('createdAt', 'desc'), limit(100)) : null, [firestore, channelId]);
  const convq = useMemoFirebase(() => firestore ? query(collection(firestore, 'channels', channelId, 'conversations'), orderBy('lastMessageAt', 'desc'), limit(500)) : null, [firestore, channelId]);
  const labq = useMemoFirebase(() => firestore ? query(collection(firestore, 'channels', channelId, 'labels'), orderBy('createdAt', 'desc')) : null, [firestore, channelId]);

  const { data: campaigns, isLoading } = useCollection<Campaign>(cq);
  const { data: convs } = useCollection<Conversation>(convq);
  const { data: labels } = useCollection<ChannelLabel>(labq);

  const contacts = useMemo(() => (convs || []).filter(c => c.isContact || c.customer?.isContact), [convs]);

  const handleStatusChange = async () => {
    if (!firestore || !action) return;
    try {
      await updateDoc(doc(firestore, 'channels', channelId, 'campaigns', action.c.id), { status: action.s, updatedAt: serverTimestamp() });
      toast({ title: 'Estado actualizado' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message });
    } finally { setAction(null); }
  };

  if (isLoading) return <div className='flex h-64 items-center justify-center'><Loader2 className='animate-spin text-muted-foreground' /></div>;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h3 className='text-lg font-semibold flex items-center gap-2'><Megaphone className='h-5 w-5 text-primary' />Campañas<Badge variant='secondary' className='ml-1'>{campaigns?.length ?? 0}</Badge></h3>
          <p className='text-sm text-muted-foreground'>Crea y administra campañas de mensajes para tus contactos.</p>
        </div>
        <Button size='sm' onClick={() => setWizardOpen(true)}><Plus className='h-4 w-4 mr-2' />Nueva campaña</Button>
      </div>

      {(!campaigns || campaigns.length === 0) ? (
        <div className='flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3'>
          <Megaphone className='h-12 w-12 opacity-20' />
          <p className='text-sm'>No hay campañas creadas.</p>
          <Button variant='outline' size='sm' onClick={() => setWizardOpen(true)}><Plus className='h-4 w-4 mr-2' />Nueva campaña</Button>
        </div>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {campaigns.map(c => (
            <Card key={c.id} className='shadow-none'>
              <CardContent className='p-4 space-y-2'>
                <div className='flex items-start justify-between gap-2'>
                  <p className='font-semibold text-sm truncate flex-1'>{c.name}</p>
                  <StatusBadge s={c.status} />
                </div>
                {c.description && <p className='text-xs text-muted-foreground line-clamp-2'>{c.description}</p>}
                <div className='flex flex-wrap gap-2 text-xs text-muted-foreground'>
                  <span className='flex items-center gap-1'><Users className='h-3 w-3' />{c.stats?.total ?? 0} destinatarios</span>
                  {c.schedule?.startAt && <span className='flex items-center gap-1'><Calendar className='h-3 w-3' />{format((c.schedule.startAt as Timestamp).toDate(), 'dd/MM/yy HH:mm')}</span>}
                </div>
                <div className='flex flex-wrap gap-1 pt-1'>
                  <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={() => setDetail(c)}><Eye className='h-3 w-3 mr-1' />Ver</Button>
                  {['created','scheduled','paused'].includes(c.status) && (
                    <Button variant='ghost' size='sm' className='h-7 text-xs text-green-700' onClick={() => setAction({ c, s: 'active', label: 'Iniciar campaña' })}><Play className='h-3 w-3 mr-1' />Iniciar</Button>
                  )}
                  {c.status === 'active' && (
                    <Button variant='ghost' size='sm' className='h-7 text-xs text-amber-700' onClick={() => setAction({ c, s: 'paused', label: 'Pausar campaña' })}><Pause className='h-3 w-3 mr-1' />Pausar</Button>
                  )}
                  {['created','scheduled','paused'].includes(c.status) && (
                    <Button variant='ghost' size='sm' className='h-7 text-xs text-destructive' onClick={() => setAction({ c, s: 'cancelled', label: 'Cancelar campaña' })}><XCircle className='h-3 w-3 mr-1' />Cancelar</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewCampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} channelId={channelId} contacts={contacts} labels={labels || []} />

      <AlertDialog open={!!action} onOpenChange={o => { if (!o) setAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{action?.label}</AlertDialogTitle>
            <AlertDialogDescription>Esta accion solo actualizara el estado en Firestore. No se enviaran mensajes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleStatusChange}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detail && <CampaignDetailDialog campaign={detail} onOpenChange={o => { if (!o) setDetail(null); }} />}
    </div>
  );
}

function NewCampaignWizard({ open, onOpenChange, channelId, contacts, labels }: {
  open: boolean; onOpenChange: (v: boolean) => void; channelId: string;
  contacts: Conversation[]; labels: ChannelLabel[];
}) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [cIds, setCIds] = useState<string[]>([]);
  const [useDate, setUseDate] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [tagQ, setTagQ] = useState('');
  const [conQ, setConQ] = useState('');

  const reset = () => { setStep(0); setName(''); setDesc(''); setMsg(''); setTagIds([]); setCIds([]); setUseDate(false); setStartAt(''); setTagQ(''); setConQ(''); };

  const resolved = useMemo(() => {
    const m = new Map<string, Conversation>();
    contacts.forEach(c => { if (tagIds.length && c.labelIds?.some(id => tagIds.includes(id))) m.set(c.id, c); });
    cIds.forEach(id => { const c = contacts.find(x => x.id === id); if (c) m.set(c.id, c); });
    return Array.from(m.values());
  }, [contacts, tagIds, cIds]);

  const valid = useMemo(() => resolved.filter(c => !!phone(c)), [resolved]);
  const invalid = useMemo(() => resolved.filter(c => !phone(c)), [resolved]);

  const filtTags = labels.filter(l => l.name.toLowerCase().includes(tagQ.toLowerCase()));
  const filtCons = contacts.filter(c => dname(c).toLowerCase().includes(conQ.toLowerCase()) || (phone(c) || '').includes(conQ)).slice(0, 80);

  const canNext = [name.trim() && msg.trim(), resolved.length > 0 && valid.length > 0, true, true][step];
  const STEPS = ['Datos', 'Audiencia', 'Programa', 'Confirmar'];

  const handleCreate = async () => {
    if (!firestore) return;
    setSaving(true);
    try {
      const mode = tagIds.length > 0 && cIds.length > 0 ? 'mixed' : tagIds.length > 0 ? 'tags' : 'contacts';
      const schedTs = useDate && startAt ? Timestamp.fromDate(new Date(startAt)) : null;
      const status: CampaignStatus = schedTs ? 'scheduled' : 'created';
      const ref = await addDoc(collection(firestore, 'channels', channelId, 'campaigns'), {
        name: name.trim(), description: desc.trim() || null, message: msg.trim(), status,
        audience: { mode, tagIds, contactIds: cIds, resolvedContactIds: resolved.map(c => c.id), totalResolved: resolved.length, totalValidPhones: valid.length, totalInvalidPhones: invalid.length },
        schedule: { startAt: schedTs, timezone: 'America/Mexico_City', manualStartAllowed: true },
        stats: { total: resolved.length, pending: valid.length, sent: 0, failed: 0, skipped: invalid.length },
        createdByUid: user?.uid || null, createdByEmail: user?.email || null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      for (const c of valid) {
        await addDoc(collection(firestore, 'channels', channelId, 'campaigns', ref.id, 'recipients'), {
          contactId: c.id, displayName: dname(c), phone: phone(c)!, email: c.customer?.email || null,
          company: c.customer?.company || null, tagIds: c.labelIds || [],
          status: 'pending', error: null, sentAt: null, createdAt: serverTimestamp(),
        });
      }
      toast({ title: 'Campaña creada', description: name.trim() });
      onOpenChange(false); reset();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className='max-w-lg max-h-[90vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle>Nueva campaña — {STEPS[step]}</DialogTitle>
          <div className='flex gap-1 pt-1'>
            {STEPS.map((s, i) => <div key={s} className={cn('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-primary' : 'bg-muted')} />)}
          </div>
        </DialogHeader>
        <div className='flex-1 overflow-y-auto min-h-0 py-2 space-y-3'>
          {step === 0 && <>
            <div className='space-y-1'><Label>Nombre <span className='text-destructive'>*</span></Label><Input value={name} onChange={e => setName(e.target.value)} placeholder='Nombre de la campaña' /></div>
            <div className='space-y-1'><Label>Descripcion</Label><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder='Descripcion interna opcional' /></div>
            <div className='space-y-1'>
              <Label>Mensaje <span className='text-destructive'>*</span></Label>
              <Textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder='Escribe el mensaje...' className='min-h-[100px]' />
              <p className='text-xs text-muted-foreground'>Variables disponibles: {'{{nombre}}'} {'{{telefono}}'} {'{{empresa}}'}</p>
            </div>
          </>}
          {step === 1 && <>
            <div className='rounded-lg border bg-muted/30 p-3 space-y-2'>
              <p className='text-xs font-semibold text-muted-foreground'>Etiquetas</p>
              <div className='relative'><Search className='absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground' /><input className='w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none' placeholder='Buscar etiqueta...' value={tagQ} onChange={e => setTagQ(e.target.value)} /></div>
              <div className='max-h-28 overflow-y-auto space-y-1'>
                {filtTags.map(l => <label key={l.id} className='flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer'><Checkbox checked={tagIds.includes(l.id)} onCheckedChange={ch => setTagIds(p => ch ? [...p, l.id] : p.filter(x => x !== l.id))} />{l.name}</label>)}
                {filtTags.length === 0 && <p className='text-xs text-muted-foreground py-2 text-center'>Sin etiquetas</p>}
              </div>
            </div>
            <div className='rounded-lg border bg-muted/30 p-3 space-y-2'>
              <p className='text-xs font-semibold text-muted-foreground'>Contactos individuales</p>
              <div className='relative'><Search className='absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground' /><input className='w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none' placeholder='Buscar contacto...' value={conQ} onChange={e => setConQ(e.target.value)} /></div>
              <div className='max-h-36 overflow-y-auto space-y-1'>
                {filtCons.map(c => <label key={c.id} className='flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer'><Checkbox checked={cIds.includes(c.id)} onCheckedChange={ch => setCIds(p => ch ? [...p, c.id] : p.filter(x => x !== c.id))} /><span className='truncate'>{dname(c)}</span><span className='text-xs text-muted-foreground shrink-0'>{phone(c) || 'sin tel'}</span></label>)}
                {filtCons.length === 0 && <p className='text-xs text-muted-foreground py-2 text-center'>Sin resultados</p>}
              </div>
            </div>
            <div className='flex flex-wrap gap-2 text-xs'>
              <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-medium'><Users className='h-3 w-3' />{valid.length} validos</span>
              {invalid.length > 0 && <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 font-medium'><AlertTriangle className='h-3 w-3' />{invalid.length} sin telefono</span>}
              {resolved.length === 0 && <span className='text-muted-foreground italic'>Selecciona etiquetas o contactos</span>}
            </div>
            {resolved.length > 0 && (
              <div className='max-h-36 overflow-y-auto rounded-lg border text-xs'>
                {resolved.slice(0, 60).map(c => <div key={c.id} className='flex justify-between items-center px-3 py-1.5 border-b last:border-0'><span className='truncate flex-1 flex items-center gap-1'>{!phone(c) && <AlertTriangle className='h-3 w-3 text-destructive shrink-0' />}{dname(c)}</span><span className='text-muted-foreground shrink-0 ml-2'>{phone(c) || '—'}</span></div>)}
                {resolved.length > 60 && <div className='text-center py-1 text-muted-foreground'>+{resolved.length - 60} mas</div>}
              </div>
            )}
            {valid.length === 0 && resolved.length > 0 && <p className='text-xs text-destructive flex items-center gap-1'><AlertTriangle className='h-3 w-3' />Ningun contacto tiene telefono valido</p>}
          </>}
          {step === 2 && <div className='space-y-4'>
            <label className='flex items-center gap-3 cursor-pointer'><Checkbox checked={useDate} onCheckedChange={v => setUseDate(!!v)} /><span className='text-sm font-medium'>Programar fecha de inicio</span></label>
            {useDate && <div className='space-y-1'><Label>Fecha y hora</Label><Input type='datetime-local' value={startAt} onChange={e => setStartAt(e.target.value)} /></div>}
            <div className='rounded-lg border bg-amber-50 dark:bg-amber-900/10 p-3 flex gap-2'>
              <Info className='h-4 w-4 text-amber-600 shrink-0 mt-0.5' />
              <p className='text-xs text-amber-800 dark:text-amber-300'>La fecha no dispara envios automaticos en esta version. Solo cambia el estado a Programada.</p>
            </div>
          </div>}
          {step === 3 && <div className='space-y-3 text-sm'>
            <div className='rounded-lg border p-3 space-y-2'>
              <p className='font-semibold'>{name}</p>
              {desc && <p className='text-xs text-muted-foreground'>{desc}</p>}
              <div className='bg-muted/40 rounded p-2 text-xs whitespace-pre-wrap font-mono'>{msg}</div>
            </div>
            <div className='grid grid-cols-2 gap-2'>
              <div className='rounded-lg border bg-muted/30 p-2 text-center'><p className='text-lg font-bold text-green-700'>{valid.length}</p><p className='text-xs text-muted-foreground'>Validos</p></div>
              <div className='rounded-lg border bg-muted/30 p-2 text-center'><p className='text-lg font-bold text-muted-foreground'>{invalid.length}</p><p className='text-xs text-muted-foreground'>Sin telefono</p></div>
            </div>
            {useDate && startAt && <p className='text-xs flex items-center gap-1 text-muted-foreground'><Calendar className='h-3 w-3' />Inicio: {format(new Date(startAt), 'dd/MM/yyyy HH:mm')}</p>}
            <div className='rounded-lg border bg-blue-50 dark:bg-blue-900/10 p-3 flex gap-2'>
              <Info className='h-4 w-4 text-blue-600 shrink-0 mt-0.5' />
              <p className='text-xs text-blue-800 dark:text-blue-300'>Esta version solo guarda la estructura. El envio automatico se implementara en una fase posterior.</p>
            </div>
          </div>}
        </div>
        <DialogFooter className='border-t pt-3 gap-2'>
          <Button variant='outline' onClick={() => step === 0 ? onOpenChange(false) : setStep(s => s - 1)} disabled={saving}><ChevronLeft className='h-4 w-4 mr-1' />{step === 0 ? 'Cancelar' : 'Anterior'}</Button>
          {step < 3 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canNext}><ChevronRight className='h-4 w-4 mr-1' />Siguiente</Button>
          ) : (
            <Button onClick={handleCreate} disabled={saving || valid.length === 0}>{saving && <Loader2 className='h-4 w-4 mr-2 animate-spin' />}Crear campaña</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDetailDialog({ campaign: c, onOpenChange }: { campaign: Campaign; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg max-h-[90vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>{c.name}</DialogTitle>
          <DialogDescription asChild><div className='flex items-center gap-2 flex-wrap'><StatusBadge s={c.status} />{c.description && <span className='text-xs'>{c.description}</span>}</div></DialogDescription>
        </DialogHeader>
        <div className='flex-1 overflow-y-auto space-y-3 py-2 text-sm'>
          <div className='rounded-lg border bg-muted/30 p-3 space-y-1'>
            <p className='text-xs font-semibold text-muted-foreground'>MENSAJE</p>
            <p className='whitespace-pre-wrap text-sm'>{c.message}</p>
          </div>
          <div className='grid grid-cols-2 gap-2'>
            {[['Total', c.stats?.total ?? 0], ['Validos', c.stats?.pending ?? 0], ['Enviados', c.stats?.sent ?? 0], ['Errores', c.stats?.failed ?? 0]].map(([l, v]) => (
              <div key={String(l)} className='rounded-lg border bg-muted/30 p-2 text-center'><p className='text-lg font-bold'>{v}</p><p className='text-xs text-muted-foreground'>{l}</p></div>
            ))}
          </div>
          <div className='rounded-lg border bg-amber-50 dark:bg-amber-900/10 p-3 flex gap-2'>
            <Info className='h-4 w-4 text-amber-600 shrink-0 mt-0.5' />
            <p className='text-xs text-amber-800 dark:text-amber-300'>Esta version solo guarda la estructura de la campaña. El envio automatico se implementara en una fase posterior.</p>
          </div>
        </div>
        <DialogFooter className='border-t pt-3'><Button onClick={() => onOpenChange(false)}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
