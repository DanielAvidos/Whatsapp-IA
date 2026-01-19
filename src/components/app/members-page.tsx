"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, MoreHorizontal } from 'lucide-react';
import { useMembers, addMember, updateMember, availableRoles } from '@/lib/data';
import type { Member } from '@/lib/types';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUser } from '@/firebase';

const memberSchema = z.object({
  email: z.string().email("Invalid email address."),
  role: z.enum(availableRoles),
});

type MemberFormValues = z.infer<typeof memberSchema>;

function MemberForm({ member, onSave, onCancel }: { member?: Member; onSave: (data: MemberFormValues, id?: string) => void; onCancel: () => void; }) {
  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: member || { email: '', role: 'agent' },
  });

  const onSubmit = (data: MemberFormValues) => onSave(data, member?.id);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control} name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Address</FormLabel>
              <FormControl><Input placeholder="name@example.com" {...field} disabled={!!member} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control} name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger></FormControl>
                <SelectContent>
                  {availableRoles.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit">{member ? 'Save Changes' : 'Send Invite'}</Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function MembersPage() {
  const members = useMembers();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingMember, setEditingMember] = React.useState<Member | undefined>(undefined);
  const { toast } = useToast();
  const { user } = useUser();
  // TODO: Replace with proper role management from Firestore
  const canManage = !!user;

  const handleOpenDialog = (member?: Member) => {
    setEditingMember(member);
    setDialogOpen(true);
  };
  const handleCloseDialog = () => {
    setEditingMember(undefined);
    setDialogOpen(false);
  };
  const handleSave = (data: MemberFormValues, id?: string) => {
    if (id) {
      updateMember({ ...data, id, status: members.find(m => m.id === id)!.status });
      toast({ title: 'Member updated', description: `Role for ${data.email} has been updated.` });
    } else {
      addMember(data);
      toast({ title: 'Invitation sent', description: `${data.email} has been invited to the team.` });
    }
    handleCloseDialog();
  };

  return (
    <main className="container mx-auto p-4 md:p-6 lg:p-8">
      <PageHeader title="Members" description="Manage your team members and their roles.">
        {canManage && (
          <Button onClick={() => handleOpenDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Member List</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={`https://i.pravatar.cc/40?u=${member.email}`} alt={member.email} />
                        <AvatarFallback>{member.email.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {member.email}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{member.role}</TableCell>
                  <TableCell><StatusBadge status={member.status} /></TableCell>
                  <TableCell className="text-right">
                    {canManage && user?.uid !== member.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenDialog(member)}>Edit Role</DropdownMenuItem>
                          {member.status === 'invited' && <DropdownMenuItem>Resend Invite</DropdownMenuItem>}
                          <DropdownMenuItem>Disable</DropdownMenuItem>
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
          <DialogHeader><DialogTitle>{editingMember ? 'Edit Member' : 'Invite New Member'}</DialogTitle></DialogHeader>
          <MemberForm member={editingMember} onSave={handleSave} onCancel={handleCloseDialog} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
