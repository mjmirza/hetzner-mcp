# Sentinel's Journal: Critical Security Learnings Only

## 2026-06-07 - SSRF-safe Path Traversal Validation
**Vulnerability:** Path Traversal (SSRF) via crafted url segments or control characters.
**Learning:** In Node's WHATWG URL implementation, backslashes '\' are normalized to '/' and percent-encoded dots (like '%2e%2e') are resolved to dot-dot segments during parsing. To safely prevent path traversal and SSRF, path validation must decode the path via 'decodeURIComponent' and explicitly check for both '..' and '\'.
**Prevention:** Always decode user-supplied paths and query strings before checking for directory traversal sequences. Rejects paths with full protocol markers, relative-protocol markers, backslashes, and dot-dot (`..`) patterns.
