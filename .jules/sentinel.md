## 2026-06-07 - WHATWG URL Path Normalization Bypass
**Vulnerability:** Simple string inclusion checks for `..` failed to catch percent-encoded dot-dot sequences (like `%2e%2e` or `%2E%2E`) and backslashes (`\`) in relative API paths, allowing path traversal and base URL escape when passed to Node's WHATWG `URL` constructor.
**Learning:** Node's WHATWG URL implementation normalizes percent-encoded dots and backslashes during URL parsing, resolving `%2e%2e` and `\` to dot-dot path segments prior to issuing HTTP requests.
**Prevention:** Always decode paths using `decodeURIComponent` and explicitly reject both `..` and `\` in both raw and decoded forms before passing paths to `new URL()`.
