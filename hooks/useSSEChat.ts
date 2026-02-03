import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>();

/**
 * SSEチャット機能のオプション設定
 */
interface SSEChatOptions {
  maxRetries?: number; // 最大再試行回数
  retryDelay?: number; // 再試行間隔（ミリ秒）
}

export interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  feedback?: "good" | "bad";
}

/**
 * SSE（Server-Sent Events）を使用したチャット機能のカスタムフック
 *
 * @param options 設定オプション
 * @returns チャット機能のstate と関数
 */
export function useSSEChat(sessionId: string, options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  // State管理
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Session ID Management (Handled externally now)
  // const [sessionId] = useState(...) -> Removed

  // Load history on mount
  useEffect(() => {
    if (!sessionId) return;

    // Define the type for the API response items
    interface MessageRecord {
      id: string;
      userMessage: string;
      aiResponse?: string | null;
      feedback?: string | null;
      createdAt?: string;
    }

    const loadHistory = async () => {
      try {
        // Fetch messages by sessionId using the secondary index
        const { data: history } = await client.models.Message.list({
          filter: { sessionId: { eq: sessionId } },
        });

        // Sort explicitly by createdAt if needed, assuming list returns order or sort manually
        // Since we don't have a sort key in the index yet, we sort in JS
        const sortedHistory = (history as unknown as MessageRecord[]).sort(
          (a, b) =>
            new Date(a.createdAt || 0).getTime() -
            new Date(b.createdAt || 0).getTime()
        );

        const loadedMessages: Message[] = [];
        sortedHistory.forEach((record) => {
          // Reconstruct conversation pairs
          if (record.userMessage) {
            loadedMessages.push({
              role: "user",
              content: record.userMessage,
              id: record.id, // Optional: link user message to record too? Or just assistant
            });
          }
          if (record.aiResponse) {
            loadedMessages.push({
              role: "assistant",
              content: record.aiResponse,
              id: record.id,
              feedback: (record.feedback as "good" | "bad") || undefined,
            });
          }
        });

        if (loadedMessages.length > 0) {
          setMessages(loadedMessages);
        }
      } catch (e) {
        console.error("Failed to load chat history:", e);
      }
    };

    loadHistory();
  }, [sessionId]);

  // 認証管理
  const { getAuthTokens } = useAuth();

  /**
   * メッセージを送信してAIからの応答を受信する
   * @param prompt ユーザーからの入力プロンプト
   * @param retryCount 現在の再試行回数（内部使用）
   */
  const sendMessage = useCallback(
    async (prompt: string, retryCount = 0): Promise<void> => {
      if (!prompt?.trim()) return;

      setIsLoading(true);
      setError(null);

      // Add user message immediately only on first attempt
      if (retryCount === 0) {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: prompt },
          { role: "assistant", content: "" },
        ]);
      }

      let savedMessageId: string | undefined;

      // Create message record with user input
      try {
        const { data: newMessage } = await client.models.Message.create({
          userMessage: prompt,
          aiResponse: "", // Initialize with empty string or null
          sessionId,
        });
        savedMessageId = newMessage?.id;

        // Update state with the backend ID for the AI message (we'll attach it to the pair)
        // Here we associate the ID with the assistant message so we can update it later
        if (savedMessageId) {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastMessageIndex = newMessages.length - 1;
            // Associate ID with the assistant message so users can rate the RESPONSE
            newMessages[lastMessageIndex] = {
              ...newMessages[lastMessageIndex],
              id: savedMessageId,
            };
            return newMessages;
          });
        }
      } catch (e) {
        console.error("Failed to save user message:", e);
      }

      // Create or update ChatSession
      if (messages.length === 0) {
        try {
          // Check if session exists first (to avoid duplicates if re-rendering)
          const { data: sessions } = await client.models.ChatSession.list({
            filter: { sessionId: { eq: sessionId } },
          });

          if (sessions.length === 0) {
            await client.models.ChatSession.create({
              sessionId,
              name: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
            });
          }
        } catch (e) {
          console.error("Failed to create chat session:", e);
        }
      }

      console.log("Sending request to backend API...");

      try {
        // Fetch current credentials
        const session = await fetchAuthSession();
        const creds = session.credentials;

        // Use backend API endpoint
        const requestBody = {
          messages: [
            ...messages.filter((msg) => !msg.id || msg.id),
            { role: "user", content: prompt },
          ],
        };

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        // Pass credentials if available
        if (creds) {
            headers["x-access-key-id"] = creds.accessKeyId;
            headers["x-secret-access-key"] = creds.secretAccessKey;
            if (creds.sessionToken) {
                headers["x-session-token"] = creds.sessionToken;
            }
        }

        // Send request to backend
        const response = await fetch("/api/invocations", {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });

        console.log("Response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.log("Error response body:", errorText);

          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText || "Unknown error" };
          }

          const msg =
            errorData.error ||
            errorData.message ||
            `HTTP ${response.status}: ${response.statusText || errorText}`;
          throw new Error(msg);
        }

        // Handle SSE streaming response from AgentCore
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let aiResponseAccumulator = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines (SSE format)
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (!line) continue;

            // Parse SSE data
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();

              if (data === "[DONE]") {
                console.log("Stream completed");
                break;
              }

              let parsed;
              try {
                parsed = JSON.parse(data);
                console.log("Received chunk:", JSON.stringify(parsed, null, 2));
              } catch (parseError) {
                console.error(
                  "JSON parse error:",
                  parseError,
                  "for data:",
                  data
                );
                continue;
              }

              // Handle error messages from the stream
              if (parsed.error) {
                throw new Error(parsed.error);
              }

              // AgentCore format: {"event": {"contentBlockDelta": {"delta": {"text": "..."}}}}
              if (
                parsed.event &&
                parsed.event.contentBlockDelta &&
                parsed.event.contentBlockDelta.delta
              ) {
                const text = parsed.event.contentBlockDelta.delta.text;
                if (text) {
                  aiResponseAccumulator += text;

                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessageIndex = newMessages.length - 1;
                    const lastMessage = { ...newMessages[lastMessageIndex] };

                    if (lastMessage.role === "assistant") {
                      lastMessage.content = aiResponseAccumulator;
                      newMessages[lastMessageIndex] = lastMessage;
                    }
                    return newMessages;
                  });
                }
              }

              // Handle message start
              if (parsed.event && parsed.event.messageStart) {
                console.log(
                  "Message start, role:",
                  parsed.event.messageStart.role
                );
              }

              // Handle message stop
              if (parsed.event && parsed.event.messageStop) {
                console.log(
                  "Message stopped, reason:",
                  parsed.event.messageStop.stopReason
                );
              }
            }
          }
        }

        // Update message with AI response after stream completes
        if (aiResponseAccumulator && savedMessageId) {
          try {
            await client.models.Message.update({
              id: savedMessageId,
              aiResponse: aiResponseAccumulator,
            });
          } catch (e) {
            console.error("Failed to save AI response:", e);
          }
        }
      } catch (fetchError) {
        const errorMessage =
          fetchError instanceof Error ? fetchError.message : "Unknown error";
        const isClientInitError =
          typeof errorMessage === "string" &&
          errorMessage.toLowerCase().includes("client initialization failed");
        const canRetry = retryCount < maxRetries && !isClientInitError;

        // 自動再試行（指数バックオフ）
        if (canRetry) {
          setTimeout(() => {
            sendMessage(prompt, retryCount + 1);
          }, retryDelay * Math.pow(2, retryCount));
        } else {
          setError(`通信エラー: ${errorMessage}`);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [getAuthTokens, maxRetries, retryDelay, sessionId, messages.length] // Added specific dependencies
  );

  /**
   * メッセージ履歴をクリアする
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  /**
   * AIの応答にフィードバックを送信する
   */
  const submitFeedback = useCallback(
    async (messageId: string, feedback: "good" | "bad") => {
      // Update local state first for immediate UI response
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, feedback } : msg))
      );

      // Update backend
      try {
        await client.models.Message.update({
          id: messageId,
          feedback,
        });
      } catch (e) {
        console.error("Failed to submit feedback:", e);
        // Optionally revert local state on error
      }
    },
    []
  );

  return {
    messages, // メッセージ履歴
    isLoading, // 送信中フラグ
    error, // エラーメッセージ
    sendMessage, // メッセージ送信関数
    clearMessages, // 履歴クリア関数
    submitFeedback, // フィードバック送信関数
  };
}
