"use client";

import { useState, useCallback } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import AppSidebar from "@/components/Sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const { user } = useAuthenticator();
  const [chatKey, setChatKey] = useState(0);

  const handleNewChat = useCallback(() => {
    setChatKey((prev) => prev + 1);
  }, []);

  // 未認証の場合はchildrenをそのまま表示
  if (!user) {
    return <>{children}</>;
  }

  // 認証済みの場合はサイドバーレイアウトを適用
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="md:pl-64">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
