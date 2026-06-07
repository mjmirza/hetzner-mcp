# Security Model

Security is the first priority of this project. This document states the threat model
and the control for each threat. Every control is in the code and exercised by the eval
harness where possible.

## Assets to protect

1. The Hetzner Cloud API token and the Robot webservice password.
2. The user's Hetzner account, so the tool cannot be tricked into destructive or costly
   actions, or into talking to a host that is not Hetzner.

## Threats and controls

| Threat | Control | Where |
|---|---|---|
| Credential leaks into logs or error text | All error text passes through a secret redactor that strips Bearer and Basic auth and high entropy tokens | src/errors.ts redactSecrets |
| SSRF, the tool tricked into calling another host | The generic tools accept only a relative path. Full URLs, protocol relative URLs, path traversal, and control characters are rejected | src/security.ts normalizePath |
| Redirect to an attacker host | fetch uses redirect error, so any redirect fails rather than being followed | src/http.ts |
| Hung or slow endpoint stalls the agent | Every request has a hard timeout via AbortSignal | src/http.ts |
| Malformed or hostile tool input | Every tool validates input with a zod schema | src/tools |
| Accidental spend | Cost guard blocks billed creation unless confirm is true, and shows the live price first. An env kill switch can hard disable billed creation | src/cost.ts, src/tools/generic.ts, src/config.ts |
| Accidental data loss | Destructive guard. DELETE requires confirm true | src/tools/generic.ts |
| Unwanted writes in a sensitive environment | Global read only mode refuses all writes | src/config.ts, src/tools/generic.ts |
| Secrets committed to git | .gitignore excludes .env and token files. The token lives only in the environment | .gitignore |
| Oversized responses leaking or bloating context | Responses are capped and compacted by default | src/format.ts |

## What is verified by the eval harness

- SSRF path rejection, protocol relative rejection, path traversal rejection, normal path acceptance.
- Cost classification for billed and free operations.
- Secret redaction of a Bearer token.

See docs/AUDIT.md for the live run.

## Responsible disclosure

If you find a security issue, open a private advisory on the GitHub repository rather than
a public issue. Do not include a real token in any report.
