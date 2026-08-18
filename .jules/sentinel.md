## 2025-05-18 - Percent-Encoded Path Traversal and URL Resolution Bypass in `normalizePath`
**Vulnerability:** API paths with percent-encoded characters (e.g., `%2e%2e` for `..`, `%0a` for control chars, or backslashes `\`) could bypass simple string checks in `normalizePath` before being parsed by `new URL()`.
**Learning:** Node's `new URL()` resolves percent-encoded dots and normalizes backslashes `\` to `/`, allowing callers to perform path traversal or manipulate path resolution if validation occurs only on raw un-decoded strings.
**Prevention:** Always decode paths using `decodeURIComponent` (handling malformed encoding gracefully) and validate both raw and decoded inputs for `..`, `\`, and control characters prior to constructing `URL` objects.
