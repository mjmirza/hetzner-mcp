# Sentinel Journal - Critical Security Learnings

## 2025-02-18 - Path Traversal and SSRF via URL Normalization and Backslashes
**Vulnerability:** The `normalizePath` function validated paths prior to URI decoding and without checking for backslashes (`\`). This allowed path traversal (and potential SSRF) via percent-encoded sequences (such as `%2e%2e`) or backslashes (which are normalized to `/` by Node's WHATWG URL implementation).
**Learning:** In WHATWG URL parsing, percent-encoded dots are decoded, and backslashes are normalized to forward slashes. Path validation must occur on decoded inputs and explicitly reject backslashes to ensure that validation aligns with the parser's behavior.
**Prevention:** Always decode paths using `decodeURIComponent` prior to validation. Reject paths containing `..` or `\` in both their raw and decoded forms, and ensure malformed URI components or control characters are rejected.
