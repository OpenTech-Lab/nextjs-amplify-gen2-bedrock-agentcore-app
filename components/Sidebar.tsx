"use client";

import { useAuthenticator } from "@aws-amplify/ui-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { useEffect, useState } from "react";
import {
  LogOut,
  User,
  Sparkles,
  PlusCircle,
  MessageSquare,
  Trash2,
  Settings,
  Moon,
  Sun,
  ChevronUp,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";

interface AppSidebarProps {
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  currentSessionId: string;
}

const client = generateClient<Schema>();

export default function AppSidebar({
  onNewChat,
  onSelectSession,
  currentSessionId,
}: AppSidebarProps) {
  const { user, signOut } = useAuthenticator();
  const { setOpenMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const [sessions, setSessions] = useState<
    Array<Schema["ChatSession"]["type"]>
  >([]);

  const handleDeleteSession = async (
    sessionId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    if (!confirm("この会話を削除してもよろしいですか？")) return;

    try {
      // Delete all messages in this session
      const { data: messages } = await client.models.Message.list({
        filter: { sessionId: { eq: sessionId } },
      });

      for (const msg of messages) {
        await client.models.Message.delete({ id: msg.id });
      }

      // Delete the session
      const { data: sessionsToDelete } = await client.models.ChatSession.list({
        filter: { sessionId: { eq: sessionId } },
      });

      for (const sess of sessionsToDelete) {
        await client.models.ChatSession.delete({ id: sess.id });
      }

      // If currently viewing this session, trigger new chat
      if (currentSessionId === sessionId) {
        onNewChat();
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
      alert("削除に失敗しました");
    }
  };

  useEffect(() => {
    if (!user) return;

    // Subscribe to session updates
    const sub = client.models.ChatSession.observeQuery().subscribe({
      next: ({ items }) => {
        // Sort by updatedAt descending (manually for now as observeQuery sort might be tricky with just updatedAt)
        // Actually, we can assume create order or manual sort.
        // Let's sort by createdAt desc if possible, or filtered.
        // For now just reverse items or sort by updatedAt if available.
        const sorted = [...items].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        setSessions(sorted);
      },
    });
    return () => sub.unsubscribe();
  }, [user]);

  const username = user?.signInDetails?.loginId || user?.username || "User";
  const initials = username
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2 font-semibold text-lg">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Template
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* New Chat Button */}
        <SidebarGroup>
          <SidebarGroupContent>
            <Button
              onClick={onNewChat}
              className="w-full gap-2 bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
            >
              <PlusCircle className="w-4 h-4" />
              新しいチャット
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Chat History */}
        <SidebarGroup>
          <SidebarGroupLabel>最近の会話</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sessions.map((session) => (
                <SidebarMenuItem key={session.id}>
                  <div className="flex items-center gap-1 w-full group">
                    <SidebarMenuButton
                      onClick={() => {
                        onSelectSession(session.sessionId);
                        setOpenMobile(false);
                      }}
                      isActive={currentSessionId === session.sessionId}
                      className="truncate flex-1"
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <span className="truncate">
                        {session.name || "Untitled"}
                      </span>
                    </SidebarMenuButton>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => handleDeleteSession(session.sessionId, e)}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </SidebarMenuItem>
              ))}
              {sessions.length === 0 && (
                <div className="px-4 py-2 text-xs text-muted-foreground">
                  履歴はありません
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-sidebar-accent transition-colors justify-between h-auto"
            >
              <div className="flex items-center gap-3">
                <Avatar className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600">
                  <AvatarFallback className="bg-transparent text-white text-sm">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate">{username}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="w-3 h-3" />
                    オンライン
                  </div>
                </div>
              </div>
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-56">
            <DropdownMenuItem
              onClick={() => {
                /* Add settings handler */
              }}
            >
              <Settings className="w-4 h-4 mr-2" />
              設定
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <>
                  <Sun className="w-4 h-4 mr-2" />
                  ライトモード
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 mr-2" />
                  ダークモード
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={signOut}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="w-4 h-4 mr-2" />
              ログアウト
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
