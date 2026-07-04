import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1";

// The account this app's Cognito Identity Pool roles live in, derived from
// the runtime ARN so it doesn't need its own env var.
const EXPECTED_ACCOUNT_ID = process.env.NEXT_PUBLIC_AGENT_ARN?.match(/^arn:aws:[^:]+:[^:]*:(\d{12}):/)?.[1];

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
 * any server route using it would be an open, unauthenticated proxy that
 * anyone on the internet could call.
 *
 * These credentials typically can't call the AWS service the route actually
 * needs (see app/api/invocations/route.ts for why), but they ARE real
 * STS-issued credentials, so calling GetCallerIdentity with them is a cheap,
 * side-effect-free way to prove the caller went through our Identity Pool
 * rather than just sending arbitrary headers. Returns the verified Cognito
 * identityId, or null if verification fails.
 */
export async function verifyCognitoCaller(req: Request): Promise<string | null> {
  const accessKeyId = req.headers.get("x-access-key-id");
  const secretAccessKey = req.headers.get("x-secret-access-key");
  const sessionToken = req.headers.get("x-session-token");
  const identityId = req.headers.get("x-identity-id");

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
