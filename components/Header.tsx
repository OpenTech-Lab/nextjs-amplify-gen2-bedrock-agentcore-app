"use client";

import { useAuthenticator } from "@aws-amplify/ui-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, User, Sparkles } from "lucide-react";

export default function Header() {
  const { user, signOut } = useAuthenticator();

  if (!user) return null;

  const username = user.signInDetails?.loginId || user.username || "User";
  const initials = username
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 font-semibold text-lg">
              <Sparkles className="w-5 h-5 text-blue-500" />
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Knowledge Share
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {username}
              </span>
            </div>
            <Avatar className="w-8 h-8 sm:hidden bg-gradient-to-br from-blue-500 to-purple-600">
              <AvatarFallback className="bg-transparent text-white text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <Button
              onClick={signOut}
              variant="ghost"
              size="sm"
              className="gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">ログアウト</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
