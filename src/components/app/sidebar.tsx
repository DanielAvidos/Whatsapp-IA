"use client";

import React from "react";
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
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2, KeyRound, MessageSquare, Users, LogOut } from "lucide-react";
import { Logo } from "@/components/icons/logo";
import { useUser, useAuth } from "@/firebase";
import { Button } from "../ui/button";

const navItems = [
  { href: "/dashboard", icon: Building2, label: "Tenants" },
  { href: "/channels", icon: MessageSquare, label: "Channels" },
  { href: "/api-keys", icon: KeyRound, label: "API Keys" },
  { href: "/members", icon: Users, label: "Members" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const auth = useAuth();

  const handleSignOut = () => {
    auth.signOut();
  };

  // For now, we assume any logged in user is an owner for UI purposes.
  // This will be replaced with proper role management.
  const role = 'owner';

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <Logo className="size-7 text-primary" />
          <span className="text-lg font-semibold">Whatsapp IA</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(item.href)}
                icon={<item.icon />}
                tooltip={{ children: item.label }}
              >
                <Link href={item.href}>
                  {item.label}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        {user && (
          <div className="flex w-full items-center gap-3">
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
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
