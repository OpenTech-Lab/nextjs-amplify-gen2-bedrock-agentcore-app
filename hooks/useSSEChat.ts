import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";

/**
 * SSEチャット機能のオプション設定
 */
interface SSEChatOptions {
  maxRetries?: number; // 最大再試行回数
  retryDelay?: number; // 再試行間隔（ミリ秒）
}

// ストリーミング関連の関数は削除（API Gatewayでは使用しない）
// const extractDataFromLine = (line: string): string | null => {
//   if (line.startsWith("data: ")) {
//     return line.slice(6).trim();
//   }
//   return null;
// };

// const extractMessageContent = (
//   parsed: Record<string, unknown>
// ): string | null => {
//   // エラーチェック
//   if (parsed.error && typeof parsed.error === "string") {
//     throw new Error(parsed.error);
//   }

//   if (
//     parsed.event &&
//     typeof parsed.event === "object" &&
//     parsed.event !== null
//   ) {
//     const event = parsed.event as {
//       contentBlockDelta?: { delta?: { text?: string } };
//     };
//     if (event.contentBlockDelta?.delta?.text) {
//       return event.contentBlockDelta.delta.text;
//     }
//   }

//   return null;
// };

/**
 * SSE（Server-Sent Events）を使用したチャット機能のカスタムフック
 *
 * @param options 設定オプション
 * @returns チャット機能のstate と関数
 */
export function useSSEChat(options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  // State管理
  const [messages, setMessages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      // 認証トークンを取得
      const { idToken, accessToken } = await getAuthTokens();
      if (!idToken || !accessToken) {
        setError("認証トークンが取得できません");
        setIsLoading(false);
        return;
      }

      console.log("Sending request to Lambda Function URL...");

      try {
        // Lambda Function URL with SSE streaming (no API Gateway timeout)
        const functionUrl = process.env.NEXT_PUBLIC_LAMBDA_FUNCTION_URL || "";

        const response = await fetch(functionUrl, {
          method: "POST",
          // 'cors' is default in browser for cross-origin; set explicitly for clarity
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "X-Access-Token": accessToken, // Access token for AgentCore (has client_id claim)
          },
          body: JSON.stringify({ prompt }),
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

        // 新しいメッセージスロットを追加
        setMessages((prev) => [...prev, ""]);

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
                    newMessages[newMessages.length - 1] += parsed.text;
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
