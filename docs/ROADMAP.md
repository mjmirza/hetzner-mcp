# hetzner-mcp Roadmap and Definition of Done

This is a serious, tested, quality-gated build. Not on the fly. Every endpoint is
tested live against a real account, with cost held at zero or fractions of a cent.
Nothing ships as done until it actually works and is documented.

## Non-negotiable principles

1. Cost safety first. Read endpoints are free and tested exhaustively. Free-to-create
   resources are tested with create plus delete. Billed resources are tested only with a
   single cheapest create plus immediate delete, on explicit go. The MCP ships a hard
   cost-guard so a billed resource can never be created without confirmation.
2. Real testing. Every endpoint records a live HTTP result in docs/ENDPOINT-AUDIT.md.
3. Quality at scale. Fallow is wired in as the dead-code and hygiene gate, multi-layer,
   per the codebase-hygiene doctrine. We grow at their scale, not vibe-code.
4. Full coverage. Every endpoint and its sub-resource variants are inventoried, tested,
   and answered for. A generic per-surface request tool guarantees 100 percent reach,
   curated typed tools cover the common surface with schemas and safety.
5. Documentation for humans. A non-technical README that a first-time user can follow
   end to end, plus contribution and architecture docs.

## Phases

### Phase 0. Foundation (DONE)
- Repo scaffold, package.json, tsconfig, gitignore.
- Live proof. Cloud and Storage Box surfaces tested with the provided token, zero cost.
- Endpoint audit seeded with real tested data.
- Dual license with compulsory attribution (mirrors app-store-compliance).

### Phase 1. Cloud core, read surface (typed tools, all tested FREE)
- Cloud HTTP client (Bearer, pagination, error mapping, rate-limit handling).
- Typed list and get tools for every Cloud resource plus DNS zones and records.
- Generic cloud_request tool for full reach.
- Live test every read endpoint, record in the audit.

### Phase 2. Cloud write surface (cost-guarded, tested safely)
- Create, update, delete, and per-resource action tools.
- Cost-guard. free-create resources flow normally, billed creates require confirm flag
  and surface the hourly and monthly price first from the live pricing endpoint.
- Test free-create with create plus delete. Test one billed create plus immediate delete
  on explicit go.

### Phase 3. Storage Box surface
- Client on api.hetzner.com with the same token.
- Typed tools plus generic storagebox_request. Read tested free, create cost-guarded.

### Phase 4. Robot surface (needs Robot webservice credentials)
- Client on robot-ws.your-server.de with HTTP Basic auth, form-encoded bodies.
- Typed tools plus generic robot_request for dedicated servers, vSwitches, rdns, reset, boot.

### Phase 5. Orchestration skill
- hetzner-provision skill. spins up a full stack end to end (ssh key, network, firewall,
  server with cloud-init, wait for running, verify, output), plus teardown, with cost
  preview and confirmation. This is the actually completes the task layer.

### Phase 6. Quality, docs, publish
- Fallow integrated. pre-commit and CI gate, saved baseline, new-only mode.
- Non-technical README, CONTRIBUTING.md, ARCHITECTURE.md, API-COVERAGE.md,
  community comparison (what other Hetzner MCPs expose vs this one).
- CHANGELOG.md. Test gauntlet. Publish to npm and register in MCP directories.

## Credentials needed from you (only when its phase starts)

| Phase | Needs | Where to find it |
|---|---|---|
| 1, 2, 3 | Cloud API token | provided, working. Hetzner Cloud Console, project, Security, API Tokens |
| 4 | Robot webservice user and password | Hetzner Robot, robot.hetzner.com, Settings, Web service and app settings. Create a webservice user there. Separate from the Cloud token |

## Cost ledger (running)

Every test that could cost money is logged here with the resource, lifetime, and
estimated charge. Target total. under 0.05 EUR for the entire build.

| Date | Resource | Lifetime | Est. cost |
|---|---|---|---|
| 2026-06-07 | none yet, only free reads | n/a | 0.00 EUR |
| 2026-06-08 | cx23 server, billed-path test | ~5 seconds, then deleted | under 0.01 EUR |

## Decisions locked 2026-06-07

- Build sequence. wait for Robot webservice credentials, then build all three surfaces in one continuous, tested sequence.
- Cost guard. confirm plus live price preview. A billed create requires an explicit confirm flag and the tool first fetches and shows the hourly and monthly price from the live pricing endpoint.

## Contribution loop (baked into the MCP, user idea 2026-06-07)

The MCP actively turns gaps into contributions. Two mechanisms.

1. Guided fallback. When a user asks for something that is not yet a curated tool, or
   the generic request reaches an endpoint with no typed wrapper, the tool response
   appends a short invitation with a prefilled GitHub new-issue link, so reporting a
   missing capability is one click.
2. A dedicated tool, contribute_or_report. Given a short description of what was wanted,
   it returns a ready-to-submit GitHub issue URL (title, body, labels prefilled) and, if
   the user already has a fix, the exact steps to open a pull request. It links to
   CONTRIBUTING.md and the endpoint audit so contributors see what already exists.

Issue and PR templates live in .github. Contributions are welcomed and credited in
docs/CREDITS.md, consistent with the compulsory-attribution license.
