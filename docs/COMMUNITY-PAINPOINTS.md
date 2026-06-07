# Community Pain Points

Real friction that Hetzner users report, and how this MCP addresses each. Sourced from
public writeups and the state of community tooling, gathered 2026-06-07. Quotes are
paraphrased from the cited source, follow the link for the original.

## What users struggle with

1. API tokens must be created by hand in the console, you cannot bootstrap them as code.
   Source. Interjektio, Hetzner from an Automation Perspective,
   https://interjektio.fi/blog/2025/10/14/hetzner-from-automation-perspective/
   How this helps. the SETUP guide makes the one manual token step foolproof with
   screenshots, then everything after is automated through the MCP.

2. SSH keys attached at creation cannot be changed later without recreating the server,
   so access management needs external tooling like Ansible or PyInfra.
   Source. Interjektio, same article.
   How this helps. the MCP exposes the full SSH key and server surface, so an agent can
   script key rotation and server replacement as one guided flow rather than by hand.

3. Network setup needs extra config files and commands run on the server, with cloud-init
   templates and netplan, which is fiddly to get persistent.
   Source. Interjektio, same article.
   How this helps. the orchestration skill builds network, firewall, and server together
   and passes user_data cloud-init in one step, with verification.

4. cloud-init user data only runs at creation, so later changes need more tooling.
   Source. Interjektio, same article.
   How this helps. the MCP makes create, verify, and teardown a repeatable agent loop, so
   recreating from a known good definition is cheap.

## The tooling gap this fills

- There is no official Hetzner MCP. The community ones are Cloud only and do not document a
  cost guard, a live endpoint audit, or token efficiency.
- This project covers all three surfaces, guards spend and deletion, proves every endpoint
  live, and stays cheap on context. See docs/CHEATSHEET.md for the comparison.

If you have a pain point not listed here, open an issue, the MCP can hand you a prefilled
link through the contribute_or_report tool.
