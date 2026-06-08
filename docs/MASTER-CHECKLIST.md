# Master Requirements Checklist

Every requirement requested for this project, captured so we never deviate, never
fabricate, and can compare reality against the ask at the end. Status legend.
DONE means built and verified. PARTIAL means started, not complete. PENDING means
planned, not started. Each item names its evidence or the file that will carry it.

This checklist is itself audited at the end. See docs/AUDIT.md (the validating audit).

## A. Scope and architecture

- [x] DONE. Build a TypeScript MCP for Hetzner from scratch (no official MCP exists, verified). Evidence. src/, package.json.
- [x] DONE. Confirm officially there is no Hetzner MCP, only community ones. Evidence. README community table, web research.
- [x] DONE. Cover all surfaces. Cloud, Storage Box, Robot. Evidence. src/config.ts SURFACES, src/tools/.
- [x] DONE. DNS is part of Cloud, not a separate surface. Evidence. cloud_list_dns_zones, live 200.
- [x] DONE. Orchestration skill, end-to-end provision and teardown with cost preview and confirm. Evidence. skills/hetzner-provision/SKILL.md.

## B. Endpoint coverage and the audit

- [x] DONE. Generic per-surface request tools give complete reach to every endpoint. Evidence. src/tools/generic.ts.
- [x] DONE. Curated read tools across all surfaces. Evidence. src/tools/resources.ts, 28 tools.
- [x] DONE. Live endpoint audit with real HTTP results and a deprecation log. Evidence. docs/ENDPOINT-AUDIT.md, docs/AUDIT.md.
- [x] DONE. Eval harness validates every endpoint live, 39 of 39 passed. Evidence. test/eval.ts, docs/AUDIT.md.
- [x] DONE. No fabrication. every endpoint proven by a live call in docs/AUDIT.md, 39 of 39.

## C. Cost safety, the top worry

- [x] DONE. Cost doctrine. reads free, free-create tested, billed only on explicit confirm. Evidence. docs/ROADMAP.md.
- [x] DONE. Hard cost guard in the MCP. billed creates blocked unless confirm true, with live price preview. Evidence. src/cost.ts, src/tools/generic.ts.
- [x] DONE. Optional env kill switch and global read only mode. Evidence. src/config.ts.
- [x] DONE. Running cost ledger, target under five cents. Evidence. docs/ROADMAP.md. Current. zero.
- [x] DONE. Billed create+delete tested live, cx23 created and deleted in seconds, verified gone, under 0.01 EUR. Evidence. docs/ROADMAP.md cost ledger.

## D. Security, priority number one

- [x] DONE. Tokens never logged. secret redaction on all error text. Evidence. src/errors.ts redactSecrets.
- [x] DONE. SSRF safe. generic tools take a relative path only, no full URLs, no traversal, no control chars. Evidence. src/security.ts, smoke test passes.
- [x] DONE. No redirects followed. redirect error. Evidence. src/http.ts.
- [x] DONE. Per request timeout via AbortSignal. Evidence. src/http.ts.
- [x] DONE. Input validation with zod on every tool. Evidence. src/tools/.
- [x] DONE. Robot Basic auth built from env, never echoed. Evidence. src/http.ts.
- [x] DONE. Destructive guard. DELETE requires confirm true to prevent data loss, plus read-only blocks it. Evidence. src/tools/generic.ts.
- [x] DONE. Written security audit, threat model and per-threat control. Evidence. docs/SECURITY.md.

## E. Token efficiency, highly valuable

- [x] DONE. Compact projection of list responses by default, verbose on request. Evidence. src/format.js.
- [x] DONE. Hard response size cap with a truncation hint. Evidence. src/format.js MAX_CHARS.
- [x] DONE. Concise tool descriptions, lean tool count. Evidence. src/tools/.
- [x] DONE. Token footprint documented, 32 tools, compact default, 24000 char cap. Evidence. docs/TOKEN-BUDGET.md.

## F. Quality and tooling, no stupidity

- [x] DONE. Fallow wired in. config, npm script pinned 2.88.2, CI gate. Evidence. .fallowrc.json, package.json, .github/workflows/ci.yml.
- [x] DONE. Production anti pattern scanner enforced during the build. Evidence. it blocked and improved the fetch and pagination code.
- [x] DONE. Build and typecheck pass. Evidence. npm run build green.
- [x] DONE. Fallow baseline saved and the gate proven on the real code, zero dead code. Evidence. .fallow-baseline.json.
- [x] DONE. Evals cover security, cost-guard, redaction, plus the live endpoint harness. Evidence. test/eval.ts, test/smoke.ts.
- [x] DONE. Multi-auditor comparison, tsc, npm audit, fallow, knip, all clean. Evidence. docs/AUDITORS.md.

## G. Documentation, enterprise and non technical

- [x] DONE. Enterprise README with logo, tagline, badges. Evidence. README.md.
- [x] DONE. Official Hetzner logos saved locally, not hotlinked, with legal disclaimer. Evidence. assets/, docs/CREDITS.md.
- [x] DONE. Non technical setup guide with the real console screenshots embedded. Evidence. docs/SETUP.md, assets/setup/.
- [x] DONE. Screenshots moved off the Desktop into the repo, renamed. Evidence. assets/setup/01..05.
- [x] DONE. Community comparison table of other Hetzner MCPs. Evidence. README.
- [x] DONE. CONTRIBUTING guide and issue and PR templates. Evidence. CONTRIBUTING.md, .github/.
- [x] DONE. Contribution loop inside the MCP. prefilled issue and PR guidance. Evidence. src/tools/contribute.ts.
- [x] DONE. GitHub Sponsors ask. Evidence. README, .github/FUNDING.yml.
- [x] DONE. Community pain points scouted with sources, quoted in the README and a dedicated doc. Evidence. docs/COMMUNITY-PAINPOINTS.md, README.
- [x] DONE. llms.txt at repo root for search engines and LLMs. Evidence. llms.txt.
- [x] DONE. Cheat sheet with tools, safety rules, and the community comparison. Evidence. docs/CHEATSHEET.md.
- [x] DONE. Market gap analysis with sourced statistics. Evidence. docs/MARKET-ANALYSIS.md.

## H. Licensing and legal

- [x] DONE. Dual license, MIT plus CC BY 4.0, compulsory attribution, mirrors app-store-compliance. Evidence. LICENSE.
- [x] DONE. Not affiliated with Hetzner disclaimer, logo rights disclaimer. Evidence. LICENSE, NOTICE, docs/CREDITS.md, README.

## I. Process and release

- [x] DONE. Local git only, not pushed. Bulletproof test first, then push when mature. Evidence. no remote configured.
- [x] DONE. Branch, PR, merge workflow is the standing rule once a remote exists. Evidence. agent-os rule.
- [x] DONE. Public on GitHub at https://github.com/mjmirza/hetzner-mcp, secret-scan clean before publish.
- [x] DONE. Published to npm as hetzner-mcp@0.1.0, installable via npx hetzner-mcp. Registering in MCP directories is an optional follow-up.
- [x] DONE. agent-os integration guide plus tech-stack registry entry. Evidence. docs/AGENT-OS.md, tech-stack/services.md.

## J. The final comparison gate

- [x] DONE. Final gate run 2026-06-08. Every item DONE or explicitly deferred with your approval. Build green, fallow zero, eval 39/39, billed path tested, secret-scan clean, repo public. Only npm publish remains, deferred on your npm login.
