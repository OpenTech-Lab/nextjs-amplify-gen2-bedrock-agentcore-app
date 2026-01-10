#!/usr/bin/env bash
set -euo pipefail

# Stop any running agentcore first (if running in another shell)
# agentcore destroy   # only if you have a runtime up you want to stop

rm .bedrock_agentcore.yaml

# Remove agentcore runtime cache
rm -rf .bedrock_agentcore

# Remove Python bytecode caches
rm -rf .pytest_cache agentcore/__pycache__ **/__pycache__

# Remove the built agentcore image (if present)
docker images --format '{{.Repository}}:{{.Tag}}' | grep bedrock-agentcore-mcp_agent_gen2 || true
docker rmi -f $(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | awk '/bedrock-agentcore-mcp_agent_gen2/ {print $2}') 2>/dev/null || true

echo "Agentcore environment has been reset."