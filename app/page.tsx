"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { Sparkles, Loader2 } from "lucide-react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { v4 as uuidv4 } from "uuid";

// Dynamic import to avoid SSR issues
const AppSidebar = dynamic(() => import("@/components/Sidebar"), {
  ssr: false,
});
const ChatComponent = dynamic(() => import("@/components/ChatComponent"), {
  ssr: false,
});

export default function Home() {
  const { user } = useAuthenticator();
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

  // 認証済みの場合はチャット画面を表示
  if (user) {
    return (
      <SidebarProvider>
        <AppSidebar 
            onNewChat={handleNewChat} 
            onSelectSession={handleSelectSession}
            currentSessionId={currentSessionId}
        />
        <SidebarInset className="h-screen overflow-hidden">
          {/* Key on sessionId to force re-mount and reset chat state when switching */}
          {currentSessionId && <ChatComponent key={currentSessionId} sessionId={currentSessionId} />}
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // 未認証の場合はウェルカム画面を表示
  // （AuthProviderが自動的に認証画面を表示）
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-6 shadow-lg">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Knowledge Share
          </span>
        </h1>
        <p className="text-muted-foreground mb-8 text-sm sm:text-base">
          ログインしてAIアシスタントとの会話を始めましょう
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          <span>認証中...</span>
        </div>
      </div>
    </div>
  );
}
