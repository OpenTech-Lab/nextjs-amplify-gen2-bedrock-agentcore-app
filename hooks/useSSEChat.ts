import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";
import { fetchAuthSession } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";

const client = generateClient<Schema>();

// AgentCore runtime ARN
const CLIENT_AGENT_ARN = process.env.NEXT_PUBLIC_AGENT_ARN;
const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";

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

      console.log("Sending request to AgentCore via SDK...");

      try {
        if (!CLIENT_AGENT_ARN) {
            throw new Error("NEXT_PUBLIC_AGENT_ARN environment variable is not defined");
        }

        // Fetch current credentials
        const session = await fetchAuthSession();
        const creds = session.credentials;

        if (!creds) {
            throw new Error("Failed to get AWS credentials");
        }

        const agentCoreClient = new BedrockAgentCoreClient({
            region: AWS_REGION,
            credentials: creds,
        });

        const inputText = messages.length > 0 
            ? `${messages.map(m => `${m.role}: ${m.content}`).join("\n")}\nuser: ${prompt}` 
            : prompt;

        // Generate session ID (must be >= 33 chars) - use the chat session Id if possible or generate one for runtime?
        // Runtime requires session ID to persist context.
        // We can reuse sessionId passed to the hook, but it needs to be formatted?
        // AgentCore runtime session ID requirements might differ. 
        // Let's generate one per turn or use persistent one? 
        // Python code uses random generation. Let's use sessionId if it fits.
        // But sessionId from hook might be UUID from somewhere else.
        // Let's create a runtime session ID that persists for the *hook* lifecycle or derive it.
        // For now, let's keep it simple and generate one per request like previous route (stateless HTTP), 
        // BUT wait, route.ts was "stateless" per HTTP request but agentcore runtime *has* state?
        // The previous python agent implementation: "agent_stream = current_agent.stream_async(user_prompt)" 
        // And strands.Helper likely manages history if session ID is provided.
        // The previous route.ts generated a NEW runtimeSessionId for EACH request:
        /*
        const runtimeSessionId = `session-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
        */
       // So it was effectively stateless? Or AgentCore preserves it?
       // If we want conversation history, we should probably keep the session ID consistent?
       // But let's replicate the route.ts behavior first.
        const runtimeSessionId = `session-${Date.now()}-${Math.random()
            .toString(36)
            .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;

        const payload = JSON.stringify({
            prompt: inputText,
        });

        const command = new InvokeAgentRuntimeCommand({
            agentRuntimeArn: CLIENT_AGENT_ARN,
            runtimeSessionId,
            payload: new TextEncoder().encode(payload),
            contentType: "application/json",
            accept: "application/json",
        });

        const response = await agentCoreClient.send(command);
        console.log("AgentCore response received");

        // Handle SSE streaming response from AgentCore
        // response.response is the stream
        const outputStream = response.response;
        if (!outputStream) {
             throw new Error("No output stream found in response");
        }

        let aiResponseAccumulator = "";
        const decoder = new TextDecoder();

        // Type assertion to iterate over the async iterable
        const asyncIterable = outputStream as AsyncIterable<Uint8Array>;
        for await (const chunk of asyncIterable) {
            let chunkStr = "";
            if (chunk instanceof Uint8Array) {
                chunkStr = decoder.decode(chunk);
            } else if (typeof chunk === "string") {
                chunkStr = chunk;
            } else {
                 chunkStr = JSON.stringify(chunk); // Should not happen for configured SDK
            }
            
            // The chunk from SDK might NOT be "data: ..." formatted strings if using SDK?
            // Wait, previous route.ts was manually decoding chunks and ENQUEUEING them to SSE controller.
            // But what does SDK return as payload? 
            // The "response" field in InvokeAgentRuntimeCommandOutput is: "response?: AsyncIterable<Uint8Array> | undefined"
            // The underlying service returns an Event Stream or just a stream of bytes?
            // In route.ts: "chunkStr = decoder.decode(chunk);" and then log it. 
            // The route.ts was then wrapping it in `controller.enqueue(...)` effectively passing it through.
            // The output from AgentCore Runtime IS ALREADY SSE-formatted text?
            // "data: {"event": ...}"
            
            // Yes, checking current logs: 
            // "data: {"event": {"messageStart": ...}}"
            // So we need to parse this SSE format manually here too.

            const lines = chunkStr.split("\n");
            for (const line of lines) {
                 if (!line || !line.trim()) continue;
                 
                 if (line.startsWith("data: ")) {
                     const data = line.slice(6).trim();
                     if (data === "[DONE]") continue;

                     try {
                         const parsed = JSON.parse(data);
                         
                         if (parsed.error) throw new Error(parsed.error);

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
                     } catch (e) {
                         console.error("Error parsing SSE chunk", e);
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
        console.error("Invocation error:", fetchError);
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
    [maxRetries, retryDelay, sessionId, messages] // Removed getAuthTokens as we use fetchAuthSession
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
