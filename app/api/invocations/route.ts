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
    system:
      "You are a helpful assistant that can answer questions and help with tasks",
  });

  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
