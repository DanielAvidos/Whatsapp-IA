"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, MoreHorizontal, Wand2 } from 'lucide-react';
import { useTenants, addTenant, updateTenant, availablePlans, availableTenantStatus, generateDemoData } from '@/lib/data';
import type { Tenant } from '@/lib/types';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/app/status-badge';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';

const tenantSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  plan: z.enum(availablePlans),
  status: z.enum(availableTenantStatus),
});

type TenantFormValues = z.infer<typeof tenantSchema>;

function TenantForm({ tenant, onSave, onCancel }: { tenant?: Tenant; onSave: (data: TenantFormValues, id?: string) => void; onCancel: () => void; }) {
  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: tenant || { name: '', plan: 'free', status: 'active' },
  });

  const onSubmit = (data: TenantFormValues) => {
    onSave(data, tenant?.id);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tenant Name</FormLabel>
              <FormControl><Input placeholder="e.g., Innovate Corp" {...field} /></FormControl>
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
                  <FormControl><SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {availablePlans.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
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
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select a status" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {availableTenantStatus.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Save Tenant</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function DashboardPage() {
  const tenants = useTenants();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingTenant, setEditingTenant] = React.useState<Tenant | undefined>(undefined);
  const { toast } = useToast();
  const { user } = useUser();
  const isAdmin = user?.uid === 'd6Agbzw3qpgHtykUBnBDs86vg1S2';

  const handleOpenDialog = (tenant?: Tenant) => {
    setEditingTenant(tenant);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingTenant(undefined);
    setDialogOpen(false);
  };

  const handleSave = (data: TenantFormValues, id?: string) => {
    if (id) {
      updateTenant({ ...data, id });
      toast({ title: 'Tenant updated', description: `Tenant "${data.name}" has been successfully updated.` });
    } else {
      addTenant(data);
      toast({ title: 'Tenant created', description: `New tenant "${data.name}" has been successfully created.` });
    }
    handleCloseDialog();
  };

  const handleGenerateData = () => {
    generateDemoData();
    toast({ title: 'Demo Data Generated', description: 'The application has been populated with sample data.' });
  }

  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <PageHeader
        title="Tenants"
        description="Manage your tenants and their settings."
      >
        <div className="flex gap-2">
           <Button variant="outline" onClick={handleGenerateData}>
            <Wand2 className="mr-2 h-4 w-4" />
            Generate Demo Data
          </Button>
          {isAdmin && (
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2 h-4 w-4" />
              New Tenant
            </Button>
          )}
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Tenant List</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">{tenant.name}</TableCell>
                  <TableCell><StatusBadge status={tenant.status} /></TableCell>
                  <TableCell className="capitalize">{tenant.plan}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenDialog(tenant)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem>Suspend</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTenant ? 'Edit Tenant' : 'Create New Tenant'}</DialogTitle>
          </DialogHeader>
          <TenantForm tenant={editingTenant} onSave={handleSave} onCancel={handleCloseDialog} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
