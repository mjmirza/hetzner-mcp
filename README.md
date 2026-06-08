<div align="center">

<img src="assets/hetzner-cloud-logo.svg" alt="Hetzner" height="56" />

# hetzner-mcp

Manage your entire Hetzner platform from any AI assistant. Cloud servers, networks, volumes, firewalls, load balancers, IPs and DNS, plus Storage Boxes and Robot dedicated servers. One Model Context Protocol server, every surface, tested live, with a hard cost guard so you never get a surprise bill.

[![npm version](https://img.shields.io/npm/v/hetzner-mcp?logo=npm)](https://www.npmjs.com/package/hetzner-mcp)
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

## Validated live, not theorized

Every tool and every scenario in this server was run live against the real Hetzner API, not described from theory. 91 automated checks across cloud, Storage Box, and Robot, with 0 failures. Every billed resource was created and then destroyed, a full load balanced stack was deployed and proven to round robin across two backends, and the account was left clean. Zero dead code, with fallow tracking every source, test, and script file.

| Checks run live | Failures | Tools exercised | Surfaces | Dead code |
|---|---|---|---|---|
| 91 | 0 | every registered tool | cloud, storage box, robot | 0 |

Read the full [validation report](docs/VALIDATION.md) for the per tool table, the cost discipline, the diagrams, and the exact commands to reproduce it yourself (`npm run validate:live`, `npm run eval`, `npm run deploy:demo`).

## Set it up by pasting one prompt

No setup effort. Copy the block below, paste it into Claude Code, Codex, Cursor, or any AI coding tool, and it installs the server, wires it into your flow, and walks you through the one manual step, getting a token.

```
Set up the hetzner-mcp server from https://github.com/mjmirza/hetzner-mcp so that from now on I can manage my whole Hetzner platform, Cloud servers, networks, volumes, firewalls, load balancers, IPs, DNS, Storage Boxes, and Robot dedicated servers, from this AI assistant, safely.

Steps:
1. Register the MCP server. Run this, replacing MY_TOKEN with my Hetzner Cloud API token:
   claude mcp add -s user hetzner -e HETZNER_CLOUD_TOKEN=MY_TOKEN -- npx -y hetzner-mcp
   For dedicated servers also add: -e HETZNER_ROBOT_USER=my-ws-user -e HETZNER_ROBOT_PASSWORD=my-ws-password
2. If I do not have a token yet, walk me through it. Hetzner Cloud Console at https://console.hetzner.com, my project, Security, API Tokens, Generate. Choose Read and Write to manage resources. The same token also works for Storage Boxes.
3. Install the provision skill so you can spin up a full stack end to end. Copy skills/hetzner-provision from the repo into my agent skills directory, for Claude Code that is ~/.claude/skills/hetzner-provision/.
4. Add a standing rule for yourself. never create a billed resource without showing me the live price and getting my explicit yes, and always offer to tear down test resources to stop cost.
5. Confirm it works with a free read. list my servers, my storage boxes, and if Robot is set, my dedicated servers.
6. Tell me exactly what you installed and how I provision or tear down anything from now on.
```

Want only a one time look, no install? Paste this instead.

```
Connect to my Hetzner account through the hetzner-mcp server, run npx -y hetzner-mcp with my Cloud API token, then show me everything I am running across Cloud, Storage Box, and Robot, with the monthly cost. Do not create or delete anything. Reads are free.
```

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

It is published on npm. Point your MCP client at the package and give it your token. This uses npx, so nothing is installed permanently.

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

### Install globally with npm

Install once and the hetzner-mcp command is on your PATH.

```
npm install -g hetzner-mcp
```

Then point your MCP client at the installed command instead of npx.

```
claude mcp add hetzner -e HETZNER_CLOUD_TOKEN=your-token -- hetzner-mcp
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

### Visual walkthrough, getting the Cloud token

Open the Cloud Console, then your project.

![Open the Hetzner Cloud Console](assets/setup/01-cloud-open-console.png)
![Select your project](assets/setup/02-cloud-select-project.png)

Open Security, then the API Tokens tab, and generate the token.

![Open Security](assets/setup/03-cloud-open-security.png)
![API Tokens tab and generate](assets/setup/04-cloud-api-tokens.png)

For dedicated servers, create a Robot webservice user.

![Robot web service and app settings](assets/setup/05-robot-webservice-settings.png)

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

## Why this instead of building your own

You could write your own. Most people say they will and never do, and the ones who do end up rebuilding the same things this already has, tested.

- A cost guard. Your own script will happily create a billed server. This one refuses without a confirm and shows the live price first, which matters most when an AI agent is the one calling it.
- The safety layer. Secret redaction, relative-path-only requests so an agent cannot be pointed at another host, request timeouts, and input validation on every call.
- Coverage that does not rot. Three generic tools reach every endpoint, so it keeps working when Hetzner adds a new one, and every endpoint is validated live, 39 of 39.

Prefer infrastructure as code? Use Terraform or the hcloud CLI, they are excellent for that. This is for the other case, when your AI assistant should do the work in plain language, safely, without you writing or maintaining the glue. It is MIT, so if you would rather build on it than from zero, fork it.

Common questions, technical and non technical, are answered in [docs/FAQ.md](docs/FAQ.md).

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
