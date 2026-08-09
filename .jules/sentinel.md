# Sentinel Security Journal

## 2026-06-07 - Path Traversal & SSRF Bypass via WHATWG URL Normalization and URL Percent Encoding
**Vulnerability:** In Node's WHATWG URL parser, backslashes (`\`) are normalized to forward slashes (`/`), and percent-encoded dots (such as `%2e%2e` or `%2E%2E`) are resolved to dot-dot segments during parsing. When only raw path strings are checked for `..`, an attacker can bypass the path traversal check by using backslashes or percent encoding, resulting in path traversal or SSRF on the destination server.
**Learning:** Checking relative paths for substrings like `..` without first decoding and normalizing them is insufficient. Node's WHATWG URL parser performs normalizations (decoding percent-encoded dots and converting backslashes) after the check, which leads to path traversal.
**Prevention:** Always decode paths using `decodeURIComponent` (catching and rejecting any malformed percent encoding) and explicitly reject both `..` and `\` characters in both the raw and decoded inputs before constructing a WHATWG URL.
