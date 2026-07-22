# Sentinel's Journal - Critical Learnings Only

## 2026-06-07 - URL-Decoding and Backslash normalization in WHATWG URL Parsers
**Vulnerability:** Path traversal and SSRF via percent-encoded dots (`%2e%2e`) and backslashes (`\`) in paths appended to baseUrl prior to WHATWG URL construction.
**Learning:** Node's WHATWG URL implementation normalizes backslashes (`\`) to forward slashes (`/`) and decodes percent-encoded dots (such as `%2e%2e`) to standard dot segments during parsing/URL construction. If path-traversal checks only validate the raw string, they can be bypassed by percent-encoding dots or using backslashes, leading to server-side request forgery (SSRF) and path traversal.
**Prevention:** To safely prevent path traversal and SSRF when appending paths to a baseUrl, decode the path via `decodeURIComponent` first, and explicitly check both the raw and decoded values for `..` and `\`.
