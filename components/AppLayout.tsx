"use client";

import { useState, useCallback, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAppAuth } from "@/components/AuthProvider";
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
  const { user } = useAppAuth();
  // Manage current session ID
  const [currentSessionId, setCurrentSessionId] = useState("");

  // Initialize session ID on client side
  useEffect(() => {
    // Try to recover last session from localStorage or create new
    const lastId = localStorage.getItem("lastActiveSessionId");
    if (lastId) {
        setCurrentSessionId(lastId);
    } else {
        const newId = uuidv4();
        setCurrentSessionId(newId);
        localStorage.setItem("lastActiveSessionId", newId);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    const newId = uuidv4();
    setCurrentSessionId(newId);
    localStorage.setItem("lastActiveSessionId", newId);
  }, []);
  
  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    localStorage.setItem("lastActiveSessionId", sessionId);
  }, []);

  // Render children as-is when not authenticated
  if (!user) {
    return <>{children}</>;
  }

  // Apply the sidebar layout once authenticated
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar 
        onNewChat={handleNewChat} 
        onSelectSession={handleSelectSession}
        currentSessionId={currentSessionId}
      />
      <SidebarInset className="md:pl-64">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
