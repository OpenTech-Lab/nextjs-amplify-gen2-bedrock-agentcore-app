import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Aws } from "aws-cdk-lib";

const backend = defineBackend({
  auth,
  data,
});

const bedrockAgentCorePolicy = new PolicyStatement({
  actions: ["bedrock-agentcore:InvokeAgentRuntime"],
  resources: [
    `arn:aws:bedrock-agentcore:${Aws.REGION}:${Aws.ACCOUNT_ID}:runtime/mcp_agent_gen2-T26lUt3pz9`,
    `arn:aws:bedrock-agentcore:${Aws.REGION}:${Aws.ACCOUNT_ID}:runtime/mcp_agent_gen2-T26lUt3pz9:*`,
  ],
});

backend.auth.resources.authenticatedUserIamRole.addToPrincipalPolicy(
  bedrockAgentCorePolicy
);
