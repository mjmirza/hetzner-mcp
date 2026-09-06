## 2026-06-07 - Cost Classification Path Normalization

**Vulnerability:** Input paths with query strings or hash fragments bypassed the cost guard because regex matching expected anchored resource paths.

**Learning:** When regexes use start and end anchors to match API collection paths, raw request parameters or URL fragments prevent matching unless stripped beforehand.

**Prevention:** Always normalize request paths by stripping query parameters and hash fragments and ensuring a leading slash before matching against billing regexes.
