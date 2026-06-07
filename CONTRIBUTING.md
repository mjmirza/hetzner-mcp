# Contributing to hetzner-mcp

Thank you for helping this project grow. The goal is a complete, tested, honest MCP
for the entire Hetzner platform. Contributions of every size are welcome, from fixing
a typo to adding a whole resource surface.

## The fastest paths

1. Something you needed was missing. Open a feature request. The MCP can even hand you a
   prefilled issue link through its contribute_or_report tool. Just paste and submit.
2. You already built the fix. Open a pull request. See the flow below.
3. You found a bug. Open a bug report with the exact tool call and the response you got.

## Ground rules

- Every endpoint must be tested live before it is marked done. Record the result in
  docs/ENDPOINT-AUDIT.md with the date and HTTP code.
- Never let a change create a billed resource in a test without an immediate delete and
  a line in the cost ledger. Read endpoints and free-to-create resources are safe.
- Keep the cost guard intact. Billed creates require the confirm flag and a price preview.
- Quality gate. the repo runs fallow for dead code and hygiene. New dead code is blocked.
  Run the gate locally before you push.

## Pull request flow

1. Fork the repo and create a branch, for example feat/add-load-balancer-services.
2. Make the change. Add or update the typed tool, the schema, and the audit row.
3. Test it live against your own Hetzner account. Paste the real result in the PR.
4. Run the build and the fallow gate locally. Both must pass.
5. Open the PR using the template. Describe what endpoint or behavior it adds and the
   live test evidence.

## What to work on

See docs/ENDPOINT-AUDIT.md for what is covered and what is pending, and docs/ROADMAP.md
for the phase plan. Anything marked pending is a great first contribution.

## Credit

Contributors are credited in docs/CREDITS.md. If you port a pattern from another open
source project, keep its attribution there too.
