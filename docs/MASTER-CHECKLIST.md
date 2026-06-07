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
- [ ] PENDING. Orchestration skill that spins up a full stack end to end with teardown. File. skills/hetzner-provision/SKILL.md.

## B. Endpoint coverage and the audit

- [x] DONE. Generic per-surface request tools give complete reach to every endpoint. Evidence. src/tools/generic.ts.
- [x] DONE. Curated read tools across all surfaces. Evidence. src/tools/resources.ts, 28 tools.
- [x] PARTIAL. Live endpoint audit with real HTTP results and a deprecation log. Evidence. docs/ENDPOINT-AUDIT.md. Pending. exhaustive per-endpoint write coverage.
- [ ] PENDING. Eval harness that validates literally every endpoint live and records pass or fail, run before publish. File. test/eval.ts, docs/AUDIT.md.
- [ ] PENDING. No fabrication. every endpoint claimed is proven by a live call. Enforced by the eval harness.

## C. Cost safety, the top worry

- [x] DONE. Cost doctrine. reads free, free-create tested, billed only on explicit confirm. Evidence. docs/ROADMAP.md.
- [x] DONE. Hard cost guard in the MCP. billed creates blocked unless confirm true, with live price preview. Evidence. src/cost.ts, src/tools/generic.ts.
- [x] DONE. Optional env kill switch and global read only mode. Evidence. src/config.ts.
- [x] DONE. Running cost ledger, target under five cents. Evidence. docs/ROADMAP.md. Current. zero.
- [ ] PARTIAL. Live test of one billed create plus immediate delete, on explicit go only. Pending your go.

## D. Security, priority number one

- [x] DONE. Tokens never logged. secret redaction on all error text. Evidence. src/errors.ts redactSecrets.
- [x] DONE. SSRF safe. generic tools take a relative path only, no full URLs, no traversal, no control chars. Evidence. src/security.ts, smoke test passes.
- [x] DONE. No redirects followed. redirect error. Evidence. src/http.ts.
- [x] DONE. Per request timeout via AbortSignal. Evidence. src/http.ts.
- [x] DONE. Input validation with zod on every tool. Evidence. src/tools/.
- [x] DONE. Robot Basic auth built from env, never echoed. Evidence. src/http.ts.
- [x] DONE. Destructive guard. DELETE requires confirm true to prevent data loss, plus read-only blocks it. Evidence. src/tools/generic.ts.
- [ ] PENDING. A written security audit document covering the threat model and each control. File. docs/SECURITY.md.

## E. Token efficiency, highly valuable

- [x] DONE. Compact projection of list responses by default, verbose on request. Evidence. src/format.js.
- [x] DONE. Hard response size cap with a truncation hint. Evidence. src/format.js MAX_CHARS.
- [x] DONE. Concise tool descriptions, lean tool count. Evidence. src/tools/.
- [ ] PENDING. Measure and document the token footprint of the tool list and typical responses. File. docs/TOKEN-BUDGET.md.

## F. Quality and tooling, no stupidity

- [x] DONE. Fallow wired in. config, npm script pinned 2.88.2, CI gate. Evidence. .fallowrc.json, package.json, .github/workflows/ci.yml.
- [x] DONE. Production anti pattern scanner enforced during the build. Evidence. it blocked and improved the fetch and pagination code.
- [x] DONE. Build and typecheck pass. Evidence. npm run build green.
- [x] DONE. Fallow baseline saved and the gate proven on the real code, zero dead code. Evidence. .fallow-baseline.json.
- [ ] PENDING. Evals on every asset. unit tests for security, cost, format, plus the live eval harness.
- [ ] PENDING. Comparison with multiple auditors. run fallow plus knip plus tsc plus npm audit and record results. File. docs/AUDIT.md.

## G. Documentation, enterprise and non technical

- [x] DONE. Enterprise README with logo, tagline, badges. Evidence. README.md.
- [x] DONE. Official Hetzner logos saved locally, not hotlinked, with legal disclaimer. Evidence. assets/, docs/CREDITS.md.
- [x] DONE. Non technical setup guide with the real console screenshots embedded. Evidence. docs/SETUP.md, assets/setup/.
- [x] DONE. Screenshots moved off the Desktop into the repo, renamed. Evidence. assets/setup/01..05.
- [x] DONE. Community comparison table of other Hetzner MCPs. Evidence. README.
- [x] DONE. CONTRIBUTING guide and issue and PR templates. Evidence. CONTRIBUTING.md, .github/.
- [x] DONE. Contribution loop inside the MCP. prefilled issue and PR guidance. Evidence. src/tools/contribute.ts.
- [x] DONE. GitHub Sponsors ask. Evidence. README, .github/FUNDING.yml.
- [ ] PENDING. Community pain points scouted from Reddit, GitHub issues, forums, quoted in the README for SEO and to solve real problems. File. README, docs/COMMUNITY-PAINPOINTS.md.
- [ ] PENDING. llms.txt so search engines and LLMs can grasp the project. File. llms.txt, public/llms.txt.
- [ ] PENDING. Extensive comparison cheat sheet and checklist, the one we kept raving about, compared at the end. File. docs/CHEATSHEET.md, this file.
- [ ] PENDING. Market gap analysis with statistical data. File. docs/MARKET-ANALYSIS.md.

## H. Licensing and legal

- [x] DONE. Dual license, MIT plus CC BY 4.0, compulsory attribution, mirrors app-store-compliance. Evidence. LICENSE.
- [x] DONE. Not affiliated with Hetzner disclaimer, logo rights disclaimer. Evidence. LICENSE, NOTICE, docs/CREDITS.md, README.

## I. Process and release

- [x] DONE. Local git only, not pushed. Bulletproof test first, then push when mature. Evidence. no remote configured.
- [x] DONE. Branch, PR, merge workflow is the standing rule once a remote exists. Evidence. agent-os rule.
- [ ] PENDING. Make public on GitHub. only after the eval harness is green and no fabrication remains. You have allowed this when mature.
- [ ] PENDING. Publish to npm and register in MCP directories. after public and tested.
- [ ] PENDING. Draft a detailed mutual benefit sponsorship email to Hetzner. draft only, four eyes, you send it. File. docs/outreach/hetzner-sponsorship.md.
- [ ] PENDING. agent-os setup integration so this is part of the wider system. File. agent-os skill or rule entry.

## J. The final comparison gate

- [ ] PENDING. Re run this checklist at the end. every PENDING must become DONE or be explicitly deferred with your approval. No item silently dropped. No claim without evidence.
