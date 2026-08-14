## 2026-06-07 - URL Parsing Path Traversal & SSRF Prevention
**Vulnerability:** Path traversal and Server-Side Request Forgery (SSRF) bypass through percent-encoded characters (like `%2e%2e` for `..`) and backslashes (`\`) in relative paths parsed by the WHATWG URL standard.
**Learning:** Node's WHATWG URL implementation normalizes backslashes `\` to `/` and resolves percent-encoded dots to dot-dot segments during parsing, which can bypass simple substring checks like `.includes("..")` and allow attackers to point requests to arbitrary paths or hosts.
**Prevention:** Explicitly decode the path via `decodeURIComponent` and check for the presence of both `..` and `\` in both the raw input and decoded input, rejecting any path containing them.
