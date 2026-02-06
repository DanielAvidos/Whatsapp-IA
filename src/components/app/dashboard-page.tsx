
"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, MoreHorizontal, Loader2, Building2, Link as LinkIcon } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';
import type { Company, CompanyStatus, WhatsappChannel } from '@/lib/types';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/app/status-badge';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

const companySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  email: z.string().email("Invalid email address."),
  plan: z.enum(['Free', 'Pro', 'Enterprise']),
  status: z.enum(['Active', 'Suspended']),
});

type CompanyFormValues = z.infer<typeof companySchema>;

export function DashboardPage() {
  const firestore = useFirestore();
  const { user: currentUser } = useUser();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  const companiesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'companies'), orderBy('createdAt', 'desc'));
  }, [firestore]);

  const { data: companies, isLoading } = useCollection<Company>(companiesQuery);

  // Channels for assignment
  const channelsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'channels');
  }, [firestore]);
  const { data: allChannels } = useCollection<WhatsappChannel>(channelsQuery);

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: '', email: '', plan: 'Free', status: 'Active' },
  });

  const handleCreateCompany = async (values: CompanyFormValues) => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
      const secondaryAppName = `secondary-auth-${Date.now()}`;
      const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      const userCred = await createUserWithEmailAndPassword(secondaryAuth, values.email, "welcomm");
      const adminUid = userCred.user.uid;

      await signOut(secondaryAuth);

      await addDoc(collection(firestore, 'companies'), {
        name: values.name,
        adminEmail: values.email,
        adminUid: adminUid,
        plan: values.plan,
        status: values.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast({ title: 'Cliente creado', description: `La empresa "${values.name}" ha sido registrada.` });
      setDialogOpen(false);
      form.reset();
    } catch (error: any) {
      console.error(error);
      let errorMessage = "No se pudo crear el cliente.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "El correo ya está en uso.";
      }
      toast({ variant: 'destructive', title: 'Error', description: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (companyId: string, newStatus: CompanyStatus) => {
    if (!firestore) return;
    try {
      await updateDoc(doc(firestore, 'companies', companyId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'Estatus actualizado' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: "Fallo al actualizar." });
    }
  };

  const toggleChannelAssignment = async (channel: WhatsappChannel, company: Company, isChecked: boolean) => {
    if (!firestore || !currentUser) return;
    try {
      const channelRef = doc(firestore, 'channels', channel.id);
      if (isChecked) {
        await updateDoc(channelRef, {
          companyId: company.id,
          companyName: company.name,
          assignedAt: serverTimestamp(),
          assignedBy: currentUser.email,
        });
      } else {
        await updateDoc(channelRef, {
          companyId: null,
          companyName: null,
          assignedAt: serverTimestamp(),
          assignedBy: currentUser.email,
        });
      }
    } catch (e) {
      toast({ variant: 'destructive', title: "Error en asignación", description: String(e) });
    }
  }

  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <PageHeader
        title="Clientes"
        description="Gestiona tus empresas clientes y sus accesos."
      >
        <Button onClick={() => setDialogOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Nuevo Cliente
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Listado de Clientes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Estatus</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Correo Admin</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : companies?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No hay clientes registrados.
                  </TableCell>
                </TableRow>
              ) : (
                companies?.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={company.status.toLowerCase()} />
                    </TableCell>
                    <TableCell className="capitalize">{company.plan}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{company.adminEmail}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => {
                            setSelectedCompany(company);
                            setAssignDialogOpen(true);
                          }}>
                            <LinkIcon className="mr-2 h-4 w-4" />
                            Asignar Canales
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleUpdateStatus(company.id, company.status === 'Active' ? 'Suspended' : 'Active')}>
                            {company.status === 'Active' ? 'Suspender' : 'Activar'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      {/* Create Company Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Nuevo Cliente</DialogTitle>
            <DialogDescription>Se creará un acceso para el administrador con la contraseña "welcomm".</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreateCompany)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre de la Empresa</FormLabel>
                    <FormControl><Input placeholder="e.g., Innovate Corp" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo del Administrador</FormLabel>
                    <FormControl><Input placeholder="admin@empresa.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="plan"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Plan</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar plan" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Free">Free</SelectItem>
                          <SelectItem value="Pro">Pro</SelectItem>
                          <SelectItem value="Enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estado</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar estado" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Suspended">Suspended</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>Cancelar</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</> : 'Guardar Cliente'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Assign Channels Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Asignar Canales a {selectedCompany?.name}</DialogTitle>
            <DialogDescription>Selecciona los canales de WhatsApp que pertenecen a este cliente.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4 max-h-[400px] overflow-y-auto">
            {allChannels?.map((channel) => (
              <div key={channel.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div className="flex items-center gap-3">
                  <Checkbox 
                    id={`assign-${channel.id}`}
                    checked={channel.companyId === selectedCompany?.id}
                    onCheckedChange={(checked) => {
                      if (selectedCompany) toggleChannelAssignment(channel, selectedCompany, !!checked);
                    }}
                  />
                  <div className="grid gap-0.5">
                    <label htmlFor={`assign-${channel.id}`} className="text-sm font-medium leading-none cursor-pointer">
                      {channel.displayName || channel.id}
                    </label>
                    <p className="text-xs text-muted-foreground">{channel.phoneE164 || 'Sin número'}</p>
                  </div>
                </div>
                {channel.companyId && channel.companyId !== selectedCompany?.id && (
                  <Badge variant="secondary" className="text-[10px]">
                    Asignado a: {channel.companyName}
                  </Badge>
                )}
              </div>
            ))}
            {allChannels?.length === 0 && (
              <p className="text-center text-muted-foreground text-sm">No hay canales disponibles.</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setAssignDialogOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
