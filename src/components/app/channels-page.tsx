"use client";

import React from 'react';
import Link from 'next/link';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, RotateCcw, Wrench, Edit2 } from 'lucide-react';
import { StatusBadge } from '@/components/app/status-badge';
import type { WhatsappChannel } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const channelSchema = z.object({
  displayName: z.string().min(2, "Alias must be at least 2 characters."),
});

type ChannelFormValues = z.infer<typeof channelSchema>;

export function ChannelsPage() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [addDialogOpen, setAddDialogOpen] = React.useState(false);
    const [editDialogOpen, setEditDialogOpen] = React.useState(false);
    const [selectedChannel, setSelectedChannel] = React.useState<WhatsappChannel | null>(null);
    
    const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || "https://baileys-worker-701554958520.us-central1.run.app";

    const channelsQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, 'channels');
    }, [firestore]);
    const { data: channels, isLoading } = useCollection<WhatsappChannel>(channelsQuery);

    const addForm = useForm<ChannelFormValues>({
      resolver: zodResolver(channelSchema),
      defaultValues: { displayName: '' },
    });

    const editForm = useForm<ChannelFormValues>({
      resolver: zodResolver(channelSchema),
      defaultValues: { displayName: '' },
    });

    const onAddChannel = async (values: ChannelFormValues) => {
        try {
            const response = await fetch(`${workerUrl}/v1/channels`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName: values.displayName }),
            });

            if (!response.ok) throw new Error('Failed to create channel');
            
            toast({ title: "Channel created", description: `Channel "${values.displayName}" has been added.` });
            setAddDialogOpen(false);
            addForm.reset();
        } catch (error) {
            toast({ variant: 'destructive', title: "Error creating channel", description: String(error) });
        }
    };

    const onEditAlias = async (values: ChannelFormValues) => {
      if (!selectedChannel) return;
      try {
          const response = await fetch(`${workerUrl}/v1/channels/${selectedChannel.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ displayName: values.displayName }),
          });

          if (!response.ok) throw new Error('Failed to update alias');
          
          toast({ title: "Alias updated", description: `Channel alias updated to "${values.displayName}".` });
          setEditDialogOpen(false);
          setSelectedChannel(null);
      } catch (error) {
          toast({ variant: 'destructive', title: "Error updating alias", description: String(error) });
      }
    };

    const handleAction = async (channelId: string, endpoint: string, successTitle: string) => {
        try {
            const response = await fetch(`${workerUrl}/v1/channels/${channelId}${endpoint}`, {
                method: 'POST',
            });
            if (!response.ok) throw new Error(`Action failed with status ${response.status}`);
            toast({ title: successTitle });
        } catch (error) {
            toast({ variant: 'destructive', title: "Action failed", description: String(error) });
        }
    };

    const getStatusForBadge = (status: WhatsappChannel['status'] | undefined) => {
        if (!status) return 'DISCONNECTED';
        if (status === 'QR') return 'CONNECTING';
        return status;
    };

    return (
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
            <PageHeader title="WhatsApp Channels" description="Manage your connected WhatsApp numbers.">
                <Button onClick={() => setAddDialogOpen(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Channel
                </Button>
            </PageHeader>

            <Card>
                <CardHeader><CardTitle>Channel List</CardTitle></CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Display Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Phone Number</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && (
                                <TableRow>
                                    <TableCell colSpan={4}>
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
                                    <TableCell>{channel.phoneE164 || 'Not linked'}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button asChild variant="outline" size="sm">
                                                <Link href={`/channels/${channel.id}`}>Manage</Link>
                                            </Button>
                                            
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => {
                                                      setSelectedChannel(channel);
                                                      editForm.setValue('displayName', channel.displayName || '');
                                                      setEditDialogOpen(true);
                                                    }}>
                                                        <Edit2 className="mr-2 h-4 w-4" />
                                                        Edit Alias
                                                    </DropdownMenuItem>
                                                    {channel.status === 'ERROR' && (
                                                        <DropdownMenuItem onClick={() => handleAction(channel.id, '/repair', 'Repair initiated')}>
                                                            <Wrench className="mr-2 h-4 w-4" />
                                                            Repair Channel
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem onClick={() => handleAction(channel.id, '/resetSession', 'Session reset')}>
                                                        <RotateCcw className="mr-2 h-4 w-4" />
                                                        Reset Session
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                             {!isLoading && channels?.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center">
                                        No channels found. Add one to get started.
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
                  <DialogTitle>Add New WhatsApp Channel</DialogTitle>
                  <DialogDescription>Enter a display name for the new channel.</DialogDescription>
                </DialogHeader>
                <Form {...addForm}>
                  <form onSubmit={addForm.handleSubmit(onAddChannel)} className="space-y-4">
                    <FormField
                      control={addForm.control}
                      name="displayName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Display Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Sales Support" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                      <Button type="submit">Create</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

            {/* Edit Alias Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Channel Alias</DialogTitle>
                  <DialogDescription>Update the display name for this channel.</DialogDescription>
                </DialogHeader>
                <Form {...editForm}>
                  <form onSubmit={editForm.handleSubmit(onEditAlias)} className="space-y-4">
                    <FormField
                      control={editForm.control}
                      name="displayName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Display Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Sales Support" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
                      <Button type="submit">Save Changes</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
        </main>
    );
}
