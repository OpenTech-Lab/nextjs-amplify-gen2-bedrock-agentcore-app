import { defineFunction } from "@aws-amplify/backend";

/**
 * Server-side proxy for invoking the AgentCore runtime, as a standalone
 * function rather than a Next.js API route. Amplify Hosting's Next.js SSR
 * compute has a hard, non-configurable ~30s response timeout - AgentCore
 * agent calls with tool use routinely exceed that, so the invocation has to
 * run somewhere with its own, longer timeout instead (see
 * amplify/functions/invocations/handler.ts and the Function URL wiring in
 * amplify/backend.ts).
 */
export const invocationsFunction = defineFunction({
  name: "invocations",
  entry: "./handler.ts",
  timeoutSeconds: 300,
  memoryMB: 512,
});
