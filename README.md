## AI Chat App — Next.js + AWS Amplify Gen 2 + Bedrock AgentCore

A full-stack AI chat assistant built on Next.js (App Router) and AWS Amplify Gen 2, powered by an agentic backend running on Amazon Bedrock AgentCore Runtime (Strands Agents). Users chat with an AI assistant that can search AWS documentation, browse a broader AWS knowledge base, run retrieval-augmented search over your own uploaded documents, fetch web pages, do calculations, and check the current date/time — switching between Claude models per conversation.

## Features

- **AI chat with tool use** — streamed (SSE) responses from an agent that can call tools mid-answer, with a live "thinking" / "using tool X" status indicator in the UI.
- **Model switching** — pick the model per conversation (currently Claude Sonnet 4.6 or Claude Haiku 4.5) from a dropdown in the chat header.
- **Tool picker** — enable/disable per-conversation which tools the agent can use:
  - AWS Documentation search
  - AWS Knowledge (What's New posts, blogs, architecture guidance, regional/API availability)
  - Knowledge Base — semantic search over your own uploaded documents
  - Calculator
  - Current time
  - Web request (fetch a URL)
- **Document knowledge base (RAG)** — upload your own documents (PDFs, etc.) to an S3 bucket; they're chunked, embedded, and indexed via **Amazon Bedrock Knowledge Bases** backed by **Amazon S3 Vectors** (no OpenSearch — avoids its fixed idle cost). The agent cites source documents when it uses this tool. A **Knowledge Base file browser** in the chat header lists indexed documents and opens them directly from S3 via short-lived presigned URLs.
- **Guest mode** — use the assistant immediately without creating an account (Cognito unauthenticated identity); chat history isn't persisted for guests.
- **Custom authentication UI** — hand-rolled sign-in, sign-up, email confirmation, and forgot/reset-password flows (no prebuilt Amplify UI `<Authenticator>` component), styled to match the app.
- **Persistent chat history** — signed-in users' conversations and per-message feedback (👍/👎) are saved via Amplify Data (AppSync + DynamoDB).
- **Light/dark theme** toggle.
- **Cost guardrail** — an AWS Budget + Budget Action automatically denies further Bedrock model invocations once monthly Bedrock spend crosses a configured threshold, with email alerts along the way, auto-resetting each billing period.

## Architecture

- The browser never calls Bedrock or Bedrock AgentCore directly. Cognito Identity Pool credentials (used for guest and signed-in access alike) can't invoke `bedrock-agentcore:InvokeAgentRuntime` — that flow attaches an AWS-managed session policy that can't be overridden. Instead:
  - `app/api/invocations` — a Next.js Route Handler running under the Amplify Hosting **SSR Compute role** invokes the AgentCore runtime and streams the response back. It verifies the caller by validating their forwarded Cognito credentials via `sts:GetCallerIdentity` (see `lib/verify-cognito-caller.ts`), so it isn't an open proxy.
  - `app/api/knowledge-base/*` — same pattern, for listing knowledge base documents and generating presigned S3 URLs to open them.
- The agent itself (`agentcore/mcpAgentGen2/app/main.py`) runs as a Python process on **Bedrock AgentCore Runtime**, built with the **Strands Agents** SDK. It composes:
  - An MCP client (stdio) to the AWS Documentation MCP server.
  - An MCP client (streamable HTTP) to AWS's public AWS Knowledge MCP server.
  - The Strands `retrieve` tool against the Bedrock Knowledge Base.
  - `calculator`, `current_time`, `http_request` from `strands-agents-tools`.
  - A dynamically-built system prompt that always includes the current date/time.

## Tech Stack

**Frontend**
- [Next.js 14](https://nextjs.org/) (App Router), React 18, TypeScript
- Tailwind CSS + [shadcn/ui](https://ui.shadcn.com/) components (Radix UI primitives)
- `react-markdown` for rendering assistant responses
- `aws-amplify` (Auth, Data client), `aws-jwt-verify`

**Backend / infrastructure**
- **AWS Amplify Gen 2** — Cognito (auth, incl. guest/unauthenticated identities), AppSync + DynamoDB (chat history via Amplify Data), Amplify Hosting (Next.js SSR compute)
- **Amazon Bedrock AgentCore Runtime** — hosts the agent process
- **Strands Agents** (Python) — agent framework, tool orchestration, MCP integration
- **Model Context Protocol (MCP)** — `awslabs.aws-documentation-mcp-server` (local stdio) and AWS's Knowledge MCP server (remote)
- **Amazon Bedrock** — Claude Sonnet 4.6 / Claude Haiku 4.5 for chat; Amazon Titan Text Embeddings V2 for the knowledge base
- **Amazon Bedrock Knowledge Bases** + **Amazon S3 Vectors** — RAG document store (cost-effective, no OpenSearch)
- **AWS CDK** (via the `agentcore` CLI) — provisions the AgentCore runtime and its execution role
- **AWS Budgets** — cost guardrail with an automated IAM deny action

## Project Structure

```
app/                        Next.js App Router pages and API routes
  api/invocations/           Server-side AgentCore invocation proxy
  api/knowledge-base/         Knowledge base file listing + presigned URLs
components/                 React components (chat UI, auth, sidebar, shadcn/ui primitives)
hooks/                       useSSEChat (chat streaming), useAuth
lib/                          Shared server/client helpers (auth verification, fetch helpers)
amplify/                      Amplify Gen 2 backend definition (auth, data)
agentcore/mcpAgentGen2/       The Bedrock AgentCore agent project
  app/main.py                 Agent entrypoint (Strands Agent, tools, models, system prompt)
  agentcore/cdk/               CDK infrastructure for the AgentCore runtime
docs/knowledge_base/          Sample documents for the RAG knowledge base
```

## Getting Started

1. Install dependencies: `pnpm install` (this repo uses pnpm — using `npm install` here can corrupt the lockfile/`node_modules` layout).
2. Deploy the Amplify backend (auth + data): `npx ampx sandbox` (or configure CI/CD via Amplify Hosting).
3. Deploy the AgentCore agent: from `agentcore/mcpAgentGen2/`, run `agentcore deploy`.
4. Copy `.env.example` to `.env.local` and fill in the values (AgentCore runtime ARN, region, knowledge base S3 bucket name).
5. Run the app: `pnpm dev`.

See `agentcore/mcpAgentGen2/README.md` for more on the AgentCore CLI project and available commands.

## Deploying to AWS

For details on deploying the Next.js/Amplify frontend, see the [Amplify deployment docs](https://docs.amplify.aws/nextjs/start/quickstart/nextjs-app-router-client-components/#deploy-a-fullstack-app-to-aws).

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT License. See the LICENSE file.
