## 2025-05-18 - Cost Guard Path Normalization

**Vulnerability:** Input paths with query string parameters (`/servers?foo=bar`), URL fragments, or missing leading slashes bypassed `classifyCost` regex checks, allowing unconfirmed creation of billed Hetzner resources.

**Learning:** `classifyCost` matched against raw input paths without stripping query strings or hash fragments or ensuring a leading slash, causing regex boundaries (`$`) to fail on paths like `/servers?option=true`.

**Prevention:** Always normalize input paths to strip query strings (`?...`), hash fragments (`#...`), and ensure a leading slash before matching against cost classification regexes.
