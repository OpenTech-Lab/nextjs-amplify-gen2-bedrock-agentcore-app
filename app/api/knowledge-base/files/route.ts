import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { verifyCognitoCaller } from "@/lib/verify-cognito-caller";

const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";
// Server-only (no NEXT_PUBLIC_ prefix) so it never reaches the client bundle.
const KNOWLEDGE_BASE_BUCKET = process.env.KNOWLEDGE_BASE_BUCKET;

/**
 * Lists the documents in the Knowledge Base's S3 bucket, using the Amplify
 * SSR Compute role's credentials (the bucket blocks public access, so this
 * can't be listed directly from the browser).
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

  try {
    const client = new S3Client({ region: AWS_REGION });
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: KNOWLEDGE_BASE_BUCKET })
    );

    const files = (response.Contents ?? [])
      .filter((obj) => obj.Key)
      .map((obj) => ({
        key: obj.Key as string,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? null,
      }));

    return new Response(JSON.stringify({ files }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Knowledge base file listing error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
