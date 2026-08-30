# Token Budget

An MCP that floods the model context is expensive and slow. This server is designed to be
token efficient on purpose.

## Tool surface

- About 56 tools total. 3 generic per surface request tools, 28 curated read tools, 24
  curated write tools, and 1 contribute tool. Titles and descriptions are kept short.
- The 24 curated write tools cover create, delete, attach, detach, and assign for servers,
  volumes, networks, firewalls, load balancers, floating and primary IPs, SSH keys, and
  placement groups. Every billed create needs confirm, and every delete needs confirm.
- The 3 generic tools alone give complete coverage of every endpoint, so the curated tools
  are an ergonomic, safer convenience, not a requirement. A caller with a tight tool budget
  can rely on the generic tools plus the reads.

## Response discipline

- List responses are compacted by default. Each item is projected to a small set of useful
  fields, id, name, status, type, ip, and a few more, instead of the full payload.
- A hard size cap of 24000 characters, roughly 6000 tokens, is applied to every response,
  with a truncation hint that tells the caller to narrow with an id or a query.
- verbose true returns the full payload only when the caller actually needs it.

## Why this matters

Hetzner list endpoints can be large. Returning the raw payload of images, server types, or
pricing would spend thousands of tokens per call. The compact projection turns a typical
list into a short, scannable summary, and the cap guarantees no single call can blow the
budget. The result is a server that stays cheap to keep connected.

## How to measure

Connect the server and call a few tools, then compare the compact output against verbose
true on the same call. The compact view is usually an order of magnitude smaller.
