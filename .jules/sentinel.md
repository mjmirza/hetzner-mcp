## 2026-06-07 - Cost Guard Path Normalization Bypass

**Vulnerability:** Raw input paths containing query strings, hash fragments, or lacking leading slashes bypassed regex pattern matching in `classifyCost`, allowing write operations to create billed resources without confirmation.

**Learning:** URL pattern matching for cost classification must be decoupled from query parameters and fragments, as HTTP request dispatchers reconcile raw paths into normalized endpoint URLs.

**Prevention:** Always normalize and clean API paths by stripping query strings, fragments, and whitespace, and ensuring leading slashes before performing cost classification or access control checks.
