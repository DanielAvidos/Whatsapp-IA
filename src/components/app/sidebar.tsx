
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Building2, 
  KeyRound, 
  MessageSquare, 
  Users, 
  LogOut, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  Bot,
  Link as LinkIcon,
  ChevronDown,
  LayoutGrid,
  BookUser
} from "lucide-react";
import { Logo } from "@/components/icons/logo";
import { useUser, useAuth, useFirestore, useMemoFirebase, useCollection } from "@/firebase";
import { Button } from "../ui/button";
import { useLanguage } from "@/context/language-provider";
import { TranslationKey } from "@/lib/locales";
import { getIsSuperAdmin, getMyCompany } from "@/lib/auth-helpers";
import { collection, query, where } from "firebase/firestore";
import type { WhatsappChannel } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const navItems: { href: string; icon: React.ElementType; labelKey: TranslationKey; adminOnly: boolean }[] = [
  { href: "/dashboard", icon: Building2, labelKey: "nav.tenants", adminOnly: true },
  { href: "/channels", icon: MessageSquare, labelKey: "nav.channels", adminOnly: true },
  { href: "/api-keys", icon: KeyRound, labelKey: "nav.api-keys", adminOnly: true },
  { href: "/members", icon: Users, labelKey: "nav.members", adminOnly: true },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const { t } = useLanguage();
  const { setOpenMobile } = useSidebar();

  const isSuperAdmin = getIsSuperAdmin(user);
  const [myCompanyId, setMyCompanyId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  // Resolve company for non-superadmins
  useEffect(() => {
    if (user && !isSuperAdmin && firestore) {
      getMyCompany(firestore, user).then(c => setMyCompanyId(c?.id || null));
    }
  }, [user, isSuperAdmin, firestore]);

  const allChannelsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    if (isSuperAdmin) return collection(firestore, 'channels');
    if (!myCompanyId) return null;
    return query(collection(firestore, 'channels'), where('companyId', '==', myCompanyId));
  }, [firestore, isSuperAdmin, myCompanyId]);

  const { data: channels, isLoading: isLoadingChannels } = useCollection<WhatsappChannel>(allChannelsQuery);

  // Sync selected channel with URL or localStorage
  useEffect(() => {
    if (!channels || channels.length === 0) return;

    const pathParts = pathname.split('/');
    const channelIdFromPath = pathParts[1] === 'channels' && pathParts[2] ? pathParts[2] : null;
    
    if (channelIdFromPath) {
      setSelectedChannelId(channelIdFromPath);
      localStorage.setItem('activeChannelId', channelIdFromPath);
    } else {
      const storedId = localStorage.getItem('activeChannelId');
      const validStored = channels.find(c => c.id === storedId);
      if (validStored) {
        setSelectedChannelId(storedId);
      } else {
        setSelectedChannelId(channels[0].id);
        localStorage.setItem('activeChannelId', channels[0].id);
      }
    }
  }, [channels, pathname]);

  const activeChannel = channels?.find(c => c.id === selectedChannelId);
  const currentTab = searchParams.get('tab') || 'connection';

  const handleChannelChange = (id: string) => {
    setSelectedChannelId(id);
    localStorage.setItem('activeChannelId', id);
    router.push(`/channels/${id}?tab=${currentTab}`);
  };

  const handleSignOut = () => {
    auth.signOut();
  };

  const role = isSuperAdmin ? 'superadmin' : 'admin';

  return (
    <Sidebar>
      <SidebarHeader className="border-b pb-4">
        <div className="flex items-center gap-2 px-2 py-2 mb-2">
          <Logo className="size-7 text-primary" />
          <span className="text-lg font-semibold truncate">Whatsapp IA</span>
        </div>
        
        <div className="px-2">
          {isLoadingChannels ? (
            <div className="h-9 w-full rounded-md bg-muted animate-pulse" />
          ) : (
            <Select value={selectedChannelId || ""} onValueChange={handleChannelChange}>
              <SelectTrigger className="w-full h-9 bg-background border-muted-foreground/20">
                <SelectValue placeholder="Seleccionar canal" />
              </SelectTrigger>
              <SelectContent>
                {channels?.map(channel => (
                  <SelectItem key={channel.id} value={channel.id}>
                    <div className="flex items-center gap-2">
                      <div className={cn("size-2 rounded-full", channel.status === 'CONNECTED' ? "bg-green-500" : "bg-muted-foreground/40")} />
                      <span className="truncate">{channel.displayName || channel.id}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="py-4">
        {/* --- GLOBAL MENU (SUPERADMIN ONLY) --- */}
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-2">Administración</SidebarGroupLabel>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    tooltip={{ children: t(item.labelKey) }}
                  >
                    <Link href={item.href} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{t(item.labelKey)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* --- CONTEXTUAL CHANNEL MENU --- */}
        {selectedChannelId && activeChannel && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 truncate">
              Canal: {activeChannel.displayName}
            </SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/channels/${selectedChannelId}`) && currentTab === 'connection'}
                  tooltip="Conexión"
                >
                  <Link href={`/channels/${selectedChannelId}?tab=connection`} onClick={() => setOpenMobile(false)}>
                    <LinkIcon />
                    <span>Conexión</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/channels/${selectedChannelId}`) && currentTab === 'chats'}
                  disabled={activeChannel.status !== 'CONNECTED'}
                  tooltip="Chats"
                >
                  <Link href={`/channels/${selectedChannelId}?tab=chats`} onClick={() => setOpenMobile(false)}>
                    <MessageSquare />
                    <span>Chats</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/channels/${selectedChannelId}`) && currentTab === 'chatbot'}
                  tooltip="Chatbot"
                >
                  <Link href={`/channels/${selectedChannelId}?tab=chatbot`} onClick={() => setOpenMobile(false)}>
                    <Bot />
                    <span>Chatbot</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/channels/${selectedChannelId}`) && currentTab === 'funnel'}
                  tooltip="Embudo de ventas"
                >
                  <Link href={`/channels/${selectedChannelId}?tab=funnel`} onClick={() => setOpenMobile(false)}>
                    <LayoutGrid />
                    <span>Embudo de ventas</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/channels/${selectedChannelId}`) && currentTab === 'contacts'}
                  tooltip="Contactos"
                >
                  <Link href={`/channels/${selectedChannelId}?tab=contacts`} onClick={() => setOpenMobile(false)}>
                    <BookUser />
                    <span>Contactos</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t pt-4">
        {user && (
          <div className="flex w-full items-center gap-3 p-2">
            <Avatar className="size-8">
              <AvatarImage
                src={user.photoURL ?? `https://i.pravatar.cc/40?u=${user.email}`}
                alt={user.email ?? ''}
              />
              <AvatarFallback>{user.email?.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden flex-1">
              <span className="truncate text-sm font-medium">{user.email}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">{role}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSignOut}
              aria-label={t('sign.out')}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
