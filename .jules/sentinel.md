## 2026-08-30 - Normalize paths in cost classification

**Vulnerability:** Unnormalized input paths with query strings, hash fragments, or missing leading slashes bypassed regex matching in cost classification, allowing billed operations to run without confirmation.

**Learning:** Regex checks with end-of-string anchors ($) fail when query parameters or hash fragments are present in the path string unless stripped prior to matching.

**Prevention:** Always normalize and strip query strings and hash fragments from request paths before matching against security or cost guard rules.
