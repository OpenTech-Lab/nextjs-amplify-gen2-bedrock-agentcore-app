import { CognitoJwtVerifier } from "aws-jwt-verify";
import { logError } from "./error-utils";
import outputs from "@/amplify_outputs.json";

type AmplifyOutputsLike = {
  auth?: {
    user_pool_id?: string;
    user_pool_client_id?: string;
  };
  aws_user_pools_id?: string;
  aws_user_pools_web_client_id?: string;
};

const getVerifier = (() => {
  let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

  return () => {
    if (verifier) return verifier;

    const o = outputs as unknown as AmplifyOutputsLike;
    const userPoolId = o.auth?.user_pool_id ?? o.aws_user_pools_id;
    const clientId =
      o.auth?.user_pool_client_id ?? o.aws_user_pools_web_client_id;

    if (!userPoolId || !clientId) {
      throw new Error(
        "Missing Cognito config in amplify outputs (expected auth.user_pool_id and auth.user_pool_client_id)"
      );
    }

    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "id",
      clientId,
    });

    return verifier;
  };
})();

// Verifies a JWT token
export async function verifyJWT(token: string): Promise<boolean> {
  try {
    const verifier = getVerifier();
    // Verifies the token's signature, expiration, issuer, etc.
    const payload = await verifier.verify(token);
    console.log("JWT verification succeeded:", payload.sub); // user id
    return true;
  } catch (error) {
    logError("JWT verification", error);
    return false;
  }
}
