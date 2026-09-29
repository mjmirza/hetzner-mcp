## 2026-06-07 - Cost guard path normalization

**Vulnerability:** Paths containing query parameters or hash fragments bypassed cost-guard regexes in classifyCost.

**Learning:** Unsanitized paths like /servers?foo=bar failed exact regex matches like /^\/servers\/?$/i, allowing unconfirmed creation of billed resources.

**Prevention:** Always strip query parameters, hash fragments, and ensure a leading slash before matching paths against security or cost classification regexes.
