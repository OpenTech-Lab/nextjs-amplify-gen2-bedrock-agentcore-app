from bedrock_agentcore.runtime import BedrockAgentCoreApp

from strands import Agent, tool
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

# from strands_tools import current_time
from mcp import StdioServerParameters, stdio_client

import datetime

MODEL_ID = "jp.anthropic.claude-sonnet-4-5-20250929-v1:0"

# MCP client configuration
import contextlib

# MCP client configuration
# stdio_mcp_client = MCPClient(
#     lambda: stdio_client(
#         StdioServerParameters(
#             command="python",
#             args=["-m", "awslabs.aws_documentation_mcp_server.server"],
#         )
#     )
# )

knowledge_mcp_client = MCPClient(
    lambda: stdio_client(
        StdioServerParameters(
            command="uv",
            args=["tool", "run", "fastmcp", "run", "https://knowledge-mcp.global.api.aws"],
        )
    )
)

app = BedrockAgentCoreApp()

# Global agent instance (will be initialized on first request)
agent = None
mcp_stack = contextlib.ExitStack()

# Define a naming-focused system prompt
NAMING_SYSTEM_PROMPT = """
あなたは知識を提供するためにユーザーを支援するアシスタントです。
主な役割は、ユーザーが提供する情報に基づいて適切な情報を収集し回答することです。

回答は簡潔に、関連する情報のみを提供してください。
"""


@tool
def current_time():
    """Returns the current time in ISO format."""
    return datetime.datetime.now().isoformat()

def initialize_agent():
    """Initialize agent with MCP tools (call once per container lifecycle)"""
    global agent, mcp_stack

    # if agent is None:
    print("Initializing agent with MCP tools...")
    
    try:
        # Enter MCP context for all clients
        # mcp_stack.enter_context(stdio_mcp_client)
        # print("Connected to Documentation MCP Server")
        
        mcp_stack.enter_context(knowledge_mcp_client)
        print("Connected to Knowledge MCP Server")

        # Get tools from MCP servers
        # doc_tools = stdio_mcp_client.list_tools_sync()
        knowledge_tools = knowledge_mcp_client.list_tools_sync()
        
        # Combine all tools
        tools = knowledge_tools
        tools.append(current_time)

        print(f"Loaded {len(tools)} total tools ({len(doc_tools)} doc, {len(knowledge_tools)} knowledge, 1 local)")
        
        # Create agent with tools
        agent = Agent(
            model=BedrockModel(model_id=MODEL_ID),
            tools=tools,
            system_prompt=NAMING_SYSTEM_PROMPT,
            
        )
        print("Agent initialized successfully")
    except Exception as e:
        print(f"Failed to initialize agent: {e}")
        # Ensure stack is closed on failure
        mcp_stack.close()
        raise e

    return agent


@app.entrypoint
async def invoke(payload):
    """エージェントに質問を投げてレスポンスを取得する"""
    # Lazy initialization - agent is created on first request
    current_agent = initialize_agent()

    # Extract user prompt
    user_prompt = payload.get(
        "prompt",
        "入力にプロンプ​​トが見つかりません。プロンプト キーを使用して JSON ペイロードを作成するように顧客に指示してください。"
    )

    # Stream response from agent
    agent_stream = current_agent.stream_async(user_prompt)
    async for event in agent_stream:
        if "event" in event:
            # Extract text from contentBlockDelta events
            # Structure: {'event': {'contentBlockDelta': {'delta': {'text': '...'}, ...}}}
            event_data = event["event"]
            if "contentBlockDelta" in event_data:
                delta = event_data["contentBlockDelta"].get("delta", {})
                if "text" in delta:
                    yield {"text": delta["text"]}

if __name__ == "__main__":
    try:
        app.run()
    finally:
        # Clean up all MCP contexts on shutdown
        if mcp_stack:
            mcp_stack.close()
