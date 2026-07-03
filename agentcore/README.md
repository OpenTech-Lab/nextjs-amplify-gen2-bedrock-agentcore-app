# agentcore

The deployed project lives in `mcpAgentGen2/` (new `@aws/agentcore` npm CLI, CDK-based). Run all
`agentcore` commands from `mcpAgentGen2/`.

Agent source: `mcpAgentGen2/app/main.py` (Strands agent, Bedrock model). Project config:
`mcpAgentGen2/agentcore/agentcore.json`, deployment target: `mcpAgentGen2/agentcore/aws-targets.json`.

## OAuth discovery URL (for CUSTOM_JWT authorizer, if configured)

```
https://cognito-idp.{region}.amazonaws.com/{CognitoUserPoolId}/.well-known/openid-configuration
```

## deploy / invoke

```bash
cd mcpAgentGen2
agentcore deploy
agentcore invoke '{"prompt": "Hello"}'
agentcore status
```

## local dev (hot-reload)

```bash
cd mcpAgentGen2
agentcore dev
agentcore invoke --local '{"prompt": "Hello"}'
```

## check logs

```bash
cd mcpAgentGen2
agentcore logs
```

or directly via CloudWatch (replace the runtime id from `agentcore status`):

```bash
aws logs tail "/aws/bedrock-agentcore/runtimes/mcpAgentGen2_MyAgent-1L0RoiH7To-DEFAULT" \
  --region ap-northeast-1 \
  --follow
```

## remove cache

```bash
rm -rf mcpAgentGen2/agentcore/cdk/cdk.out mcpAgentGen2/agentcore/.cache
rm -rf .pytest_cache **/__pycache__
```
