# agentcore

Enter OAuth discovery URL:
https://cognito-idp.{リージョン名}.amazonaws.com/{CognitoのユーザープールID}/.well-known/openid-configuration

# agentcore launch --local

```
agentcore configure --entrypoint mcp_agent_gen2.py
agentcore launch
agentcore destroy
```

## remove cache

```bash
./reset.sh

agentcore configure --entrypoint mcp_agent_gen2.py
agentcore launch
```

```bash
rm -rf agentcore/.bedrock_agentcore
rm -rf .pytest_cache __pycache__

docker images | grep bedrock-agentcore-mcp_agent_gen2 || true
docker rmi -f $(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | awk '/bedrock-agentcore-mcp_agent_gen2/ {print $2}') 2>/dev/null || true
```

## test

```
agentcore status
agentcore invoke '{"prompt": "Hello"}'
```

```
agentcore launch --local
agentcore invoke --local '{"prompt": "Hello"}'
```

## check log

```
aws logs tail "/aws/bedrock-agentcore/runtimes/mcp_agent_gen2-BozMaOAa8T-DEFAULT" \
  --log-stream-name-prefix "2025/12/27/[runtime-logs]" \
  --follow

aws logs tail "/aws/bedrock-agentcore/runtimes/mcp_agent_gen2-BozMaOAa8T-DEFAULT" \
  --log-stream-name-prefix "2025/12/27/[runtime-logs]" \
  --since 1h
```
