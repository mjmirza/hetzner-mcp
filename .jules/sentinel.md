## 2026-06-07 - WHATWG URL Path Normalization & Percent Encoding Bypass
**Vulnerability:** Input paths containing percent-encoded dot segments (`%2e%2e`) or backslashes (`\`) bypassed simple `string.includes("..")` checks in `normalizePath`. When passed to Node's WHATWG `URL` constructor, these sequences were resolved as path traversals.
**Learning:** Node's WHATWG `URL` parser automatically resolves percent-encoded dots (`%2e%2e`) to `..` and normalizes backslashes (`\`) to `/` during URL resolution.
**Prevention:** Always decode paths using `decodeURIComponent` before checking for path traversal (`..`), backslashes (`\`), or URL schemes, and safely handle invalid percent-encoding exceptions.
