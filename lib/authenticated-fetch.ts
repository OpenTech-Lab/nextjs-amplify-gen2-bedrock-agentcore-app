import { fetchAuthSession } from "aws-amplify/auth";

/**
 * Builds the headers our server routes use to verify the caller went through
 * this app's Cognito Identity Pool (see lib/verify-cognito-caller.ts) -
 * needed for every request to app/api/* routes that call AWS on the
 * caller's behalf. Works for both guests and signed-in users.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const creds = session.credentials;
  if (!creds || !session.identityId) {
    throw new Error("Failed to get AWS credentials");
  }

  return {
    "x-access-key-id": creds.accessKeyId,
    "x-secret-access-key": creds.secretAccessKey,
    "x-session-token": creds.sessionToken ?? "",
    "x-identity-id": session.identityId,
  };
}
