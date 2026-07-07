import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

// Lambda's Node.js runtime injects this global when the function is invoked
// through a Function URL configured with InvokeMode.RESPONSE_STREAM - it
// isn't part of the public npm API, so it isn't typed.
declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: FunctionUrlEvent,
      responseStream: NodeJS.WritableStream,
      context: unknown
    ) => Promise<void>
  ) => unknown;
  HttpResponseStream: {
    from: (
      stream: NodeJS.WritableStream,
      metadata: { statusCode: number; headers?: Record<string, string> }
    ) => NodeJS.WritableStream;
  };
};

interface FunctionUrlEvent {
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

const CLIENT_AGENT_ARN = process.env.AGENT_ARN;
const AWS_REGION = process.env.AWS_REGION;

// The account this app's Cognito Identity Pool roles live in, derived from
// the runtime ARN so it doesn't need its own env var.
const EXPECTED_ACCOUNT_ID = CLIENT_AGENT_ARN?.match(/^arn:aws:[^:]+:[^:]*:(\d{12}):/)?.[1];

// Cognito's GetCredentialsForIdentity always assumes the pool's auth/unauth
// role with this fixed session name, and the role name always carries this
// Amplify-generated "amplifyAuth(un)?authenticate" fragment - see
// amplify/backend.ts (authenticatedUserIamRole / unauthenticatedUserIamRole).
const COGNITO_ASSUMED_ROLE_ARN_RE =
  /^arn:aws:sts::(\d{12}):assumed-role\/amplify-.*-amplifyAuth(?:un)?authenticate.*\/CognitoIdentityCredentials$/;

/**
 * Verifies that a request actually came from a client holding real, Cognito
 * Identity Pool-issued AWS credentials (guest or signed-in - both are
 * legitimate; this app intentionally allows guest access). Without this,
 * this function would be an open, unauthenticated proxy that anyone on the
 * internet could call.
 *
 * These credentials typically can't call bedrock-agentcore directly (that
 * flow always attaches an AWS-managed default session policy the caller
 * can't override, regardless of what the identity-based IAM policy on the
 * auth/unauth role allows) - but they ARE real STS-issued credentials, so
 * calling GetCallerIdentity with them is a cheap, side-effect-free way to
 * prove the caller went through our Identity Pool rather than just sending
 * arbitrary headers. Returns the verified Cognito identityId, or null if
 * verification fails.
 */
async function verifyCognitoCaller(headers: Record<string, string | undefined>): Promise<string | null> {
  const accessKeyId = headers["x-access-key-id"];
  const secretAccessKey = headers["x-secret-access-key"];
  const sessionToken = headers["x-session-token"];
  const identityId = headers["x-identity-id"];

  if (!accessKeyId || !secretAccessKey || !sessionToken || !identityId) {
    return null;
  }

  try {
    const sts = new STSClient({
      region: AWS_REGION,
      credentials: { accessKeyId, secretAccessKey, sessionToken },
    });
    const identity = await sts.send(new GetCallerIdentityCommand({}));

    const match = identity.Arn?.match(COGNITO_ASSUMED_ROLE_ARN_RE);
    if (!match || match[1] !== EXPECTED_ACCOUNT_ID) {
      return null;
    }

    return identityId;
  } catch {
    return null;
  }
}

function writeJsonError(
  responseStream: NodeJS.WritableStream,
  statusCode: number,
  message: string
) {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { "Content-Type": "application/json" },
  });
  stream.write(JSON.stringify({ error: message }));
  stream.end();
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(event.headers ?? {})) {
      headers[key.toLowerCase()] = value;
    }

    try {
      if (!CLIENT_AGENT_ARN) {
        writeJsonError(responseStream, 500, "AGENT_ARN environment variable is not defined");
        return;
      }

      const callerIdentityId = await verifyCognitoCaller(headers);
      if (!callerIdentityId) {
        writeJsonError(responseStream, 401, "Unauthorized");
        return;
      }

      const rawBody = event.isBase64Encoded && event.body
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body ?? "{}";

      const {
        prompt,
        tools,
        model,
      }: {
        prompt: string;
        tools?: string[];
        model?: string;
      } = JSON.parse(rawBody);

      // Derived server-side from the verified caller identity - never trust a
      // client-supplied session id, or one caller could target/collide with
      // another's runtime session.
      const runtimeSessionId = `session-${callerIdentityId.replace(/[^a-zA-Z0-9-]/g, "-")}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 15)}`;

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

      const stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });

      try {
        if (outputStream) {
          const asyncIterable = outputStream as AsyncIterable<Uint8Array>;
          for await (const chunk of asyncIterable) {
            stream.write(chunk);
          }
        }
      } catch (streamError) {
        // Headers/status (200) are already committed at this point, so a
        // JSON error response can't be written - just log and end the
        // connection, same as the previous Next.js route's
        // controller.error() behavior.
        console.error("AgentCore stream error:", streamError);
      }
      stream.end();
    } catch (error) {
      console.error("AgentCore invocation error:", error);
      writeJsonError(
        responseStream,
        500,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }
);
