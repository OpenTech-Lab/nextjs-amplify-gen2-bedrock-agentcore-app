import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyCognitoCaller } from "@/lib/verify-cognito-caller";

const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";
// Server-only (no NEXT_PUBLIC_ prefix) so it never reaches the client bundle.
const KNOWLEDGE_BASE_BUCKET = process.env.KNOWLEDGE_BASE_BUCKET;

// Short-lived: just long enough to open the file, not a durable share link.
const PRESIGNED_URL_TTL_SECONDS = 300;

/**
 * Returns a short-lived presigned S3 URL for a single knowledge base
 * document, so the browser can open/download it directly from S3 without
 * the file content ever being proxied through this server.
 */
export async function GET(req: Request) {
  const callerIdentityId = await verifyCognitoCaller(req);
  if (!callerIdentityId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!KNOWLEDGE_BASE_BUCKET) {
    return new Response(
      JSON.stringify({ error: "KNOWLEDGE_BASE_BUCKET environment variable is not defined" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (!key) {
    return new Response(JSON.stringify({ error: "Missing 'key' query parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const client = new S3Client({ region: AWS_REGION });
    const command = new GetObjectCommand({ Bucket: KNOWLEDGE_BASE_BUCKET, Key: key });
    const url = await getSignedUrl(client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });

    return new Response(JSON.stringify({ url }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Knowledge base file URL error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
