"use client";

import React, { useState, useEffect, useRef } from "react";
import { useSSEChat } from "@/hooks/useSSEChat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Send, User, Bot, AlertCircle } from "lucide-react";
import { Badge } from "./ui/badge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function ChatComponent() {
  const [input, setInput] = useState("");
  const [allMessages, setAllMessages] = useState<
    Array<{ type: "user" | "ai"; content: string }>
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isLoading, error, sendMessage } = useSSEChat({
    maxRetries: 3,
    retryDelay: 1000,
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const currentInput = input;
    setInput("");

    // ユーザーメッセージを追加
    setAllMessages((prev) => [
      ...prev,
      { type: "user", content: currentInput },
    ]);

    // AIレスポンスを取得
    await sendMessage(currentInput);

    // Focus back to textarea after sending
    textareaRef.current?.focus();
  };

  // useSSEChatのmessages配列の変化を監視してallMessagesに反映
  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];

      queueMicrotask(() => {
        setAllMessages((prev) => {
          const lastMessage = prev[prev.length - 1];

          if (lastMessage && lastMessage.type === "ai") {
            return [
              ...prev.slice(0, -1),
              { type: "ai" as const, content: latestMessage },
            ];
          } else {
            return [...prev, { type: "ai" as const, content: latestMessage }];
          }
        });
      });
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with Trigger */}
      <header className="flex items-center px-4 py-3 space-x-2 bg-background/30 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="text-sm font-medium">AI アシスタント</div>
          </div>
        </div>
        <Badge className="text-xs text-muted-foreground bg-black/5">
          {isLoading ? (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="hidden sm:inline">応答中...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="w-3 h-3" />
              <span className="hidden sm:inline">エラー</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-green-600">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="hidden sm:inline">オンライン</span>
            </div>
          )}
        </Badge>
      </header>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          {allMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="p-4 rounded-full bg-gradient-to-br from-blue-50 to-purple-50 mb-4">
                <Bot className="w-12 h-12 text-blue-500" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                チャットを始めましょう
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                メッセージを入力してAIアシスタントとの会話を開始してください
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {allMessages.map((message, index) => (
                <div
                  key={index}
                  className={`flex gap-3 sm:gap-4 ${
                    message.type === "user" ? "flex-row-reverse" : "flex-row"
                  } animate-in fade-in slide-in-from-bottom-2 duration-300`}
                >
                  {/* Avatar */}
                  <Avatar
                    className={`flex-shrink-0 w-8 h-8 ${
                      message.type === "user"
                        ? "bg-gradient-to-br from-blue-500 to-blue-600"
                        : "bg-gradient-to-br from-purple-500 to-purple-600"
                    }`}
                  >
                    <AvatarFallback className="bg-transparent text-white">
                      {message.type === "user" ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <Bot className="w-4 h-4" />
                      )}
                    </AvatarFallback>
                  </Avatar>

                  {/* Message Content */}
                  <div
                    className={`flex-1 ${
                      message.type === "user" ? "text-right" : "text-left"
                    }`}
                  >
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">
                      {message.type === "user" ? "あなた" : "AI アシスタント"}
                    </div>
                    <div
                      className={`inline-block max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
                        message.type === "user"
                          ? "bg-gradient-to-br from-blue-100 to-blue-50 text-white"
                          : "bg-muted/50 text-foreground border border-border/50"
                      }`}
                    >
                      <div className="text-[15px] leading-relaxed break-words prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2 prose-headings:my-3">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            code: ({ className, children, ...props }: any) => {
                              const isInline =
                                !className?.includes("language-");
                              return isInline ? (
                                <code
                                  className={`${
                                    message.type === "user"
                                      ? "bg-blue-700/50"
                                      : "bg-muted"
                                  } rounded px-1.5 py-0.5 text-sm font-mono`}
                                  {...props}
                                >
                                  {children}
                                </code>
                              ) : (
                                <pre
                                  className={`${
                                    message.type === "user"
                                      ? "bg-blue-700/50"
                                      : "bg-muted"
                                  } rounded-lg p-3 overflow-x-auto my-2`}
                                >
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                </pre>
                              );
                            },
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            a: ({ children, ...props }: any) => (
                              <a
                                className={`${
                                  message.type === "user"
                                    ? "text-blue-100 hover:text-white"
                                    : "text-blue-600 hover:text-blue-800"
                                } underline`}
                                target="_blank"
                                rel="noopener noreferrer"
                                {...props}
                              >
                                {children}
                              </a>
                            ),
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            ul: ({ children, ...props }: any) => (
                              <ul
                                className="list-disc list-inside my-2 space-y-1"
                                {...props}
                              >
                                {children}
                              </ul>
                            ),
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            ol: ({ children, ...props }: any) => (
                              <ol
                                className="list-decimal list-inside my-2 space-y-1"
                                {...props}
                              >
                                {children}
                              </ol>
                            ),
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            p: ({ children, ...props }: any) => (
                              <p className="my-1" {...props}>
                                {children}
                              </p>
                            ),
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            blockquote: ({ children, ...props }: any) => (
                              <blockquote
                                className={`border-l-4 ${
                                  message.type === "user"
                                    ? "border-blue-300"
                                    : "border-muted-foreground"
                                } pl-4 italic my-2`}
                                {...props}
                              >
                                {children}
                              </blockquote>
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                        {isLoading &&
                          message.type === "ai" &&
                          index === allMessages.length - 1 && (
                            <span className="inline-block w-1.5 h-5 ml-1 bg-current animate-pulse" />
                          )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Error Display */}
              {error && (
                <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex-shrink-0 w-8 h-8" />
                  <div className="flex-1">
                    <div className="inline-block max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 bg-destructive/10 border border-destructive/20">
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="relative flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力... (Shift+Enterで改行)"
              disabled={isLoading}
              className="min-h-[52px] max-h-[200px] resize-none pr-12 rounded-2xl border-border/50 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              size="icon"
              className="absolute right-2 bottom-2 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? (
                <Spinner className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            AIは間違いを犯す可能性があります。重要な情報は確認してください。
          </p>
        </div>
      </div>
    </div>
  );
}
