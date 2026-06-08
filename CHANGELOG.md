# Changelog

All notable changes to hetzner-mcp are documented here. The format is based on Keep a
Changelog, and this project follows semantic versioning.

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
