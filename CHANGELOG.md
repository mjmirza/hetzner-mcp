# Changelog

All notable changes to hetzner-mcp are documented here. The format is based on Keep a
Changelog, and this project follows semantic versioning.

## [0.3.0] - 2026-06-08

### Added
- A guided onboarding wizard, `npx hetzner-mcp setup`. It prompts for your Hetzner API token,
  verifies it live against the Hetzner Cloud API before saving, then detects and writes the
  config for Claude Desktop, Claude Code, Cursor, Windsurf, and VS Code. Existing configs are
  backed up first and merged, never overwritten, and the token is stored with owner only file
  permissions and never printed. Previously the only path was hand editing each client config.
- A `npx hetzner-mcp doctor` command. A read only status board that verifies your token against
  the live API and shows which assistants are wired. It writes nothing.
- `npx hetzner-mcp help` and `version`, and `setup --print` to copy the config block by hand for
  any other MCP client.
- The wizard handles the real human behaviors, an unreachable Hetzner (save now and verify later),
  a cancel partway through (clean exit, nothing written), a corrupt client config (refuses to
  clobber), and a non interactive or CI run (flag driven). An offline unit suite covers the
  config merge, client detection, flag parsing, and token verification.

### Changed
- The MCP server now reports its real package version on startup, and a bare run with no token
  points to `npx hetzner-mcp setup` instead of a raw environment variable hint.
- The README leads with the one command setup, embeds the demo cleanly, and documents exactly
  where the token is stored per assistant.

## [0.2.6] - 2026-06-08

### Changed
- Published with npm provenance from GitHub Actions, so the package is cryptographically
  linked to its source repository and commit, and the README on npm stays current. Adds a
  release-triggered publish workflow with pinned actions and OIDC.

## [0.2.5] - 2026-06-08

### Changed
- Trimmed the validation summary table in the README and the report to the live check
  count, failures, tools, and surfaces.

## [0.2.4] - 2026-06-08

### Fixed
- The cost guard now flags the billed snapshot action `create_image` and the billed volume
  `resize` action, so both require a confirm like any other billed operation. Reported in
  issue #2. Previously a POST to `/servers/{id}/actions/create_image` was not guarded, so a
  snapshot, which Hetzner bills per gigabyte, could be created without a confirm step. Now
  it requires confirm. An offline unit check in the smoke test locks this in.

## [0.2.3] - 2026-06-08

### Added
- A live validation suite, `npm run validate:live`, that drives the compiled server over
  stdio and exercises every tool. Reads on all cloud, Storage Box, and Robot list
  endpoints, the cost and destructive guards, and a create then delete lifecycle for both
  free and billed resources. Every billed resource is removed in a finally block, so a
  failure never leaks a charge.
- An integrated deploy demo, `npm run deploy:demo`, and its teardown, `npm run teardown:demo`.
  The demo builds a private network, firewall, placement group, two cheapest cx23 web nodes
  with cloud-init nginx, and a load balancer with a health checked HTTP service, then proves
  traffic round robins across both backends.
- A validation report at `docs/VALIDATION.md` with the per tool table, diagrams, and the
  exact commands to reproduce the run.

### Changed
- The published package is now lean. Only the runtime JavaScript, the README, and the
  license files ship. Source maps, type declarations, and the docs folder are no longer
  published, taking the package from 53 files to 15, and roughly 134 kB down to 51 kB on disk.
- The hygiene config now tracks every source, test, and script file, so dead code in tests
  is caught too. This surfaced and wired in an existing but orphaned eval suite,
  `npm run eval`.

## [0.2.2] - 2026-06-08

### Fixed
- Write bodies now reach the API from every MCP client. `cloud_request`,
  `storagebox_request`, and `robot_request` typed the `body` parameter as an
  unconstrained `unknown`, which compiles to an empty JSON schema. Some MCP clients,
  including Claude Code, drop properties with an empty schema, so `POST`/`PUT`/`PATCH`
  bodies arrived empty and the Hetzner API rejected them with "A valid JSON document
  is required". `body` is now an object schema, and a JSON string is also accepted and
  parsed, so creating a network, firewall, or load balancer through the generic request
  tool works as documented. Previously write bodies were silently dropped by some
  clients. Now write bodies round-trip reliably regardless of client.

## [0.2.1] - 2026-06-08

### Added
- A FAQ for technical and non-technical readers that answers the real objections. docs/FAQ.md.
- A README section on why to use this rather than build your own or use Terraform.

## [0.2.0] - 2026-06-08

### Added
- Two typed write tools for the most common, highest-risk operations.
  cloud_create_server, billed, with a live price preview and a confirm gate.
  cloud_delete_server, with a destructive confirm gate.
- A use case doc grounded in a real community need, agent-driven ephemeral compute on
  Hetzner, with sources. See docs/USE-CASE.md.

## [0.1.1] - 2026-06-07

### Added
- Global install option, npm install -g hetzner-mcp, alongside npx and from source.
- A paste one prompt setup block in the README for effortless onboarding, a full setup
  prompt plus a one time look variant, so a person or org can wire it in by pasting once.

### Changed
- Cleaned the package description.

## [0.1.0] - 2026-06-07

First public release. There is no official Hetzner MCP, this is the tested community one.

### Added
- MCP server covering all three Hetzner surfaces. Cloud, including DNS zones, plus Storage
  Box and Robot dedicated servers.
- 32 tools. 3 generic per surface request tools for complete coverage, 28 curated read
  tools, and a contribute tool that turns a gap into a prefilled issue or pull request.
- Cost guard. billed creation is blocked unless confirm is true, and the live hourly and
  monthly price is shown first. A destructive guard requires confirm on DELETE. A read only
  mode refuses all writes.
- Security. secret redaction on all error text, SSRF safe relative paths only, no redirects
  followed, a hard request timeout, and zod input validation on every tool.
- Token efficiency. compact list responses by default with a size cap, and a verbose option.
- A live validating eval, 39 of 39 checks passing, every endpoint proven with a real call.
- Full documentation. setup guide with real console screenshots, security model, multi
  auditor comparison, token budget, endpoint audit, cheat sheet, community pain points,
  market analysis, an orchestration skill, and a contribution guide.
- Dual license, MIT for code and CC BY 4.0 for content, attribution required.
