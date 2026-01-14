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
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2, KeyRound, MessageSquare, Users } from "lucide-react";
import { Logo } from "@/components/icons/logo";
import { currentUser } from "@/lib/data";

const navItems = [
  { href: "/dashboard", icon: Building2, label: "Tenants" },
  { href: "/channels", icon: MessageSquare, label: "Channels" },
  { href: "/api-keys", icon: KeyRound, label: "API Keys" },
  { href: "/members", icon: Users, label: "Members" },
];

export function AppSidebar() {
  const pathname = usePathname();

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
              <Link href={item.href} legacyBehavior passHref>
                <SidebarMenuButton
                  isActive={pathname.startsWith(item.href)}
                  icon={<item.icon />}
                  tooltip={{ children: item.label }}
                >
                  {item.label}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarImage
              src={`https://i.pravatar.cc/40?u=${currentUser.email}`}
              alt={currentUser.email}
            />
            <AvatarFallback>{currentUser.email.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-medium">{currentUser.email}</span>
            <span className="truncate text-xs text-muted-foreground capitalize">{currentUser.role}</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
