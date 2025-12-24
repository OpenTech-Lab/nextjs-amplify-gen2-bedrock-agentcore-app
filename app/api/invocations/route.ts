import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { convertToModelMessages, streamText, UIMessage } from "ai";

export const maxDuration = 30;

const bedrock = createAmazonBedrock({
  region: "ap-northeast-1",
  credentialProvider: fromNodeProviderChain(),
});

export async function POST(req: Request) {
  const {
    messages,
    model = "anthropic.claude-3-5-sonnet-20240620-v1:0",
  }: {
    messages: UIMessage[];
    model: string;
  } = await req.json();

  const result = streamText({
    model: bedrock(model),
    messages: await convertToModelMessages(messages),
    system: `
      あなたは知識を提供するためにユーザーを支援するアシスタントです。
      主な役割は、ユーザーが提供する情報に基づいて適切な情報を収集し回答することです。
      回答は簡潔に、関連する情報のみを提供してください。
      `,
  });

  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
