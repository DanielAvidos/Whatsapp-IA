"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, MoreHorizontal, Loader2, Building2 } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';
import type { Company, CompanyPlan, CompanyStatus } from '@/lib/types';
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

const companySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  email: z.string().email("Invalid email address."),
  plan: z.enum(['Free', 'Pro', 'Enterprise']),
  status: z.enum(['Active', 'Suspended']),
});

type CompanyFormValues = z.infer<typeof companySchema>;

export function DashboardPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const companiesQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'companies'), orderBy('createdAt', 'desc'));
  }, [firestore]);

  const { data: companies, isLoading } = useCollection<Company>(companiesQuery);

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: '', email: '', plan: 'Free', status: 'Active' },
  });

  const handleCreateCompany = async (values: CompanyFormValues) => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
      // 1. Create secondary auth instance to create user without logging out
      const secondaryAppName = `secondary-auth-${Date.now()}`;
      const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      // 2. Create user in Firebase Auth
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, values.email, "welcomm");
      const adminUid = userCred.user.uid;

      // 3. Clean up secondary instance
      await signOut(secondaryAuth);
      // Note: In some environments we might want to delete the app instance to avoid memory leaks
      // but standard initializeApp with random name is safe for occasional use.

      // 4. Create document in Firestore
      await addDoc(collection(firestore, 'companies'), {
        name: values.name,
        adminEmail: values.email,
        adminUid: adminUid,
        plan: values.plan,
        status: values.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast({ title: 'Cliente creado', description: `La empresa "${values.name}" ha sido registrada con éxito.` });
      setDialogOpen(false);
      form.reset();
    } catch (error: any) {
      console.error(error);
      let errorMessage = "No se pudo crear el cliente.";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "El correo electrónico ya está en uso por otro usuario.";
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
      toast({ variant: 'destructive', title: 'Error', description: "No se pudo actualizar el estatus." });
    }
  };

  const handleUpdatePlan = async (companyId: string, newPlan: CompanyPlan) => {
    if (!firestore) return;
    try {
      await updateDoc(doc(firestore, 'companies', companyId), {
        plan: newPlan,
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'Plan actualizado' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: "No se pudo actualizar el plan." });
    }
  };

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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleUpdateStatus(company.id, company.status === 'Active' ? 'Suspended' : 'Active')}>
                            {company.status === 'Active' ? 'Suspender' : 'Activar'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleUpdatePlan(company.id, 'Pro')}>Cambiar a Pro</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleUpdatePlan(company.id, 'Enterprise')}>Cambiar a Enterprise</DropdownMenuItem>
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
    </main>
  );
}
