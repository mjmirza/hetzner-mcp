# Sentinel Security Journal

## 2026-06-07 - WHATWG URL Path Traversal and SSRF via Percent-Encoded Dots and Backslashes
**Vulnerability:** Node's WHATWG URL parser automatically normalizes backslashes (`\`) to forward slashes (`/`) and processes percent-encoded dots (such as `%2e%2e` or `%2E%2E`) into parent directory segments (`..`). This allows attackers to bypass naive path controls that only look for raw `..` substring patterns.
**Learning:** Path traversal blocklists that inspect input strings before they are processed by a standard URL constructor fail to catch encoded dots and backslashes because the WHATWG URL parser decodes and normalizes them during URL construction.
**Prevention:** Always decode potential path components with `decodeURIComponent` and check for both `..` and `\` explicitly, or reject any malformed encoding before URL parsing or resource access.
