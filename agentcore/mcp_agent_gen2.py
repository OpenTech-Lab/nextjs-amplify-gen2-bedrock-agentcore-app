from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel

MODEL_ID = "jp.anthropic.claude-sonnet-4-5-20250929-v1:0"

app = BedrockAgentCoreApp()

# Global agent instance (will be initialized on first request)
agent = None

# Define a naming-focused system prompt
NAMING_SYSTEM_PROMPT = """
あなたは知識を提供するためにユーザーを支援するアシスタントです。
主な役割は、ユーザーが提供する情報に基づいて適切な情報を収集し回答することです。

回答は簡潔に、関連する情報のみを提供してください。
"""

def initialize_agent():
    """Initialize agent without MCP tools (basic agent)"""
    global agent

    if agent is None:
        print("Initializing basic agent without MCP tools...")
        
        # Create agent without external tools
        agent = Agent(
            model=BedrockModel(model_id=MODEL_ID),
            system_prompt=NAMING_SYSTEM_PROMPT,
        )
        print("Agent initialized successfully")

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
            yield event

if __name__ == "__main__":
    app.run()