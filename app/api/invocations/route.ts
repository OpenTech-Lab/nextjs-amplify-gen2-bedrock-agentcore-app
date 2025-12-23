import { UIMessage } from "ai";

export const maxDuration = 60;

function buildApiUrl() {
  if (process.env.NEXT_PUBLIC_AGENT_ARN) {
    const agentArn = process.env.NEXT_PUBLIC_AGENT_ARN!;
    const region = process.env.NEXT_PUBLIC_AWS_REGION!;
    const escapedArn = encodeURIComponent(agentArn);
    const qualifier = process.env.NEXT_PUBLIC_QUALIFIER;
    return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${escapedArn}/invocations?qualifier=${qualifier}`;
  } else {
    return "/api/invocations";
  }
}

export async function POST(req: Request) {
  const {
    messages,
    model = "anthropic.claude-3-5-sonnet-20240620-v1:0",
  }: {
    messages: UIMessage[];
    model: string;
  } = await req.json();

  const authHeader = req.headers.get("Authorization");
  const apiUrl = buildApiUrl();
  console.log("Forwarding request to:", apiUrl);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ messages, model }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Agentcore API error:", response.status, errorText);
      return new Response(errorText, { status: response.status });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "text/plain",
      },
    });
  } catch (error) {
    console.error("Error forwarding request:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
