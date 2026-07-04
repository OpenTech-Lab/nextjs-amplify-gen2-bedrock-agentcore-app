import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { verifyCognitoCaller } from "@/lib/verify-cognito-caller";

// AgentCore runtime ARN
const CLIENT_AGENT_ARN = process.env.NEXT_PUBLIC_AGENT_ARN;
const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";

/**
 * Server-side proxy for invoking the AgentCore runtime.
 *
 * Calling bedrock-agentcore:InvokeAgentRuntime directly from the browser with
 * Cognito Identity Pool credentials (fetchAuthSession -> GetCredentialsForIdentity,
 * the "Enhanced/Simplified" auth flow) doesn't work: that flow always attaches an
 * AWS-managed default session policy that the caller cannot override, and it
 * doesn't grant bedrock-agentcore actions - regardless of what the identity-based
 * IAM policy on the auth/unauth role allows. So this call must run here, using the
 * Amplify Hosting SSR Compute role's credentials (see AWS's default credential
 * provider chain), which are not subject to that restriction.
 */
export async function POST(req: Request) {
  try {
    if (!CLIENT_AGENT_ARN) {
      throw new Error("NEXT_PUBLIC_AGENT_ARN environment variable is not defined");
    }

    const callerIdentityId = await verifyCognitoCaller(req);
    if (!callerIdentityId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const {
      prompt,
      tools,
      model,
    }: {
      prompt: string;
      tools?: string[];
      model?: string;
    } = await req.json();

    // Derived server-side from the verified caller identity - never trust a
    // client-supplied session id, or one caller could target/collide with
    // another's runtime session.
    const runtimeSessionId = `session-${callerIdentityId.replace(/[^a-zA-Z0-9-]/g, "-")}-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 15)}`;

    // Client is created per-request so it always picks up the SSR Compute
    // role's current (short-lived) credentials rather than a stale set.
    const client = new BedrockAgentCoreClient({ region: AWS_REGION });

    const payload = JSON.stringify({ prompt, tools, model });

    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: CLIENT_AGENT_ARN,
      runtimeSessionId,
      payload: Buffer.from(payload),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await client.send(command);
    const outputStream = response.response;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (outputStream) {
            const asyncIterable = outputStream as AsyncIterable<Uint8Array>;
            for await (const chunk of asyncIterable) {
              controller.enqueue(chunk);
            }
          }
          controller.close();
        } catch (error) {
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
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
