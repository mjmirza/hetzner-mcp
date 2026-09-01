## 2026-03-31 - Cost Guard Path Normalization

**Vulnerability:** Unnormalized API paths containing query parameters, hash fragments, or missing leading slashes bypassed cost classification in `classifyCost`, allowing billed resource creation requests without confirmation.

**Learning:** Route matching regexes anchored with `^` and `$` fail when input paths contain unexpected query strings or URL fragments, even though the underlying HTTP client will still route the request to the endpoint.

**Prevention:** Always normalize input paths (stripping query parameters and hash fragments, and ensuring a leading slash) before performing security route matching or cost classification.
