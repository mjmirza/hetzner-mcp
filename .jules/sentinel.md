# Sentinel's Journal - Critical Learnings

## 2026-06-07 - URL Parsing Path Traversal Bypass via WHATWG URL Normalization
**Vulnerability:** In Node's WHATWG URL implementation, backslashes `\` are normalized to `/` and percent-encoded dots (like `%2e%2e`) are resolved to dot-dot segments during parsing. A path input validator that only checks for the raw string containing `..` or `\` without first decoding percent-encoded characters or using WHATWG URL logic can be bypassed by using `%2e%2e` or backslashes `\`.
**Learning:** Checking relative API paths for raw patterns like `..` is insufficient to prevent path traversal if the path is later appended to a base URL string and parsed by the WHATWG `URL` constructor (which is the default in Node.js and modern browsers). The constructor resolves percent-encoded characters and normalizes backslashes to forward slashes.
**Prevention:** To prevent this, the input path should first be decoded using `decodeURIComponent` (handling any potential URI malformation errors safely) and then checked for both `..` and `\` to ensure traversal is blocked before constructing the final URL.
