import { AppSidebar } from "@/components/app/sidebar";
import { SidebarInset } from "@/components/ui/sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <SidebarInset>
        {children}
      </SidebarInset>
    </div>
  );
}
