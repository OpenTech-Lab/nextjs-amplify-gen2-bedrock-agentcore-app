import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";
import { fetchAuthSession } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import outputs from "@/amplify_outputs.json";

const client = generateClient<Schema>();

// The AgentCore invocation runs in a standalone Lambda (Function URL, not a
// Next.js API route) because Amplify Hosting's Next.js SSR compute has a
// hard ~30s response timeout that AgentCore tool-use calls can exceed - see
// amplify/functions/invocations/handler.ts.
const INVOCATIONS_URL = (outputs as { custom?: { invocationsFunctionUrl?: string } })
  .custom?.invocationsFunctionUrl;

/**
 * Options for the SSE chat hook
 */
interface SSEChatOptions {
  maxRetries?: number; // maximum number of retries
  retryDelay?: number; // retry interval (ms)
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
    id: "knowledge_base",
    label: "Knowledge Base",
    description:
      "Search your own uploaded documents (stored in S3, indexed via Amazon Bedrock Knowledge Bases) for relevant context.",
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
    id: "sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Current default. Balanced speed, cost, and intelligence.",
  },
  {
    id: "haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Fastest and most cost-effective. Best for simple, quick tasks.",
  },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]["id"];
const DEFAULT_MODEL_ID: ModelId = "sonnet-4-6";

/** Live status of the agent while a response is streaming in. */
export type AgentStatus =
  | { type: "thinking" }
  | { type: "tool_use"; name: string }
  | null;

/**
 * Maps a raw error (often a verbose AWS SDK message) to a short, generic
 * message safe to show in the chat UI. Full detail is only ever logged to
 * the console, never rendered.
 */
function toFriendlyErrorMessage(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  if (lower.includes("accessdenied") || lower.includes("not available for this account")) {
    return "Error: The selected model isn't available right now. Try a different model, or try again later.";
  }
  if (lower.includes("throttl") || lower.includes("rate")) {
    return "Error: Requests are being throttled. Please try again in a moment.";
  }
  return "Error: Failed to send message. Please try again in a moment.";
}

/**
 * Custom hook for chat functionality backed by Server-Sent Events (SSE)
 *
 * @param options Configuration options
 * @returns Chat state and functions
 */
export function useSSEChat(sessionId: string, options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  // State
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

  // Auth
  const { getAuthTokens, isAuthenticated } = useAuth();

  // Load history on mount
  useEffect(() => {
    // Guests have no Cognito User Pool identity, and Message/ChatSession are
    // owner-scoped (amplify/data/resource.ts) - there's nothing to load, and
    // calling the Data API as a guest would just throw
    // "NoValidAuthTokens: No federated jwt".
    if (!sessionId || !isAuthenticated) return;

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
  }, [sessionId, isAuthenticated]);

  /**
   * Sends a message and receives the AI's response
   * @param prompt The user's input prompt
   * @param retryCount Current retry count (internal use)
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

      // Message/ChatSession are owner-scoped (amplify/data/resource.ts) to
      // signed-in Cognito User Pool users. Guests have no User Pool identity
      // to own records with, so their chats are ephemeral (in-memory only,
      // never persisted) rather than granting guests broad, unscoped table
      // access just to work around that.
      if (isAuthenticated) {
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
      }

      console.log("Sending request to AgentCore via server-side proxy...");

      try {
        const inputText = messages.length > 0
            ? `${messages.map(m => `${m.role}: ${m.content}`).join("\n")}\nuser: ${prompt}`
            : prompt;

        // The actual bedrock-agentcore:InvokeAgentRuntime call happens in
        // amplify/functions/invocations/handler.ts, using that function's own
        // execution role's credentials. Calling it directly from the browser
        // with Cognito Identity Pool credentials (fetchAuthSession) doesn't
        // work: that flow always attaches an AWS-managed default session
        // policy the caller can't override, which doesn't grant
        // bedrock-agentcore actions regardless of the identity-based IAM
        // policy.
        //
        // The function still needs to verify the caller before invoking
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

        if (!INVOCATIONS_URL) {
            throw new Error("Invocations function URL is not configured");
        }

        const response = await fetch(INVOCATIONS_URL, {
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

                     let parsed;
                     try {
                         parsed = JSON.parse(data);
                     } catch (e) {
                         console.error("Error parsing SSE chunk", e);
                         continue;
                     }

                     // A backend/model error (e.g. AgentCore's underlying
                     // Bedrock call failing) - surface it as a real error
                     // instead of swallowing it, so the UI shows it and
                     // cleans up the empty assistant bubble (see the outer
                     // catch block below).
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
        // Full detail (AWS error text, stack, etc.) stays in the console for
        // debugging; the UI only ever shows the short, friendly version.
        console.error("Invocation error:", fetchError);
        const isClientInitError =
          typeof errorMessage === "string" &&
          errorMessage.toLowerCase().includes("client initialization failed");
        const canRetry = retryCount < maxRetries && !isClientInitError;

        // Automatic retry (exponential backoff)
        if (canRetry) {
          setTimeout(() => {
            sendMessage(prompt, retryCount + 1);
          }, retryDelay * Math.pow(2, retryCount));
        } else {
          setError(toFriendlyErrorMessage(errorMessage));
          // Drop the placeholder assistant bubble if nothing ever streamed
          // into it, so a failed send doesn't leave an empty chat block
          // behind - the error banner below already explains what happened.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.content === "") {
              return prev.slice(0, -1);
            }
            return prev;
          });
        }
      } finally {
        setIsLoading(false);
        setAgentStatus(null);
      }
    },
    [maxRetries, retryDelay, sessionId, messages, selectedTools, selectedModel, isAuthenticated] // Removed getAuthTokens as we use fetchAuthSession
  );

  /**
   * Clears the message history
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  /**
   * Submits feedback on an AI response
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
    messages, // message history
    isLoading, // whether a send is in progress
    error, // error message
    agentStatus, // "thinking" / "using tool X" live status
    selectedTools, // enabled tool ids
    setSelectedTools, // updates the selected tools
    selectedModel, // selected model id
    setSelectedModel, // updates the selected model
    sendMessage, // sends a message
    clearMessages, // clears the history
    submitFeedback, // submits feedback
  };
}
