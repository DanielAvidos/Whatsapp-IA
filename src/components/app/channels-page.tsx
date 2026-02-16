"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { collection, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, RotateCcw, Wrench, Edit2, Building2, MessageSquare, Link as LinkIcon } from 'lucide-react';
import { StatusBadge } from '@/components/app/status-badge';
import type { WhatsappChannel, Company } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { getIsSuperAdmin, getMyCompany } from '@/lib/auth-helpers';
import { Badge } from '@/components/ui/badge';

const channelSchema = z.object({
  displayName: z.string().min(2, "Alias must be at least 2 characters."),
});

type ChannelFormValues = z.infer<typeof channelSchema>;

export function ChannelsPage() {
    const firestore = useFirestore();
    const { user } = useUser();
    const { toast } = useToast();
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState<WhatsappChannel | null>(null);
    const [myCompanyId, setMyCompanyId] = useState<string | null>(null);
    const [isResolvingCompany, setIsResolvingCompany] = useState(false);
    
    const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL;
    const isSuperAdmin = getIsSuperAdmin(user);

    useEffect(() => {
      async function resolve() {
        if (!firestore || !user || isSuperAdmin) return;
        setIsResolvingCompany(true);
        const company = await getMyCompany(firestore, user);
        setMyCompanyId(company?.id || null);
        setIsResolvingCompany(false);
      }
      resolve();
    }, [firestore, user, isSuperAdmin]);

    // Queries for channels
    const channelsQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        const colRef = collection(firestore, 'channels');
        if (isSuperAdmin) {
          return colRef;
        }
        if (!myCompanyId) return null;
        return query(colRef, where('companyId', '==', myCompanyId));
    }, [firestore, isSuperAdmin, myCompanyId]);

    const { data: channels, isLoading } = useCollection<WhatsappChannel>(channelsQuery);

    // Query for companies (only for superadmin assignment)
    const companiesQuery = useMemoFirebase(() => {
      if (!firestore || !isSuperAdmin) return null;
      return collection(firestore, 'companies');
    }, [firestore, isSuperAdmin]);
    const { data: companiesList } = useCollection<Company>(companiesQuery);

    const addForm = useForm<ChannelFormValues>({
      resolver: zodResolver(channelSchema),
      defaultValues: { displayName: '' },
    });

    const editForm = useForm<ChannelFormValues>({
      resolver: zodResolver(channelSchema),
      defaultValues: { displayName: '' },
    });

    const onAddChannel = async (values: ChannelFormValues) => {
        if (!workerUrl) {
            toast({ variant: 'destructive', title: "Error", description: "Worker URL not configured." });
            return;
        }
        try {
            const response = await fetch(`${workerUrl}/v1/channels`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName: values.displayName }),
            });

            if (!response.ok) throw new Error('Failed to create channel');
            
            toast({ title: "Canal creado", description: `El canal "${values.displayName}" ha sido añadido.` });
            setAddDialogOpen(false);
            addForm.reset();
        } catch (error) {
            toast({ variant: 'destructive', title: "Error al crear canal", description: String(error) });
        }
    };

    const onEditAlias = async (values: ChannelFormValues) => {
      if (!selectedChannel || !workerUrl) return;
      try {
          const response = await fetch(`${workerUrl}/v1/channels/${selectedChannel.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ displayName: values.displayName }),
          });

          if (!response.ok) throw new Error('Failed to update alias');
          
          toast({ title: "Alias actualizado", description: `Alias actualizado a "${values.displayName}".` });
          setEditDialogOpen(false);
          setSelectedChannel(null);
      } catch (error) {
          toast({ variant: 'destructive', title: "Error al actualizar alias", description: String(error) });
      }
    };

    const handleAction = async (channelId: string, endpoint: string, successTitle: string) => {
        if (!workerUrl) {
            toast({ variant: 'destructive', title: "Error", description: "Worker URL not configured." });
            return;
        }
        try {
            const response = await fetch(`${workerUrl}/v1/channels/${channelId}${endpoint}`, {
                method: 'POST',
            });
            if (!response.ok) throw new Error(`Action failed with status ${response.status}`);
            toast({ title: successTitle });
        } catch (error) {
            toast({ variant: 'destructive', title: "Acción fallida", description: String(error) });
        }
    };

    const handleAssignChannel = async (channelId: string, companyId: string | null) => {
      if (!firestore) return;
      try {
        const company = companyId === "none" ? null : companiesList?.find(c => c.id === companyId);
        const channelRef = doc(firestore, 'channels', channelId);
        await updateDoc(channelRef, {
          companyId: company?.id || null,
          companyName: company?.name || null,
          updatedAt: serverTimestamp(),
        });
        toast({ title: company ? "Canal asignado" : "Asignación quitada" });
        setAssignDialogOpen(false);
      } catch (error) {
        toast({ variant: 'destructive', title: "Error en asignación", description: String(error) });
      }
    };

    const getStatusForBadge = (status: WhatsappChannel['status'] | undefined) => {
        if (!status) return 'DISCONNECTED';
        if (status === 'QR') return 'CONNECTING';
        return status;
    };

    const showLoading = isLoading || (isResolvingCompany && !isSuperAdmin);

    return (
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
            <PageHeader title="Canales de WhatsApp" description="Gestiona tus números de WhatsApp conectados.">
                {isSuperAdmin && (
                  <Button onClick={() => setAddDialogOpen(true)}>
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Añadir Canal
                  </Button>
                )}
            </PageHeader>

            <Card>
                <CardHeader><CardTitle>Lista de Canales</CardTitle></CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Teléfono</TableHead>
                                {isSuperAdmin && <TableHead>Empresa</TableHead>}
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {showLoading && (
                                <TableRow>
                                    <TableCell colSpan={isSuperAdmin ? 5 : 4}>
                                        <div className="space-y-2">
                                            <Skeleton className="h-8 w-full" />
                                            <Skeleton className="h-8 w-full" />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                            {channels?.map((channel) => (
                                <TableRow key={channel.id}>
                                    <TableCell className="font-medium">
                                      {channel.displayName || channel.id}
                                    </TableCell>
                                    <TableCell><StatusBadge status={getStatusForBadge(channel.status)} /></TableCell>
                                    <TableCell>{channel.phoneE164 || 'Sin vincular'}</TableCell>
                                    {isSuperAdmin && (
                                      <TableCell>
                                        {channel.companyName ? (
                                          <Badge variant="outline" className="flex items-center gap-1 w-fit">
                                            <Building2 className="h-3 w-3" />
                                            {channel.companyName}
                                          </Badge>
                                        ) : (
                                          <span className="text-muted-foreground text-xs">Sin asignar</span>
                                        )}
                                      </TableCell>
                                    )}
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button asChild variant="outline" size="sm">
                                                <Link href={`/channels/${channel.id}`}>Gestionar</Link>
                                            </Button>
                                            
                                            <DropdownMenu modal={false}>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {isSuperAdmin && (
                                                      <>
                                                        <DropdownMenuItem onSelect={() => {
                                                          setSelectedChannel(channel);
                                                          editForm.setValue('displayName', channel.displayName || '');
                                                          setEditDialogOpen(true);
                                                        }}>
                                                            <Edit2 className="mr-2 h-4 w-4" />
                                                            Editar Alias
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => {
                                                          setSelectedChannel(channel);
                                                          setAssignDialogOpen(true);
                                                        }}>
                                                            <LinkIcon className="mr-2 h-4 w-4" />
                                                            {channel.companyId ? "Reasignar Empresa" : "Asignar a Empresa"}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => handleAction(channel.id, '/repair', 'Reparación iniciada')}>
                                                            <Wrench className="mr-2 h-4 w-4" />
                                                            Reparar Canal
                                                        </DropdownMenuItem>
                                                      </>
                                                    )}
                                                    <DropdownMenuItem onSelect={() => handleAction(channel.id, '/resetSession', 'Sesión reseteada')}>
                                                        <RotateCcw className="mr-2 h-4 w-4" />
                                                        Resetear Sesión
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                             {!showLoading && channels?.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={isSuperAdmin ? 5 : 4} className="text-center py-12">
                                        <div className="flex flex-col items-center gap-2">
                                          <MessageSquare className="h-8 w-8 text-muted-foreground opacity-20" />
                                          <p className="text-muted-foreground">
                                            {isSuperAdmin ? "No hay canales. Añade uno para empezar." : "Aún no tienes canales asignados a tu empresa."}
                                          </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Add Channel Dialog */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Añadir Nuevo Canal de WhatsApp</DialogTitle>
                  <DialogDescription>Ingresa un nombre para el nuevo canal.</DialogDescription>
                </DialogHeader>
                <Form {...addForm}>
                  <form onSubmit={addForm.handleSubmit(onAddChannel)} className="space-y-4">
                    <FormField
                      control={addForm.control}
                      name="displayName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre Visible</FormLabel>
                          <FormControl>
                            <Input placeholder="Ej: Soporte Ventas" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>Cancelar</Button>
                      <Button type="submit">Crear</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

            {/* Edit Alias Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Editar Alias del Canal</DialogTitle>
                  <DialogDescription>Actualiza el nombre visible de este canal.</DialogDescription>
                </DialogHeader>
                <Form {...editForm}>
                  <form onSubmit={editForm.handleSubmit(onEditAlias)} className="space-y-4">
                    <FormField
                      control={editForm.control}
                      name="displayName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre Visible</FormLabel>
                          <FormControl>
                            <Input placeholder="Ej: Soporte Ventas" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancelar</Button>
                      <Button type="submit">Guardar Cambios</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

            {/* Assign Company Dialog */}
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Asignar Canal a Empresa</DialogTitle>
                  <DialogDescription>
                    Selecciona la empresa a la que pertenece el canal <strong>{selectedChannel?.displayName || selectedChannel?.id}</strong>.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Select 
                    onValueChange={(val) => handleAssignChannel(selectedChannel?.id!, val)}
                    defaultValue={selectedChannel?.companyId || "none"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin asignar (Quitar)</SelectItem>
                      {companiesList?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cerrar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
        </main>
    );
}
