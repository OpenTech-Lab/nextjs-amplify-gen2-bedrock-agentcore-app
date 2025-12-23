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
} from "@/components/ui/sidebar";
import {
  LogOut,
  User,
  Sparkles,
  PlusCircle,
  MessageSquare,
} from "lucide-react";

interface AppSidebarProps {
  onNewChat?: () => void;
}

export default function AppSidebar({ onNewChat }: AppSidebarProps) {
  const { user, signOut } = useAuthenticator();

  const username = user?.signInDetails?.loginId || user?.username || "User";
  const initials = username
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Sidebar>
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-not-allowed opacity-50"
                  disabled
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>会話履歴（近日公開）</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        {/* User Profile */}
        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-sidebar-accent transition-colors">
          <Avatar className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600">
            <AvatarFallback className="bg-transparent text-white text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{username}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <User className="w-3 h-3" />
              オンライン
            </div>
          </div>
        </div>

        {/* Logout Button */}
        <Button
          onClick={signOut}
          variant="ghost"
          size="sm"
          className="w-full gap-2 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="w-4 h-4" />
          ログアウト
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
