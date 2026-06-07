## What this adds
A short description of the endpoint, tool, or fix.

## Surface
Cloud, Storage Box, or Robot.

## Live test evidence
Paste the real result of calling this against a Hetzner account, with secrets removed.
Confirm no billed resource was left running.

## Checklist
- [ ] docs/ENDPOINT-AUDIT.md updated with the endpoint and its tested result
- [ ] Build passes (npm run build)
- [ ] Fallow gate passes (no new dead code)
- [ ] Cost guard intact for any billed create
- [ ] No secrets committed
