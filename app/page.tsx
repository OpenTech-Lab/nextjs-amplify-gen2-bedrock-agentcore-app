"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { Sparkles, Loader2 } from "lucide-react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

// Dynamic import to avoid SSR issues
const AppSidebar = dynamic(() => import("@/components/Sidebar"), {
  ssr: false,
});
const ChatComponent = dynamic(() => import("@/components/ChatComponent"), {
  ssr: false,
});

export default function Home() {
  const { user } = useAuthenticator();
  const [chatKey, setChatKey] = useState(0);

  const handleNewChat = useCallback(() => {
    setChatKey((prev) => prev + 1);
  }, []);

  // 認証済みの場合はチャット画面を表示
  if (user) {
    return (
      <SidebarProvider>
        <AppSidebar onNewChat={handleNewChat} />
        <SidebarInset className="h-screen overflow-hidden">
          <ChatComponent key={chatKey} />
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
