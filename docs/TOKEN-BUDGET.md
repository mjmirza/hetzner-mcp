# Token Budget

An MCP that floods the model context is expensive and slow. This server is designed to be
token efficient on purpose.

## Tool surface

- 32 tools total. 3 generic per surface request tools, 28 curated read tools, 1 contribute
  tool. Tool titles and descriptions are kept short and concrete.
- The 3 generic tools alone give complete coverage of every endpoint, so the curated tools
  are an ergonomic convenience, not a requirement.

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
