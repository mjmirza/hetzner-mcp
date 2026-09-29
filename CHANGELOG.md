# Changelog

All notable changes to hetzner-mcp are documented here. The format is based on Keep a
Changelog, and this project follows semantic versioning.

## [Unreleased]

### Changed
- A map page opened without its access key, or with the key of an earlier run, now asks for the
  key. Paste the link the map printed (or just the key) and the map opens. Before, the page
  showed a message and a Try again button that could not help.

## [0.6.0] - 2026-09-29

### Added
- Automatic audit. Every map build scores the estate out of 100 with findings for security,
  cost, reliability, and hygiene. Each finding has what, why, numbered Hetzner Console steps,
  the sentence to ask your AI, and the monthly saving. Before, the map listed flags with a
  one-line note and no steps. Available as the Audit tab, `hetzner-mcp audit` (with `--out`,
  `--json`, `--fail-on`), the `infra_audit` tool, and a first audit at the end of setup.
- Plain names for codes. Locations read "Falkenstein, Germany" instead of "fsn1", server
  cards show vCPU, RAM and disk, and the side panel explains every code.
- One Reset that puts every card back, shows hidden items, clears focus and selection, and
  refits the map. Before, Tidy up only undid drags and stayed greyed out until you dragged.
- Optional Flow mode that animates dots along every line. Off when Reduce motion is on.
- `HETZNER_MCP_TOOLS=lean` skips the 27 list shortcuts, cutting the tool list from about
  9,400 to 5,900 tokens.
- Workspaces. Previously every saved project sat in one flat list and the map read all of them at once. Now a project can belong to a workspace (one per client), the map reads only the active workspace, 4 projects at a time, and one bad token only marks its own project unreadable. With no workspace set, everything lands in Personal, so existing setups see no change.
- `GET /api/workspaces` returns names with account and project counts, never tokens. `GET /api/graph?workspace=<name>` maps one workspace and answers 400 for an unknown name.
- `hetzner-mcp projects import <file> [--verify]`, `projects list`, `projects remove`. Bulk import from CSV or JSON, one atomic owner-only write, duplicates and bad rows reported by row number, tokens shown only as their last 4 characters.
- `infra_map` takes an optional `target`, a workspace or `workspace/account/project`, so an assistant can map one client without loading every account.

### Security
- The map URL now carries a per-launch key (`http://127.0.0.1:PORT/#k=<key>`). Before, any
  local process could call the map API by sending a fixed header value. Now every API call
  needs the key from that launch, compared in constant time. Slow clients are cut off after
  15 seconds.
- The sample map (`--demo`) no longer shows the names of your real workspace, accounts, or
  projects. Before, its project list and workspace name came from your real setup.
- `setup --print` shows placeholders instead of real credentials. Add `--print-secrets` to
  include them. New `--token-stdin` for `setup` and `doctor`; `--token` still works but warns
  that other local users can see it. The token and Robot password prompts no longer echo.
