## 2026-06-07 - URL Parsing Bypasses in Path Traversal Validation
**Vulnerability:** Path Traversal and SSRF through percent-encoded dot-dot (`%2e%2e`) and backslashes (`\`) on WHATWG URL parsing.
**Learning:** In Node's WHATWG URL implementation, backslashes are normalized to forward slashes `/`, and percent-encoded dot-dot (`%2e%2e`) sequences are decoded and resolved during parsing. This means simple substring checks (like `path.includes("..")`) on raw path strings can be bypassed to trigger path traversal or point to admin/unintended routes.
**Prevention:** To safely block path traversal, decode the target path first using `decodeURIComponent` and explicitly check for both `..` and `\` in the decoded representation before passing it to any URL-parsing construct.
