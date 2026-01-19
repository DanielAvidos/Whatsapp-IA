"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, MoreHorizontal } from 'lucide-react';
import { useChannels, addChannel, updateChannel, availableChannelStatus } from '@/lib/data';
import type { Channel, ChannelStatus } from '@/lib/types';
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

const channelSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  identifier: z.string().regex(/^\+[1-9]\d{1,14}$/, "Must be a valid E.164 phone number (e.g., +15551234567)."),
  status: z.enum(availableChannelStatus),
});

type ChannelFormValues = z.infer<typeof channelSchema>;

function ChannelForm({ channel, onSave, onCancel }: { channel?: Channel; onSave: (data: ChannelFormValues, id?: string) => void; onCancel: () => void; }) {
  const form = useForm<ChannelFormValues>({
    resolver: zodResolver(channelSchema),
    defaultValues: channel ? { name: channel.name, identifier: channel.identifier, status: channel.status } : { name: '', identifier: '', status: 'CONNECTING' },
  });

  const onSubmit = (data: ChannelFormValues) => {
    onSave(data, channel?.id);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control} name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Channel Name</FormLabel>
              <FormControl><Input placeholder="e.g., Main Support Line" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control} name="identifier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Whatsapp Number</FormLabel>
              <FormControl><Input placeholder="+15551234567" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {channel && (
          <FormField
            control={form.control} name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {availableChannelStatus.map(s => <SelectItem key={s} value={s}><StatusBadge status={s as ChannelStatus} /></SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Save Channel</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function ChannelsPage() {
  const channels = useChannels();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingChannel, setEditingChannel] = React.useState<Channel | undefined>(undefined);
  const { toast } = useToast();
  const { user } = useUser();
  // TODO: Replace with proper role management from Firestore
  const canManage = !!user;

  const handleOpenDialog = (channel?: Channel) => {
    setEditingChannel(channel);
    setDialogOpen(true);
  };
  const handleCloseDialog = () => {
    setEditingChannel(undefined);
    setDialogOpen(false);
  };
  const handleSave = (data: ChannelFormValues, id?: string) => {
    const channelData = { ...data, type: 'whatsapp' as const };
    if (id) {
      updateChannel({ ...channelData, id });
      toast({ title: 'Channel updated', description: `Channel "${data.name}" was updated.` });
    } else {
      addChannel(channelData);
      toast({ title: 'Channel created', description: `Channel "${data.name}" was created and is now connecting.` });
    }
    handleCloseDialog();
  };

  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <PageHeader title="Channels" description="Manage your Whatsapp communication channels.">
        {canManage && (
          <Button onClick={() => handleOpenDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Channel
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Channel List</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell className="font-medium">{channel.name}</TableCell>
                  <TableCell>{channel.identifier}</TableCell>
                  <TableCell><StatusBadge status={channel.status} /></TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenDialog(channel)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem>Disconnect</DropdownMenuItem>
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
          <DialogHeader><DialogTitle>{editingChannel ? 'Edit Channel' : 'Add New Channel'}</DialogTitle></DialogHeader>
          <ChannelForm channel={editingChannel} onSave={handleSave} onCancel={handleCloseDialog} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
