import sys
from contextlib import ExitStack

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from mcp import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from strands_tools import calculator, current_time, http_request

MODEL_ID = "jp.anthropic.claude-sonnet-4-5-20250929-v1:0"

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = """
You are an agentic AWS assistant. You have tools to search official AWS
documentation, query the broader AWS Knowledge base (What's New posts,
blogs, architectural guidance, regional availability), fetch web pages, do
calculations, and check the current time.

Prefer using a tool over guessing whenever the question involves AWS services,
APIs, current events, or anything you are not certain about. When you use the
AWS documentation/knowledge tools, cite which page(s) you used.

Provide concise answers with only the relevant information.
"""

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

        _tool_registry["calculator"] = [calculator]
        _tool_registry["current_time"] = [current_time]
        _tool_registry["http_request"] = [http_request]
        print(f"Tool registry ready: {list(_tool_registry.keys())}")
    return _tool_registry


def _build_agent(selected_tool_ids: list[str] | None) -> Agent:
    """Build an Agent scoped to only the requested tool ids.

    Tool objects and the MCP subprocess/session are cached in _tool_registry
    and reused; only this lightweight Agent wrapper is created per request,
    so letting each request pick its own tool subset stays cheap.
    """
    registry = _get_tool_registry()
    ids = selected_tool_ids if selected_tool_ids else TOOL_IDS

    tools = []
    for tool_id in ids:
        tools.extend(registry.get(tool_id, []))

    return Agent(
        model=BedrockModel(model_id=MODEL_ID),
        system_prompt=SYSTEM_PROMPT,
        tools=tools,
    )


@app.entrypoint
async def invoke(payload):
    """Send a question to the agent and get a response.

    payload:
      prompt: str - the user's message (required)
      tools: list[str] | None - subset of TOOL_IDS to enable for this turn
        (see TOOL_IDS above); omitted/empty means all tools are enabled.
    """
    user_prompt = payload.get(
        "prompt",
        "No prompt found in the input. Please instruct the user to create a JSON payload using the prompt key."
    )
    selected_tools = payload.get("tools")

    current_agent = _build_agent(selected_tools)

    # Stream response from agent
    agent_stream = current_agent.stream_async(user_prompt)
    async for event in agent_stream:
        if "event" in event:
            yield event

if __name__ == "__main__":
    app.run()
