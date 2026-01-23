"use client";

import React from 'react';
import Link from 'next/link';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { StatusBadge } from '@/components/app/status-badge';
import type { WhatsappChannel } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

export function ChannelsPage() {
    const firestore = useFirestore();
    const { toast } = useToast();
    
    const channelsQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, 'channels');
    }, [firestore]);
    const { data: channels, isLoading } = useCollection<WhatsappChannel>(channelsQuery);

    const handleAddChannel = async () => {
        if (!firestore) return;
        try {
            const name = prompt("Enter a name for the new channel:");
            if (name) {
                await addDoc(collection(firestore, 'channels'), {
                    displayName: name,
                    status: 'DISCONNECTED',
                    createdAt: new Date(),
                });
                toast({ title: "Channel created", description: `Channel "${name}" has been added.` });
            }
        } catch (error) {
            toast({ variant: 'destructive', title: "Error creating channel", description: String(error) });
        }
    };

    const getStatusForBadge = (status: WhatsappChannel['status'] | undefined) => {
        if (!status) return 'DISCONNECTED';
        if (status === 'QR') return 'CONNECTING'; // Treat QR state as 'Connecting' for the badge
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
                                        <Button asChild variant="outline" size="sm">
                                            <Link href={`/channels/${channel.id}`}>Manage</Link>
                                        </Button>
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
