import os
import sys
from contextlib import ExitStack
from datetime import datetime, timezone

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from mcp import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from strands_tools import calculator, current_time, http_request, retrieve

# Bedrock Knowledge Base for document research (S3 Vectors-backed). Upload
# documents to its S3 data source bucket and re-sync the data source to make
# them searchable. strands_tools.retrieve reads these as its defaults.
os.environ.setdefault("KNOWLEDGE_BASE_ID", "WIASIAEP4H")
os.environ.setdefault("AWS_REGION", "ap-northeast-1")

# Models the frontend can pick from (see AVAILABLE_MODELS in hooks/useSSEChat.ts).
# Values are Bedrock model/inference-profile IDs.
# "sonnet-5" is kept here (not exposed in the web UI - not yet enabled for
# this AWS account) in case it's re-enabled later without a backend change.
AVAILABLE_MODELS = {
    "sonnet-4-6": "jp.anthropic.claude-sonnet-4-6",
    "haiku-4-5": "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    "sonnet-5": "global.anthropic.claude-sonnet-5",
}
DEFAULT_MODEL_ID = "sonnet-4-6"

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = """
You are a general-purpose agentic research assistant. You have tools to
search official AWS documentation, query the broader AWS Knowledge base
(What's New posts, blogs, architectural guidance, regional availability),
search the user's own document knowledge base, fetch web pages, do
calculations, and check the current time.

Answer any question you have the knowledge or tools to address, not just AWS
topics. Prefer using a tool over guessing whenever the question involves
current events, the user's own documents, AWS services/APIs, or anything you
are not certain about. For AWS-specific questions, prefer the AWS
documentation/knowledge tools over the web and cite which page(s) you used.
For general research questions, use web search/fetch as needed. When you use
the knowledge base tool, cite the source document(s) it returned.

Write as a professional expert: precise, direct, and free of emoji or casual
decoration. Do not use emoji anywhere in your responses.

Provide concise answers with only the relevant information.
"""


def _build_system_prompt() -> str:
    """SYSTEM_PROMPT plus dynamic context that must be current per-request
    (not baked in at cold start), e.g. the actual current date/time - the
    model's own training data has no knowledge of "today".
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC (%A)")
    return f"{SYSTEM_PROMPT}\n\nCurrent date/time: {now}"

# MCP client for the AWS Documentation MCP server (awslabs.aws-documentation-mcp-server).
# Spawned as a local stdio subprocess using the same Python interpreter/venv this
# app runs in, so no extra runtime (uvx/npx) needs to be present in the container.
_aws_docs_mcp_client = MCPClient(
    lambda: stdio_client(
        StdioServerParameters(
            command=sys.executable,
            args=["-m", "awslabs.aws_documentation_mcp_server.server"],
        )
    )
)

# MCP client for AWS's fully-managed, public AWS Knowledge MCP Server (remote,
# streamable-HTTP, no auth required). Broader than the docs server above: also
# covers What's New posts, blog posts, re:Post, and CFN/API regional availability.
# https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server
_aws_knowledge_mcp_client = MCPClient(
    lambda: streamablehttp_client("https://knowledge-mcp.global.api.aws")
)

# Each MCP client's transport must stay open for the life of the process (tool
# calls happen lazily, long after the registry is built), so they are entered
# once via this ExitStack rather than a per-request "with" block.
_exit_stack = ExitStack()

# Tools grouped by an id the caller can pick by. Populated once on cold start
# (the MCP-backed entries require spawning/connecting + handshaking, which is
# the expensive part) and reused across requests.
_tool_registry: dict[str, list] = {}

# Order here also defines the default enabled-tools order shown to callers.
TOOL_IDS = [
    "aws_documentation",
    "aws_knowledge",
    "knowledge_base",
    "calculator",
    "current_time",
    "http_request",
]


def _get_tool_registry() -> dict[str, list]:
    if not _tool_registry:
        print("Starting AWS Documentation MCP server...")
        _exit_stack.enter_context(_aws_docs_mcp_client)
        _tool_registry["aws_documentation"] = _aws_docs_mcp_client.list_tools_sync()

        print("Connecting to AWS Knowledge MCP server...")
        _exit_stack.enter_context(_aws_knowledge_mcp_client)
        _tool_registry["aws_knowledge"] = _aws_knowledge_mcp_client.list_tools_sync()

        _tool_registry["knowledge_base"] = [retrieve]
        _tool_registry["calculator"] = [calculator]
        _tool_registry["current_time"] = [current_time]
        _tool_registry["http_request"] = [http_request]
        print(f"Tool registry ready: {list(_tool_registry.keys())}")
    return _tool_registry


def _build_agent(selected_tool_ids: list[str] | None, model_id: str | None) -> Agent:
    """Build an Agent scoped to only the requested tool ids and model.

    Tool objects and the MCP subprocess/session are cached in _tool_registry
    and reused; only this lightweight Agent wrapper is created per request,
    so letting each request pick its own tool subset/model stays cheap.
    """
    registry = _get_tool_registry()
    ids = selected_tool_ids if selected_tool_ids else TOOL_IDS

    tools = []
    for tool_id in ids:
        tools.extend(registry.get(tool_id, []))

    bedrock_model_id = AVAILABLE_MODELS.get(model_id, AVAILABLE_MODELS[DEFAULT_MODEL_ID])

    return Agent(
        model=BedrockModel(model_id=bedrock_model_id),
        system_prompt=_build_system_prompt(),
        tools=tools,
    )


@app.entrypoint
async def invoke(payload):
    """Send a question to the agent and get a response.

    payload:
      prompt: str - the user's message (required)
      tools: list[str] | None - subset of TOOL_IDS to enable for this turn
        (see TOOL_IDS above); omitted/empty means all tools are enabled.
      model: str | None - key into AVAILABLE_MODELS to use for this turn;
        omitted/unknown falls back to DEFAULT_MODEL_ID.
    """
    user_prompt = payload.get(
        "prompt",
        "No prompt found in the input. Please instruct the user to create a JSON payload using the prompt key."
    )
    selected_tools = payload.get("tools")
    selected_model = payload.get("model")

    current_agent = _build_agent(selected_tools, selected_model)

    # Stream response from agent
    agent_stream = current_agent.stream_async(user_prompt)
    async for event in agent_stream:
        if "event" in event:
            yield event

if __name__ == "__main__":
    app.run()