- Setup writes an absolute launch command (this Node and this copy's `dist/index.js`), so a
  `node_modules/hetzner-mcp` inside a project can never be started with your token. From an
  npx cache it writes `npx -y hetzner-mcp@<exact version>`.
- Setup refuses a client config or `.bak` path that is a symbolic link, keeps an existing
  backup under a timestamped name, writes the new backup owner-only, and uses an unguessable
  temp file. Writing the VS Code config warns that it sits in the project and checks
  `.gitignore`.
- `map --open` starts the system opener by absolute path, and a missing opener no longer
  crashes the map.
- The project store ignores a relative `XDG_CONFIG_HOME`, tightens a loose directory it owns
  and refuses one owned by someone else, ignores a `projects.json` others can write, moves an
  unreadable one aside to `projects.json.corrupt-<time>` instead of overwriting its tokens,
  uses an unguessable temp file, and takes over a lock whose owning process has exited.
- A `projects.json` that other users can read is now made owner-only (0600) the moment it is
  read, with a one-time note. Before, a readable file was used as is.
- Setup refuses to write a client config through a linked folder, such as a `.vscode` link in
  a cloned project. Before, the config and its token landed wherever the link pointed.

### Changed
- Large estates stay responsive. At most 16 Hetzner requests run at once (4 per token), `infra_map` and `infra_audit` reuse one read for a minute (`refresh: true` reads again, any change drops it), and a list cut short by the page limit now says so instead of silently dropping resources. Before, 50 parallel maps put 2,200 requests in flight and every audit page re-read the whole estate.
- The map opens large estates (over 400 resources) with projects folded, draws only the cards on screen, and lays out big trees in the background, so the first view went from a 12 second freeze to about 0.3 seconds. Live status polls no longer stack up, time out after 30 to 45 seconds with a clear message, and large projects are polled less often and say so.
- List view is now a flat list grouped by project, most urgent first, with plain status words
  and filters. Before, it was a nested tree that was hard to scan.
- Compact responses collapse nested objects to their name and drop empty fields, and no JSON
  is indented. Measured live: server types 49% smaller, locations 47%, images 40%.
- Read tools use shorter descriptions, and the Mermaid diagram and full audit are bounded.
- Cards grow to fit their content and the layout uses their real height, so text never spills
  and cards never overlap. Line labels that sat on top of cards are gone; the card text says it.
- On phones, layout, Flow, Refresh, Reset and dark mode sit in a More menu so the header never
  runs off screen.

### Fixed
- With many clients, prices now load from the first working token instead of giving up after
  three, so revoked tokens at the top of the list no longer mark every project unreadable.
- Adding a project from the map saves it into the workspace you are viewing, not the default.
- A slow map read that finished after a change no longer puts old data back into the cache.
- Two imports at the same time can no longer drop each other's projects (a lock around the store).
- Short or malformed saved tokens are fully hidden in `projects list`.
- Names with a pipe or a line break can no longer break the report table or the Mermaid diagram.
- Malformed CSV quoting is rejected with its row number instead of being merged silently.
- IPv6-only servers without a firewall, and firewall rules on port "any", are now flagged.
- Header text such as "Updated 10 min ago" wrapped onto three lines at medium widths.
- The location card showed its code twice.
- A change made with an MCP tool now shows on an open map straight away. Before, the map kept
  showing the old graph for up to a minute, and a large project's live status for up to 15.
- The project store lock is never taken from a process on this computer that is still running,
  and finishing a write never removes a lock someone else now holds.
- An answer too large to read is closed at once instead of leaving its connection open.
- When the browser blocks storage, the map link keeps its key, so a reload still works.

### Tests
- `test/layout.ts`, a browser gate in CI across 12 screen sizes and every view, that fails on
  wrapped header text, content spilling out of a card, overlapping cards, and a Reset that
  does not restore the layout.
- `test/audit.ts` and `test/token-budget.ts`, the latter failing when the tool list or the
  common answers grow past their budget.

## [0.5.0] - 2026-09-29

Thanks to Kevin Laurier (@caoimhin07) for the independent safety audit in #91, whose fixes
are included here, and to @jooola for reporting #83 and #84.

### Security
- Cost guard now matches Hetzner's real `enable_backup` action (singular). The previous
  `enable_backups` typo let backup enables bypass the spend confirm. Plural form is still
  matched defensively.
- `HETZNER_MCP_ALLOW_BILLED` is now opt-in (`=== "1"`). Unset no longer allows billed
  creates; this matches `.env.example` and blocks unattended spend after install.
- Destructive guard extended beyond DELETE: `poweroff`, `shutdown`, `reboot`, `reset`,
  `rebuild`, `reset_password`, and `enable_rescue` require `confirm: true`.
- Cost/destructive classifiers strip query and hash fragments before matching so
  `?x=1` cannot bypass a guard regex.

- Guard paths are canonicalized before matching (percent-decoding, repeated and trailing
  slashes, case), so no spelling of a billed endpoint skips the cost guard. Reported by
  the Sentinel scanner.

### Added
- `hetzner-mcp map`, an interactive map of every configured account, project, and
  resource with estimated monthly cost, top cost drivers, and idle resources still being
  billed. Local on http://127.0.0.1:43390, with a labelled `--demo` estate. Built with
  React Flow and an automatic layout that switches between rows and columns, so no line
  crosses a card. Hierarchy, Connections, and List views, drag with remembered positions,
  project counts and costs in the side panel, and plain-language links on every card.
- Create and delete from the map. Price first from the Hetzner pricing API, billed creates
  only with `HETZNER_MCP_ALLOW_BILLED=1` plus a stated-amount checkbox, deletes need the
  exact name. Same guards as the MCP tools, re-checked on the server for every request.
- Connect another project from the map. The token is verified live, then saved in
  `~/.config/hetzner-mcp/projects.json` with owner-only permissions, never sent to the page.
- `infra_map` MCP tool returning the cost summary, findings, the canvas URL, and an
  optional Mermaid diagram. Multiple projects via `HETZNER_CLOUD_TOKEN_<NAME>`.
- `test/safety-guards.ts`, `test/actions.ts`, and `test/map.ts` offline suites, wired into
  `npm run test:offline`.

- `find_capacity` tool. Which server types can be ordered right now, where, and at what
  price, recommended first, with retirement dates. Avoids `resource_unavailable` on create.
- `cloud_list_network_members` tool for the new `/networks/{id}/members` endpoint.
- Map findings grouped into risks, money you can save, and good to know. New checks for
  retiring server types, the backup surcharge, snapshots older than 90 days, outgoing
  traffic projected past the allowance, servers with no firewall, firewalls opening SSH or
  database ports to the internet, and certificates close to expiry.
- `cloud_delete_server` now lists what keeps billing after the delete (IPs without auto
  delete, attached volumes, snapshots) and warns that automatic backups are lost.
- `hetzner-mcp setup` asks whether to allow paid resources and writes
  `HETZNER_MCP_ALLOW_BILLED`, with `--allow-billed` and `--no-billed` flags.

### Fixed
- Servers and primary IPs are placed and priced by the new `location` field. Hetzner
  removed `datacenter` from both on 2026-07-01.
- Cost guard covers the Storage Box plan change (`change_type`). Confirm is now required
  for `disable_backup` (deletes backups), Storage Box `rollback_snapshot`,
  `disable_snapshot_plan`, `update_access_settings`, `reset_subaccount_password`,
  `change_home_directory`, DNS `import_zonefile`, `set_records`, `remove_records`,
  record-set PUT, `change_primary_nameservers`, network and load balancer removals, and
  turning protection off.
- Security. Bumped the MCP SDK to 1.31.0 and resolved a high severity `fast-uri` advisory.
- Guards now resolve `.` and `..` path segments exactly as the request does, and the
  request layer refuses `.` segments outright, so `/./servers` cannot skip the cost guard
  and `/servers/1/actions/./rebuild` cannot skip the confirm. Found in an adversarial
  review by a second model before release.
- Detaching a volume and unassigning a floating or primary IP now need confirm, and the
  three curated tools accept it. A server delete whose action is still running is
  reported as still running, not as done. The action wait is capped at 10 minutes.
- The infra map API only answers requests from its own page, so another website cannot
  make it call the Hetzner API on your behalf.
- README source install passes the token on the command line. The old steps copied a
  `.env` file that nothing reads.
- `setup --print --allow-billed` now includes `HETZNER_MCP_ALLOW_BILLED=1` in the printed
  config. Action status from a write comes back as its own content block, so the first
  block stays plain JSON for scripts that parse it.
- README explains how to install the `@mjmirza/hetzner-mcp` copy from GitHub Packages. The
  command on GitHub's package page fails as pasted, because GitHub requires a login.
- New `test/cli.ts` runs every documented command against the built package in CI.
- Requests now send a `hetzner-mcp/<version>` User-Agent (#83).
- Writes wait for their Hetzner actions to finish and report failures, bounded by
  `HETZNER_MCP_ACTION_WAIT_MS` (default 120000, 0 disables) (#84).

### Changed
- Breaking. Billed creation now requires `HETZNER_MCP_ALLOW_BILLED=1`, matching what
  `.env.example` already documented.
- Removed `cloud_list_datacenters`. Hetzner returns HTTP 410 for `/datacenters` from
  2026-10-01. Use `cloud_list_locations` or `find_capacity`.
- Removed `robot_list_storageboxes`. Hetzner retired the Robot storage box API on
  2025-07-30. Use `storagebox_list`.

## [0.4.0] - 2026-08-30

### Added
- 24 curated, guarded write tools for the common cloud resources. create, delete,
  attach, detach, and assign for volumes, networks, firewalls, load balancers,
  floating and primary IPs, SSH keys, and placement groups. Every billed create
  needs confirm, every delete needs confirm, and DELETE is auto-treated as
  destructive so no tool can forget the guard.
- test/api-shape.ts, a hallucination check that pins every write-tool request
  field to the official Hetzner OpenAPI spec, wired into CI.
- Also publish to GitHub Packages as the scoped mirror @mjmirza/hetzner-mcp.

### Fixed
- primary IP create now uses the official location field, not the removed
  datacenter field, caught by validating against the official spec.

## [0.3.2] - 2026-08-30

### Changed
- Friendlier onboarding. The `setup` and `doctor` commands now speak plain
  language for a first-time user, with numbered next steps, a clear success
  screen, and the technical backup note demoted to a reassuring footer.
- Added dependency-free terminal color to `setup` and `doctor`. It renders in a
  real terminal and goes fully plain when output is piped or NO_COLOR is set, so
  logs and CI stay clean. No new runtime dependency.

## [0.3.1] - 2026-08-30

### Security
- normalizePath now unescapes a path once and rejects `..` and backslash in the
  unescaped form, so a percent-encoded traversal like `%2e%2e` cannot slip past
  the literal checks. Defense in depth. the surface base URL fixes the host, so
  this hardens caller intent rather than closing a live exploit.
- Patched transitive dependency advisories via npm audit fix. npm audit is back
  to 0 vulnerabilities in both the production and full trees. No production
  dependency changed (the tree is only the MCP SDK and zod).

### Changed
- Re-validated every surface against the live Hetzner API changelog on
  2026-08-30. The server is still valid. See docs/ENDPOINT-AUDIT.md for the
  delta since the 2026-06-07 sweep (Data Center endpoint sunset after Oct 1,
  reverse-DNS dns_ptr and RRSet TTL now required, unassign-before-delete for
  assigned IPs). All are caller-side or additive, no curated tool is affected.

### Fixed
- README license badge and two prose spots corrected from a stale MIT plus
  CC BY 4.0 description to the OpenRoots ORA 2.3 license the repository
  actually carries in LICENSE.

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
