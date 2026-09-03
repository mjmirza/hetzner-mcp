## 2026-08-30 - Cost Guard Path Normalization

**Vulnerability:** Paths passed to cost guard (`classifyCost`) with query parameters (`/servers?foo=bar`), hash fragments (`/servers#hash`), or missing leading slashes (`servers`) failed exact regex matching against `BILLED_CREATE` and `BILLED_ACTIONS`, returning `billed: false` and bypassing cost checks.

**Learning:** Input paths must be stripped of query parameters and hash fragments and normalized with a leading slash before matching against cost classification patterns.

**Prevention:** Always normalize and strip query/hash components from paths when evaluating security or authorization guards prior to routing or request execution.
