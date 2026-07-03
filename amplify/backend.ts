import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Aws } from "aws-cdk-lib";

const backend = defineBackend({
  auth,
  data,
});

// Allow guest/unauthenticated identities from the Identity Pool, so the
// website's "Continue as Guest" flow can get real (unauthenticated-role)
// AWS credentials without signing in. See amplify/auth/resource.ts and
// components/AuthProvider.tsx for the rest of the guest-mode wiring.
backend.auth.resources.cfnResources.cfnIdentityPool.allowUnauthenticatedIdentities =
  true;

const agentRuntimeArnPrefix = `arn:aws:bedrock-agentcore:${Aws.REGION}:${Aws.ACCOUNT_ID}:runtime/mcpAgentGen2_MyAgent`;

const bedrockAgentCorePolicy = new PolicyStatement({
  actions: ["bedrock-agentcore:InvokeAgentRuntime"],
  resources: [
    `${agentRuntimeArnPrefix}*`,
    `${agentRuntimeArnPrefix}*/runtime-endpoint/*`,
  ],
});

backend.auth.resources.authenticatedUserIamRole.addToPrincipalPolicy(
  bedrockAgentCorePolicy
);
backend.auth.resources.unauthenticatedUserIamRole.addToPrincipalPolicy(
  bedrockAgentCorePolicy
);
