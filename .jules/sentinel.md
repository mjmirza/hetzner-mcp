# Sentinel Security Journal

## 2026-08-22 - URL Path Traversal via Percent-Encoding Bypass
**Vulnerability:** Path traversal checks in `normalizePath` previously checked raw strings for `..` without URL decoding. Inputs with percent-encoded dots or backslashes (e.g. `%2e%2e` or `%5c`) could bypass raw string validation.
**Learning:** In Node / WHATWG URL parsing, backslashes and percent-encoded dot segments can be normalized and resolved during URL construction.
**Prevention:** Always decode URI components using `decodeURIComponent` (and handle URI malformed errors gracefully) before performing strict path traversal and character validation.
