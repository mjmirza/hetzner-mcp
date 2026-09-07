## 2026-06-07 - Normalize Paths in Cost Classification

**Vulnerability:** Unnormalized paths containing query strings (`/servers?foo=bar`), hash fragments (`/servers#hash`), or missing leading slashes (`servers`) failed to match strict billing regexes in `classifyCost`, bypassing the cost guard during write requests.

**Learning:** When matching API endpoint paths against billing or authorization regexes, input paths must be normalized to strip query parameters (`?...`) and hash fragments (`#...`) and ensure a leading slash before evaluation.

**Prevention:** Always strip query parameters and hash fragments and normalize path prefixes before performing regex classification on request paths.
