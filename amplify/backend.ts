import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

const backend = defineBackend({
  auth,
  data,
});

const bedrockAgentCorePolicy = new PolicyStatement({
  actions: ["bedrock-agentcore:InvokeAgentRuntime"],
  resources: [
    "arn:aws:bedrock-agentcore:ap-northeast-1:832780067678:runtime/mcp_agent_gen2-mbDZM6Dy7u",
  ],
});

backend.auth.resources.authenticatedUserIamRole.addToPrincipalPolicy(
  bedrockAgentCorePolicy
);
