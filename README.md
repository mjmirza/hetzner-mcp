<div align="center">

<img src="assets/hetzner-cloud-logo.svg" alt="Hetzner" height="56" />

# hetzner-mcp

Manage your entire Hetzner platform from any AI assistant. Cloud servers, networks, volumes, firewalls, load balancers, IPs and DNS, plus Storage Boxes and Robot dedicated servers. One Model Context Protocol server, every surface, tested live, with a hard cost guard so you never get a surprise bill.

[![npm version](https://img.shields.io/npm/v/hetzner-mcp?logo=npm)](https://www.npmjs.com/package/hetzner-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/mjmirza/hetzner-mcp/ci.yml?branch=main&label=CI)](https://github.com/mjmirza/hetzner-mcp/actions)
[![MCP](https://img.shields.io/badge/MCP-server-000000?logo=anthropic&logoColor=white)](#quick-start)
[![License](https://img.shields.io/badge/License-MIT_plus_CC_BY_4.0-2ea44f)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-2ea44f)](CONTRIBUTING.md)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18-339933?logo=nodedotjs&logoColor=white)](package.json)

[![Sponsor](https://img.shields.io/badge/Sponsor-mjmirza-ea4aaa?logo=githubsponsors)](https://github.com/sponsors/mjmirza)
[![Stars](https://img.shields.io/github/stars/mjmirza/hetzner-mcp?style=social)](https://github.com/mjmirza/hetzner-mcp/stargazers)
[![Forks](https://img.shields.io/github/forks/mjmirza/hetzner-mcp?style=social)](https://github.com/mjmirza/hetzner-mcp/fork)
[![Follow mjmirza](https://img.shields.io/github/followers/mjmirza?label=Follow&style=social)](https://github.com/mjmirza)

**If this saves you time, please [sponsor the project](https://github.com/sponsors/mjmirza), leave a star, and follow along. Sponsorship is what lets me put real hours into building this out.**

[Star](https://github.com/mjmirza/hetzner-mcp) &nbsp;|&nbsp; [Sponsor](https://github.com/sponsors/mjmirza) &nbsp;|&nbsp; [Fork](https://github.com/mjmirza/hetzner-mcp/fork) &nbsp;|&nbsp; [Follow on GitHub](https://github.com/mjmirza) &nbsp;|&nbsp; [Follow on X](https://twitter.com/MirzaJhanzaib) &nbsp;|&nbsp; [next8n.com](https://next8n.com)

<sub>The Hetzner wordmark above is a trademark of Hetzner Online GmbH, shown only to identify the service this tool integrates with. This project is independent and is not affiliated with, endorsed by, or sponsored by Hetzner Online GmbH, and claims no rights to the logo. See <a href="docs/CREDITS.md">docs/CREDITS.md</a>.</sub>

</div>

## Please sponsor this project

This is built and maintained in the open, for free, under a license that only asks for attribution. If your team relies on it, [becoming a sponsor](https://github.com/sponsors/mjmirza) directly buys the time to cover more endpoints, keep the endpoint audit current as Hetzner changes, and respond to issues and pull requests faster. Even a small monthly amount makes a real difference. Thank you.

## What this is, in plain words

Hetzner is a hosting company. It runs cloud servers, storage, and physical dedicated servers, and it exposes APIs to control all of it. This project is a small program, an MCP server, that lets an AI assistant like Claude do that controlling for you, safely. You ask in normal language, the assistant calls the right Hetzner endpoint, and the result comes back. You do not need to learn the API. You do need to give it an access token once, which this guide walks you through.

The single most important promise. **Reading and listing are always free, and the tool will never create something that costs money without asking you first and showing you the price.**

## The three surfaces it covers

| Surface | What it manages | Credential needed |
|---|---|---|
| Cloud | servers, networks, volumes, firewalls, load balancers, floating and primary IPs, placement groups, SSH keys, images, certificates, and DNS zones | one Cloud API token |
| Storage Box | backup storage boxes | the same Cloud API token |
| Robot | physical dedicated servers and vSwitches | a separate Robot webservice user and password, only if you use dedicated servers |

All three are live tested against a real account. See [docs/ENDPOINT-AUDIT.md](docs/ENDPOINT-AUDIT.md) for the exact, dated, per endpoint results.

## Cost safety, the part you actually worry about

A wrong API call should never cost you money you did not intend. This tool is built around that.

- Every list and get is free on Hetzner. Use them as much as you like.
- Resources that are free to create, such as SSH keys, networks, firewalls, and placement groups, are created normally.
- Resources that cost money, such as servers, volumes, load balancers, floating and primary IPs, and storage boxes, are guarded. The tool refuses to create them unless you pass an explicit confirm, and it first fetches and shows you the live hourly and monthly price.
- Nothing in the test suite leaves a billed resource running. The whole build is tracked in a cost ledger in [docs/ROADMAP.md](docs/ROADMAP.md), with a target of under five cents total.

## Quick start

### Use it with Claude Code or any MCP client

Once published, point your MCP client at the package and give it your token.

```
claude mcp add hetzner -e HETZNER_CLOUD_TOKEN=your-token -- npx -y hetzner-mcp
```

For Robot dedicated servers, also add the webservice credentials.

```
claude mcp add hetzner \
  -e HETZNER_CLOUD_TOKEN=your-token \
  -e HETZNER_ROBOT_USER=your-ws-user \
  -e HETZNER_ROBOT_PASSWORD=your-ws-password \
  -- npx -y hetzner-mcp
```

### Run it from source

```
git clone https://github.com/mjmirza/hetzner-mcp
cd hetzner-mcp
npm install
cp .env.example .env   # then fill in your token
npm run build
npm start
```

## Getting your credentials

Full, beginner friendly, step by step instructions, including the German console labels, are in [docs/SETUP.md](docs/SETUP.md). The short version.

1. Cloud token. https://console.hetzner.com, your project, Security, API Tokens, Generate. This one token also works for Storage Boxes.
2. Robot user, only for dedicated servers. https://robot.hetzner.com, Settings, Web service and app settings, set a password, the username is assigned to you.

## What is tested, and how this compares

This project tests every endpoint live and records the result. The running inventory, including a deprecation log, is in [docs/ENDPOINT-AUDIT.md](docs/ENDPOINT-AUDIT.md).

There is no official Hetzner MCP. Several community servers exist, and this project studied them. The goal here is broader, tested coverage across all three surfaces, a real cost guard, and a documented endpoint audit, rather than Cloud only.

| Project | Surfaces | Notable focus |
|---|---|---|
| this project, hetzner-mcp | Cloud, Storage Box, Robot | full coverage, cost guard, live endpoint audit, contribution loop |
| dkruyt/mcp-hetzner | Cloud | Python, structured functions |
| Xodus-CO/hcloud-mcp | Cloud | standalone, works with many clients |
| lazyants/hetzner-mcp-server | Cloud | servers, networks, volumes, firewalls, load balancers |
| MahdadGhasemian/mcp-hetzner-go | Cloud | Go implementation |
| valerius21/hetzner-mcp | Cloud | Cloud API integration |
| nityeshaga/hetzner-mcp-server | Cloud | aimed at Claude Code |

If another project covers something this one does not, that is a great pull request. See below.

## Missing something? The contribution loop

This MCP is designed to grow from real use. If you ask it for something it does not cover yet, it will hand you a prefilled link to open a feature request, and if you already have the fix, the steps to open a pull request. Every gap becomes a contribution.

- Open a [feature request or missing endpoint issue](https://github.com/mjmirza/hetzner-mcp/issues/new/choose).
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for the pull request flow.
- Contributors are credited in [docs/CREDITS.md](docs/CREDITS.md).

## Quality

This is engineered, not vibe coded. The repository runs the fallow hygiene gate to block new dead code, builds and type checks in CI, and every endpoint carries a live test result. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full quality and phase plan.

## Real problems this solves

Hetzner is loved for its price, roughly one fifth to one tenth of comparable AWS, but its automation has real friction that users write about.

- "API tokens must be created by hand in the console, you cannot bootstrap them as code." After that one manual step, this MCP automates the rest, and the [setup guide](docs/SETUP.md) makes it foolproof.
- "SSH keys attached at creation cannot be changed later without recreating the server." The MCP exposes the full server and key surface so an agent can script rotation and replacement.
- "Network setup needs extra config files and commands run on the server." The [orchestration skill](skills/hetzner-provision/SKILL.md) builds network, firewall, and server together with cloud-init in one verified flow.

Sourced from real community writeups. See [docs/COMMUNITY-PAINPOINTS.md](docs/COMMUNITY-PAINPOINTS.md) and the market gap in [docs/MARKET-ANALYSIS.md](docs/MARKET-ANALYSIS.md).

## License

Dual licensed and free to use, including commercially. Attribution is required. Code under MIT, content under CC BY 4.0. Keep the notice and link back to this repository. See [LICENSE](LICENSE).

## Disclaimer

Independent community project. Not affiliated with, endorsed by, or sponsored by Hetzner Online GmbH. Hetzner and the Hetzner logo are trademarks of their respective owner. You are responsible for your own Hetzner account, credentials, and any resources you create.
