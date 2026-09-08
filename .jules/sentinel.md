## 2026-09-08 - Path Normalization in Cost Guard

**Vulnerability:** Paths with query strings, hash fragments, or missing leading slashes (e.g., `/servers?foo=bar`) bypassed the cost guard regex checks, allowing billed creation requests to proceed without requiring confirmation or enforcing billed creation restrictions.

**Learning:** URL paths passed to cost classification functions can contain query parameters or fragments that fail exact regex matches anchored with `$`.

**Prevention:** Always normalize URL paths by stripping `?` query strings and `#` hash fragments and ensuring a leading `/` before matching against cost-guard or security regexes.
