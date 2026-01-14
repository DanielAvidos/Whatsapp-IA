"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, MoreHorizontal, Copy, Trash2 } from 'lucide-react';
import { useApiKeys, addApiKey, deleteApiKey, currentUser, availableApiKeyScopes } from '@/lib/data';
import type { ApiKey, ApiKeyScope } from '@/lib/types';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const apiKeySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  scopes: z.array(z.enum(availableApiKeyScopes)).min(1, "At least one scope must be selected."),
});

type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

function ApiKeyForm({ onSave, onCancel }: { onSave: (data: ApiKeyFormValues) => void; onCancel: () => void; }) {
  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: { name: '', scopes: [] },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Key Name</FormLabel>
            <FormControl><Input placeholder="e.g., Production Server" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="scopes" render={() => (
          <FormItem>
            <div className="mb-4">
              <FormLabel>Scopes</FormLabel>
              <FormDescription>Select permissions for this key.</FormDescription>
            </div>
            {availableApiKeyScopes.map((scope) => (
              <FormField key={scope} control={form.control} name="scopes" render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value?.includes(scope)}
                      onCheckedChange={(checked) => {
                        return checked
                          ? field.onChange([...field.value, scope])
                          : field.onChange(field.value?.filter((value) => value !== scope));
                      }}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">{scope}</FormLabel>
                </FormItem>
              )} />
            ))}
            <FormMessage />
          </FormItem>
        )} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Generate Key</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function ApiKeysPage() {
  const apiKeys = useApiKeys();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [newKey, setNewKey] = React.useState<ApiKey | null>(null);
  const { toast } = useToast();
  const canManage = currentUser.role === 'owner' || currentUser.role === 'admin';

  const handleSave = (data: ApiKeyFormValues) => {
    addApiKey(data);
    setDialogOpen(false);
    // In a real app, the new key would be returned by the mutation
    // Here we just grab the newest key from our mock store.
    const latestKey = useApiKeys.getState().slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    setNewKey(latestKey);
    toast({ title: 'API Key Generated', description: 'Make sure to copy your new key. You won’t be able to see it again.' });
  };
  
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard!' });
  }

  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <PageHeader title="API Keys" description="Manage API keys for integrations.">
        {canManage && (
          <Button onClick={() => setDialogOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Generate Key
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Key List</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono">{key.prefix}....</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map(s => <Badge key={s} variant="secondary">{s}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell>{format(new Date(key.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => handleCopy(key.prefix)}>
                            <Copy className="mr-2 h-4 w-4" /> Copy Prefix
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => deleteApiKey(key.id)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Revoke
                          </DropdownMenuItem>
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
            <DialogTitle>Generate New API Key</DialogTitle>
            <DialogDescription>Assign a name and permissions for your new key.</DialogDescription>
          </DialogHeader>
          <ApiKeyForm onSave={handleSave} onCancel={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!newKey} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Generated</DialogTitle>
            <DialogDescription>Copy this key and store it securely. You will not be able to see it again.</DialogDescription>
          </DialogHeader>
          <div className="relative rounded-md bg-muted p-4 font-mono text-sm">
            {newKey?.keyHash}
            <Button size="icon" variant="ghost" className="absolute right-2 top-2 h-7 w-7" onClick={() => handleCopy(newKey?.keyHash || '')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
