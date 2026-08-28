## 2026-08-28 - Percent-Encoded and Backslash Path Traversal in WHATWG URL Parsing

**Vulnerability:** API paths validated prior to URL parsing were vulnerable to path traversal and SSRF bypass when percent-encoded (e.g., `%2e%2e`) or using backslashes (`\`). `normalizePath` checked for `..` on the raw input before `new URL(base + path)` normalized backslashes and resolved percent-encoded dot segments.

**Learning:** Checking for path traversal markers (`..`) on raw input strings before URL resolution fails because standard `URL` constructors (like Node's WHATWG `URL`) perform normalizations (such as treating backslashes as path separators and resolving decoded dot segments) after input string checks pass.

**Prevention:** Always decode input strings with `decodeURIComponent` before performing path validation checks, and explicitly validate against both `..` and `\` in the decoded path.
