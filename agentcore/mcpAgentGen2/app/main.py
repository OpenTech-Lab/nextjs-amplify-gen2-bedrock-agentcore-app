from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel

MODEL_ID = "jp.anthropic.claude-sonnet-4-5-20250929-v1:0"

app = BedrockAgentCoreApp()

# Global agent instance (will be initialized on first request)
agent = None

# Define a naming-focused system prompt
NAMING_SYSTEM_PROMPT = """
You are an assistant that helps users by providing knowledge.
Your main role is to collect and respond with appropriate information based on what the user provides.

Provide concise answers with only relevant information.
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
    """Send a question to the agent and get a response"""
    # Lazy initialization - agent is created on first request
    current_agent = initialize_agent()

    # Extract user prompt
    user_prompt = payload.get(
        "prompt",
        "No prompt found in the input. Please instruct the user to create a JSON payload using the prompt key."
    )

    # Stream response from agent
    agent_stream = current_agent.stream_async(user_prompt)
    async for event in agent_stream:
        if "event" in event:
            yield event

if __name__ == "__main__":
    app.run()