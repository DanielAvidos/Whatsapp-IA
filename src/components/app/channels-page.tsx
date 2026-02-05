"use client";

import React from 'react';
import Link from 'next/link';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, RotateCcw, Wrench } from 'lucide-react';
import { StatusBadge } from '@/components/app/status-badge';
import type { WhatsappChannel } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function ChannelsPage() {
    const firestore = useFirestore();
    const { toast } = useToast();
    
    const workerUrl = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || "https://baileys-worker-701554958520.us-central1.run.app";

    const channelsQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, 'channels');
    }, [firestore]);
    const { data: channels, isLoading } = useCollection<WhatsappChannel>(channelsQuery);

    const handleAddChannel = async () => {
        const name = prompt("Enter a name for the new channel:");
        if (!name) return;

        try {
            const response = await fetch(`${workerUrl}/v1/channels`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName: name }),
            });

            if (!response.ok) throw new Error('Failed to create channel');
            
            toast({ title: "Channel created", description: `Channel "${name}" has been added.` });
        } catch (error) {
            toast({ variant: 'destructive', title: "Error creating channel", description: String(error) });
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
                <Button onClick={handleAddChannel}>
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
                                    <TableCell className="font-medium">{channel.displayName || channel.id}</TableCell>
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
        </main>
    );
}
