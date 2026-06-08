# FAQ

Honest answers to the questions and objections people actually raise. Two sections, one for
everyone and one for builders.

## For everyone

### What is this in one sentence?

It lets an AI assistant like Claude manage your Hetzner servers and infrastructure for you,
in plain language, without spending money unless you confirm.

### Will it spend my money without asking?

No. Reading and listing are always free. Creating anything that costs money is blocked until
you confirm, and the tool shows you the live hourly and monthly price first. Deleting needs a
confirm too, so nothing is created or destroyed by surprise.

### Is it safe to hand it my Hetzner token?

Your token lives only in your own environment, never in the code and never in any log. The
tool strips secrets out of error messages, only ever talks to Hetzner and not any other host,
and sends no telemetry anywhere. It is open source, so you can read every line.

### Do I need to be technical to use it?

No. There is a single setup prompt in the README. You paste it into your AI tool, it walks you
through getting a token, and then you ask for what you want in normal words.

### Why not just use the Hetzner website?

For a one off click the website is fine. This is for when you want your AI assistant to do it
for you, repeatedly, and to keep you safe from a surprise bill while it does. Different job.

### Can it delete my things by accident?

No. Every delete requires an explicit confirm. You can also run it in read only mode, where it
refuses every write, if you just want it to look and report.

## For builders

### I will just write my own script. Why do I need this?

You can, and most people who say that never do. The ones who do end up rebuilding the same
three things this already has. a cost guard that refuses billed creates without a confirm and
shows the price first, a security layer with secret redaction and SSRF safe requests, and live
tests across every endpoint. It is MIT, so if you would rather build on it than from zero, fork
it. The point is not novel capability, it is the safety and the agent readiness, already done.

### Why not Terraform or the hcloud CLI?

Use those for infrastructure as code, they are excellent. This is a different surface. Terraform
is declarative state for humans and pipelines. The hcloud CLI is for your terminal. This is for
an AI agent to act in plain language with guardrails. It wraps the same official Hetzner API, so
you are not trading away correctness, you are adding an agent safe way to call it.

### Why not an ansible playbook or a shell script?

This is the most common reaction, and it is fair for a repeatable setup. The difference is who
operates it and when. A playbook or a script is glue you write, version, and maintain, and you
run it from a terminal or a pipeline. This server lets your AI assistant do the work in plain
language, in the middle of a normal conversation, with a cost guard and a destructive guard in
front of every billed or irreversible call, and without handing a raw token to an ad hoc script.
It does not replace ansible for infrastructure you stand up the same way every time. It covers
the other moment, the exploratory, one off, assistant driven one, safely. The two live happily
side by side.

### It is an API wrapper. Where is the value?

The value is everything around the wrapper. a cost guard with a live price preview, a destructive
guard on delete, secret redaction, relative path only requests so an agent cannot be pointed at
another host, request timeouts, input validation on every tool, token efficient responses, and a
live audit that proves every endpoint works, 39 of 39. That is the part that bites you when an
agent is driving, and it is the part a quick personal script skips.

### Will it bloat my agent context, MCPs are token hungry?

It is built not to. List responses are compacted by default with a hard size cap, full payloads
are opt in, and the surface is 34 focused tools, three of which already cover every endpoint. See
docs/TOKEN-BUDGET.md.

### What happens when Hetzner adds new endpoints, does it rot?

No. Three generic per surface request tools reach every endpoint, including ones added later, so
new Hetzner endpoints work without an update. Curated tools are convenience on top, not the only
path. There is also a built in tool that turns any gap into a prefilled issue or pull request.

### How do I know it actually works and is not fabricated?

Every endpoint is tested live against a real account and the result is recorded in docs/AUDIT.md,
39 of 39. It is also gated by four independent auditors, tsc, npm audit, fallow, and knip, all
clean. See docs/AUDITORS.md.

### Is it secure enough to trust with production credentials?

The threat model and the control for each threat are written out in docs/SECURITY.md. Short
version. secrets redacted from logs, SSRF safe, no redirects followed, timeouts, zod validation,
read only mode, and a kill switch to hard disable billed creation.

### Can I forbid it from ever spending money?

Yes. Set HETZNER_MCP_READONLY=1 to refuse all writes, or HETZNER_MCP_ALLOW_BILLED=0 to allow free
resources but hard block anything billed.

### Hetzner rounds billing up to a full hour, will this waste money?

That rounding is real, and it is exactly why the cost guard shows you the price before you create
anything. You see the cost up front and decide, rather than finding out later.
