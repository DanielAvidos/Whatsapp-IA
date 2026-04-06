
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { Building2, KeyRound, MessageSquare, Users, LogOut, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Logo } from "@/components/icons/logo";
import { useUser, useAuth, useFirestore, useMemoFirebase, useCollection } from "@/firebase";
import { Button } from "../ui/button";
import { useLanguage } from "@/context/language-provider";
import { TranslationKey } from "@/lib/locales";
import { getIsSuperAdmin, getMyCompany } from "@/lib/auth-helpers";
import { collection, query, where } from "firebase/firestore";
import type { WhatsappChannel } from "@/lib/types";

const navItems: { href: string; icon: React.ElementType; labelKey: TranslationKey; adminOnly: boolean }[] = [
  { href: "/dashboard", icon: Building2, labelKey: "nav.tenants", adminOnly: true },
  { href: "/channels", icon: MessageSquare, labelKey: "nav.channels", adminOnly: false },
  { href: "/api-keys", icon: KeyRound, labelKey: "nav.api-keys", adminOnly: true },
  { href: "/members", icon: Users, labelKey: "nav.members", adminOnly: true },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const { t } = useLanguage();
  const { setOpenMobile } = useSidebar();

  const isSuperAdmin = getIsSuperAdmin(user);
  const [myCompanyId, setMyCompanyId] = useState<string | null>(null);

  // Resolve company for non-superadmins
  useEffect(() => {
    if (user && !isSuperAdmin && firestore) {
      getMyCompany(firestore, user).then(c => setMyCompanyId(c?.id || null));
    }
  }, [user, isSuperAdmin, firestore]);

  const companyChannelsQuery = useMemoFirebase(() => {
    if (!firestore || isSuperAdmin || !myCompanyId) return null;
    return query(collection(firestore, 'channels'), where('companyId', '==', myCompanyId));
  }, [firestore, isSuperAdmin, myCompanyId]);

  const { data: companyChannels, isLoading: isLoadingChannels } = useCollection<WhatsappChannel>(companyChannelsQuery);

  const handleSignOut = () => {
    auth.signOut();
  };

  const role = isSuperAdmin ? 'superadmin' : 'admin';

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <Logo className="size-7 text-primary" />
          <span className="text-lg font-semibold truncate">Whatsapp IA</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {isSuperAdmin ? (
            // --- SUPER ADMIN MENU ---
            navItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(item.href)}
                  tooltip={{ children: t(item.labelKey) }}
                >
                  <Link href={item.href} onClick={() => setOpenMobile(false)}>
                    <item.icon />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))
          ) : (
            // --- COMPANY CHANNELS MENU ---
            <SidebarGroup>
              <SidebarGroupLabel className="px-2">{t('nav.channels')}</SidebarGroupLabel>
              {isLoadingChannels ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : companyChannels?.length === 0 ? (
                <div className="px-4 py-2 text-xs text-muted-foreground italic">
                  No hay canales asignados
                </div>
              ) : (
                companyChannels?.map((channel) => (
                  <SidebarMenuItem key={channel.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.includes(`/channels/${channel.id}`)}
                      tooltip={{ children: channel.displayName }}
                      className="h-auto py-2"
                    >
                      <Link 
                        href={`/channels/${channel.id}`} 
                        onClick={() => setOpenMobile(false)}
                        className="flex flex-col items-start gap-0"
                      >
                        <div className="flex items-center gap-2 w-full">
                          {channel.status === 'CONNECTED' ? (
                            <CheckCircle2 className="size-3 text-green-500" />
                          ) : (
                            <XCircle className="size-3 text-muted-foreground" />
                          )}
                          <span className="font-medium truncate">{channel.displayName || 'Canal'}</span>
                        </div>
                        {channel.phoneE164 && (
                          <span className="text-[10px] text-muted-foreground ml-5">{channel.phoneE164}</span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarGroup>
          )}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
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
