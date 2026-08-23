## 2026-08-23 - URL Path Normalization Traversal in WHATWG URL

**Vulnerability:**
`normalizePath` previously checked for `..` in the raw string, but missed percent-encoded representations (such as `%2e%2e` or `%2E%2E`) and backslashes (`\`). When appended to base API URLs using `new URL(base + path)`, Node's WHATWG `URL` parser automatically decodes `%2e%2e` and normalizes backslashes to slashes, resolving path segments and bypassing the `/v1` base API scope (SSRF / path traversal).

**Learning:**
String matching against `..` on raw path input is insufficient when the string will be processed by a URL parser or server that decodes percent-encoding or normalizes path separators.

**Prevention:**
Always decode input paths via `decodeURIComponent` (handling URIErrors) and explicitly check both raw and decoded inputs for `..` and `\` before passing them to `new URL()` or downstream request methods.
