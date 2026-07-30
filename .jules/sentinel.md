# Sentinel Journal - Security Learnings

## 2026-07-30 - Path Traversal and SSRF via URL Normalization
**Vulnerability:** In Node's WHATWG URL implementation, backslashes `\` are normalized to `/` and percent-encoded dots (such as `%2e%2e`) are resolved to dot-dot (`..`) segments during URL parsing. When the path is checked before URL normalization without URI-decoding or checking for backslashes, a path traversal / SSRF vulnerability can occur, bypassing relative path checks.
**Learning:** Checking for `..` on a raw relative path string is insufficient if the string is later appended to a base URL and parsed as a URL object. Node's URL implementation treats backslashes and percent-encoded characters specially during parsing, resolving them to dot-dot segments and path separators, which allows escaping the intended base path.
**Prevention:** Always decode URI components (`decodeURIComponent`) and explicitly reject `..` and `\` before appending relative paths to a base URL. Reject any malformed percent encodings to prevent decoding bypasses.
