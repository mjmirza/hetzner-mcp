# Using hetzner-mcp inside an agent-os or Claude Code setup

This MCP is built to slot into a broader agent setup, not just a single chat.

## Register the server

User scope, available in every project.

```
claude mcp add -s user hetzner \
  -e HETZNER_CLOUD_TOKEN=your-token \
  -e HETZNER_ROBOT_USER=your-ws-user \
  -e HETZNER_ROBOT_PASSWORD=your-ws-password \
  -- npx -y hetzner-mcp
```

Confirm it registered with claude mcp list. Per the registration fidelity rule, the server
must appear in the CLI listing, not only in a settings file.

## Install the provision skill

Copy skills/hetzner-provision into your agent skills directory, for Claude Code that is
~/.claude/skills/hetzner-provision/. The skill drives the MCP tools to spin up and tear down
a full stack with a price preview and explicit confirmation.

## Standing behavior to add

For any Hetzner work, prefer the MCP over hand-written API calls, never create a billed
resource without confirmation, and always tear down test resources to stop cost.

## Safety defaults for an automated setup

- Set HETZNER_MCP_READONLY=1 for a look but do not touch posture.
- Set HETZNER_MCP_ALLOW_BILLED=0 to hard disable billed creation entirely.
- Both can be relaxed per project when you actually need to provision.

## Token efficiency

The server returns compact responses by default, so leaving it connected is cheap on
context. Use verbose true only when you need full payloads.
