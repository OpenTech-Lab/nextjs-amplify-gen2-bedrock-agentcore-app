import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Aws } from "aws-cdk-lib";

const backend = defineBackend({
  auth,
  data,
});

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
