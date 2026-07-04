import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";
import { fetchAuthSession } from "aws-amplify/auth";
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

/** Tool ids the backend agent (agentcore/mcpAgentGen2/app/main.py) knows how to enable. */
export const AVAILABLE_TOOLS = [
  {
    id: "aws_documentation",
    label: "AWS Documentation",
    description:
      "Search and read official AWS documentation pages (docs.aws.amazon.com) for accurate, up-to-date service details.",
  },
  {
    id: "aws_knowledge",
    label: "AWS Knowledge",
    description:
      "Query AWS's broader knowledge base: What's New posts, blog posts, architecture guidance, and regional/API availability.",
  },
  {
    id: "calculator",
    label: "Calculator",
    description: "Evaluate mathematical expressions precisely instead of guessing.",
  },
  {
    id: "current_time",
    label: "Current Time",
    description: "Look up the current date/time instead of relying on training data.",
  },
  {
    id: "http_request",
    label: "Web Request",
    description: "Fetch content from a URL, e.g. to read a web page the user links to.",
  },
] as const;

export type ToolId = (typeof AVAILABLE_TOOLS)[number]["id"];

/** Model ids the backend agent (agentcore/mcpAgentGen2/app/main.py) knows how to switch to. */
export const AVAILABLE_MODELS = [
  {
    id: "sonnet-5",
    label: "Claude Sonnet 5",
    description:
      "Current default. Anthropic's newest Sonnet — near-Opus intelligence for coding and agentic work at Sonnet pricing.",
  },
  {
    id: "haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Fastest and most cost-effective. Best for simple, quick tasks.",
  },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]["id"];
const DEFAULT_MODEL_ID: ModelId = "sonnet-5";

/** Live status of the agent while a response is streaming in. */
export type AgentStatus =
  | { type: "thinking" }
  | { type: "tool_use"; name: string }
  | null;

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
  // Which tools/MCP servers the agent is allowed to use. Defaults to all.
  const [selectedTools, setSelectedTools] = useState<ToolId[]>(
    AVAILABLE_TOOLS.map((t) => t.id)
  );
  // Which model the agent should use. Defaults to the current production model.
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  // "Thinking..." / "Using tool: X" indicator, derived from the raw Bedrock
  // Converse stream events (messageStart / contentBlockStart / contentBlockDelta).
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(null);
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
      setAgentStatus({ type: "thinking" });

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

      console.log("Sending request to AgentCore via server-side proxy...");

      try {
        const inputText = messages.length > 0
            ? `${messages.map(m => `${m.role}: ${m.content}`).join("\n")}\nuser: ${prompt}`
            : prompt;

        // The actual bedrock-agentcore:InvokeAgentRuntime call happens in
        // app/api/invocations/route.ts, using the Amplify SSR Compute role's
        // credentials. Calling it directly from the browser with Cognito
        // Identity Pool credentials (fetchAuthSession) doesn't work: that
        // flow always attaches an AWS-managed default session policy the
        // caller can't override, which doesn't grant bedrock-agentcore
        // actions regardless of the identity-based IAM policy.
        //
        // That route still needs to verify the caller before invoking
        // anything (otherwise it's an open, unauthenticated proxy) - it does
        // so by validating these Cognito Identity Pool credentials via STS,
        // which is why they're forwarded here even though they can't be used
        // to call bedrock-agentcore themselves. The runtime session id is
        // derived server-side from the verified identity, not sent by us.
        const session = await fetchAuthSession();
        const creds = session.credentials;
        if (!creds || !session.identityId) {
            throw new Error("Failed to get AWS credentials");
        }

        const response = await fetch("/api/invocations", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-access-key-id": creds.accessKeyId,
                "x-secret-access-key": creds.secretAccessKey,
                "x-session-token": creds.sessionToken ?? "",
                "x-identity-id": session.identityId,
            },
            body: JSON.stringify({
                prompt: inputText,
                tools: selectedTools,
                model: selectedModel,
            }),
        });

        if (!response.ok || !response.body) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(errorBody || `Request failed with status ${response.status}`);
        }
        console.log("AgentCore response received");

        let aiResponseAccumulator = "";
        const decoder = new TextDecoder();

        const reader = response.body.getReader();
        for (;;) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            let chunkStr = "";
            if (chunk instanceof Uint8Array) {
                chunkStr = decoder.decode(chunk);
            } else if (typeof chunk === "string") {
                chunkStr = chunk;
            } else {
                 chunkStr = JSON.stringify(chunk); // Should not happen for a Response body stream
            }

            // The proxy route passes through AgentCore's raw SSE bytes
            // ("data: {\"event\": {...}}"), so we parse that format here.
            const lines = chunkStr.split("\n");
            for (const line of lines) {
                 if (!line || !line.trim()) continue;
                 
                 if (line.startsWith("data: ")) {
                     const data = line.slice(6).trim();
                     if (data === "[DONE]") continue;

                     try {
                         const parsed = JSON.parse(data);
                         
                         if (parsed.error) throw new Error(parsed.error);

                         const event = parsed.event;
                         if (event?.messageStart) {
                           // Model has started composing a turn, no tokens yet.
                           setAgentStatus({ type: "thinking" });
                         } else if (event?.contentBlockStart?.start?.toolUse) {
                           // Model is about to call a tool.
                           setAgentStatus({
                             type: "tool_use",
                             name: event.contentBlockStart.start.toolUse.name,
                           });
                         } else if (event?.messageStop) {
                           setAgentStatus(null);
                         }

                         if (event?.contentBlockDelta?.delta) {
                            const text = event.contentBlockDelta.delta.text;
                            if (text) {
                              // Actual answer text is streaming in, so we're
                              // no longer "thinking" or mid-tool-call.
                              setAgentStatus(null);
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
        setAgentStatus(null);
      }
    },
    [maxRetries, retryDelay, sessionId, messages, selectedTools, selectedModel] // Removed getAuthTokens as we use fetchAuthSession
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
    agentStatus, // "thinking" / "using tool X" ライブステータス
    selectedTools, // 有効なツールのid一覧
    setSelectedTools, // ツール選択を更新する関数
    selectedModel, // 選択中のモデルid
    setSelectedModel, // モデル選択を更新する関数
    sendMessage, // メッセージ送信関数
    clearMessages, // 履歴クリア関数
    submitFeedback, // フィードバック送信関数
  };
}
