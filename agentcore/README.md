# agentcore

Enter OAuth discovery URL:
https://cognito-idp.{リージョン名}.amazonaws.com/{CognitoのユーザープールID}/.well-known/openid-configuration

# Ex. https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_A7Y7qA18g/.well-known/openid-configuration

Oauth: https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxxx/.well-known/openid-configuration

# agentcore launch --local

```
  agentcore configure --entrypoint mcp_agent_gen2.py
  agentcore launch
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
