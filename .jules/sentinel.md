## 2026-06-08 - Path Normalization in Cost Guard

**Vulnerability:** Cost guard regex checks in `classifyCost` could be bypassed by appending query parameters (e.g. `POST /servers?foo=bar`) or omitting leading slashes (`POST servers`), causing billed operations to be misclassified as unbilled.

**Learning:** Regexes matching full path string endpoints (like `/^\/servers\/?$/i`) will fail to match if query parameters or hash fragments are present in the path string passed to `classifyCost`.

**Prevention:** Always normalize and strip query parameters and hash fragments from paths before performing exact or regex pattern matching for security or cost guards.
