# Security policy

## Reporting a vulnerability

Please report security issues privately, never in a public issue.

Use GitHub's private reporting: open the **Security** tab of this repository and choose
**Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker
could do with it.

You will get a first reply within a few days. Once a fix is released, the report can be made
public with credit, if you want it.

## Supported versions

Only the latest release on npm receives security fixes.

## What is in scope

- The MCP server and its tools, including the read-only, cost and delete guards.
- The local map (`hetzner-mcp map`) and its API.
- The setup wizard and the local project store.
- Token handling anywhere in the package.

Findings that need an attacker to already control your Hetzner account, or your user account
on the machine, are still welcome but are rated lower.
