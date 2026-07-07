import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { invocationsFunction } from "./functions/invocations/resource.js";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Aws } from "aws-cdk-lib";
import { FunctionUrlAuthType, InvokeMode, HttpMethod } from "aws-cdk-lib/aws-lambda";

const backend = defineBackend({
  auth,
  data,
  invocationsFunction,
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

// The invocations function runs the actual bedrock-agentcore:InvokeAgentRuntime
// call using its own execution role's credentials (see
// amplify/functions/invocations/handler.ts for why this can't run with the
// caller's Identity Pool credentials directly).
backend.invocationsFunction.resources.lambda.addToRolePolicy(
  bedrockAgentCorePolicy
);
backend.invocationsFunction.addEnvironment(
  "AGENT_ARN",
  process.env.NEXT_PUBLIC_AGENT_ARN ?? ""
);

// Exposed via a Function URL (not API Gateway) specifically because Function
// URLs support InvokeMode.RESPONSE_STREAM, letting the AgentCore SSE stream
// flow straight through instead of being buffered - and, unlike Amplify
// Hosting's Next.js SSR compute, a Lambda invoked this way is subject to its
// own configurable timeout (up to 15 minutes) rather than a fixed ~30s cap.
const invocationsFunctionUrl = backend.invocationsFunction.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  invokeMode: InvokeMode.RESPONSE_STREAM,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [HttpMethod.POST],
    allowedHeaders: [
      "content-type",
      "x-access-key-id",
      "x-secret-access-key",
      "x-session-token",
      "x-identity-id",
    ],
  },
});

backend.addOutput({
  custom: {
    invocationsFunctionUrl: invocationsFunctionUrl.url,
  },
});
