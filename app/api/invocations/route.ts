import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export const maxDuration = 30;

interface Message {
  role: string;
  content: string;
}

const client = new BedrockAgentCoreClient({
  region: "ap-northeast-1",
  credentials: fromNodeProviderChain(),
});

// AgentCore runtime ARN
const RUNTIME_ARN =
  process.env.RUNTIME_ARN ||
  "arn:aws:bedrock-agentcore:ap-northeast-1:832780067678:runtime/mcp_agent_gen2-T26lUt3pz9";

export async function POST(req: Request) {
  try {
    const {
      messages,
    }: {
      messages: Message[];
    } = await req.json();

    console.log("Received request with messages:", messages);

    // Convert messages to AgentCore format (last message is the user input)
    const lastMessage = messages[messages.length - 1];
    const inputText = lastMessage.content;

    console.log("Input text:", inputText);

    // Generate session ID (must be >= 33 chars)
    const runtimeSessionId = `session-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;

    console.log(
      "Invoking AgentCore runtime:",
      RUNTIME_ARN,
      "with sessionId:",
      runtimeSessionId
    );

    // Prepare payload as JSON string (matching AgentCore Python entrypoint format)
    const payload = JSON.stringify({
      prompt: inputText,
    });

    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: RUNTIME_ARN,
      runtimeSessionId,
      payload: Buffer.from(payload),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await client.send(command);

    console.log("AgentCore response received");
    console.log("Response keys:", Object.keys(response));

    // Stream the response as SSE
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // The response stream is in the 'response' property
          const outputStream = response.response;

          if (outputStream) {
            let chunkCount = 0;
            // Type assertion to iterate over the async iterable
            const asyncIterable = outputStream as AsyncIterable<Uint8Array>;
            for await (const chunk of asyncIterable) {
              chunkCount++;

              // The chunk is a Uint8Array, decode it to string
              let chunkStr = "";
              if (chunk instanceof Uint8Array) {
                chunkStr = decoder.decode(chunk);
              } else if (typeof chunk === "string") {
                chunkStr = chunk;
              } else {
                chunkStr = JSON.stringify(chunk);
              }

              console.log(`Chunk ${chunkCount}:`, chunkStr);

              // Forward the chunk as-is (it's already in SSE format)
              controller.enqueue(
                chunk instanceof Uint8Array ? chunk : encoder.encode(chunkStr)
              );
            }
            console.log(`Stream complete. Total chunks: ${chunkCount}`);
          } else {
            console.log(
              "No output stream found in response. Available keys:",
              Object.keys(response)
            );
          }
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("AgentCore invocation error:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
