import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import { fetchAuthSession } from "aws-amplify/auth";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/protocol-http";

function buildApiUrl() {
  if (process.env.NEXT_PUBLIC_AGENT_ARN) {
    const agentArn = process.env.NEXT_PUBLIC_AGENT_ARN!;
    const region = process.env.NEXT_PUBLIC_AWS_REGION || "us-east-1";
    const escapedArn = encodeURIComponent(agentArn);
    const qualifier = process.env.NEXT_PUBLIC_QUALIFIER || "DRAFT";
    return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${escapedArn}/invocations?qualifier=${qualifier}`;
  } else {
    return "/api/invocations";
  }
}

/**
 * SSEチャット機能のオプション設定
 */
interface SSEChatOptions {
  maxRetries?: number; // 最大再試行回数
  retryDelay?: number; // 再試行間隔（ミリ秒）
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * SSE（Server-Sent Events）を使用したチャット機能のカスタムフック
 *
 * @param options 設定オプション
 * @returns チャット機能のstate と関数
 */
export function useSSEChat(options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  // State管理
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(
    () => `session-${Date.now()}-${Math.random().toString(36)}`
  );

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

      // Add user message immediately
      setMessages((prev) => [
        ...prev,
        { role: "user", content: prompt },
        { role: "assistant", content: "" },
      ]);

      // 認証トークンを取得
      const session = await fetchAuthSession();
      const credentials = session.credentials;
      if (!credentials) {
        setError("認証トークンが取得できません");
        setIsLoading(false);
        return;
      }

      console.log("Sending request to Lambda Function URL...");

      try {
        const functionUrl = buildApiUrl();
        const url = new URL(functionUrl);
        const region = process.env.NEXT_PUBLIC_AWS_REGION || "us-east-1";

        const requestBody = {
          prompt,
          model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
          reasoning: true,
        };

        // Extract query parameters for signing
        const query: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          query[key] = value;
        });

        const request = new HttpRequest({
          method: "POST",
          protocol: url.protocol,
          hostname: url.hostname,
          path: url.pathname,
          query,
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            host: url.hostname,
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
          },
          body: JSON.stringify(requestBody),
        });

        const signer = new SignatureV4({
          credentials: {
            accessKeyId: credentials.accessKeyId!,
            secretAccessKey: credentials.secretAccessKey!,
            sessionToken: credentials.sessionToken,
          },
          region,
          service: "bedrock-agentcore",
          sha256: Sha256,
        });

        const signedRequest = await signer.sign(request);

        const response = await fetch(functionUrl, {
          method: signedRequest.method,
          mode: "cors",
          headers: signedRequest.headers as HeadersInit,
          body: signedRequest.body as string,
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

          // If CORS blocked upstream (e.g., Function URL not configured), the browser
          // reports 403 with missing CORS headers. Surface a clearer hint.
          const msg =
            errorData.error ||
            errorData.message ||
            `HTTP ${response.status}: ${response.statusText || errorText}`;
          throw new Error(
            response.status === 403 &&
            !response.headers.get("access-control-allow-origin")
              ? `${msg} (CORS: Function URL must allow your origin and headers)`
              : msg
          );
        }

        // Handle SSE streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }

        const decoder = new TextDecoder();
        let buffer = "";

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

              try {
                const parsed = JSON.parse(data);

                // Handle error messages
                if (parsed.error) {
                  throw new Error(parsed.error);
                }

                // Append text chunks to the current message
                if (parsed.text) {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage.role === "assistant") {
                      lastMessage.content += parsed.text;
                    }
                    return newMessages;
                  });
                }
              } catch (parseError) {
                if (
                  parseError instanceof Error &&
                  parseError.message.startsWith("An error occurred")
                ) {
                  throw parseError;
                }
                console.error(
                  "JSON parse error:",
                  parseError,
                  "for data:",
                  data
                );
              }
            }
          }
        }
      } catch (fetchError) {
        // 自動再試行（指数バックオフ）
        if (retryCount < maxRetries) {
          setTimeout(() => {
            sendMessage(prompt, retryCount + 1);
          }, retryDelay * Math.pow(2, retryCount));
        } else {
          const errorMessage =
            fetchError instanceof Error ? fetchError.message : "Unknown error";
          setError(`通信エラー: ${errorMessage}`);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [getAuthTokens, maxRetries, retryDelay]
  );

  /**
   * メッセージ履歴をクリアする
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages, // メッセージ履歴
    isLoading, // 送信中フラグ
    error, // エラーメッセージ
    sendMessage, // メッセージ送信関数
    clearMessages, // 履歴クリア関数
  };
}
