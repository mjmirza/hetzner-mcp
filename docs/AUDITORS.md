# Multi-Auditor Quality Comparison

This project does not rely on a single tool to call the code clean. It runs four
independent auditors and records their real output. Re-run any of them yourself.

Run on 2026-06-07 against the full source.

| Auditor | What it checks | Command | Result |
|---|---|---|---|
| tsc | TypeScript type safety, strict mode | npx tsc --noEmit | clean, zero errors |
| npm audit | dependency vulnerabilities | npm audit --omit=dev | 0 vulnerabilities |
| fallow 2.88.2 | dead code, unused exports, cycles, boundaries | npx fallow dead-code | clean, zero findings (after removing 7 real dead exports it caught) |
| knip | dead code cross-check, unused files and deps | npx knip | clean, only cosmetic config hints |

Notes.
- fallow is the primary hygiene gate, knip is the cross-check, and they agree.
- fallow earned its place. on first run it flagged seven genuinely unused exports
  (GuardError, hetznerPaginate, READ_METHODS, WRITE_METHODS, textResult,
  READ_TOOL_COUNT, SurfaceDef) which were then removed. This is the no-bloat discipline
  working, not decoration.
- The production anti-pattern scanner also ran at write time and forced two real
  improvements. a hard request timeout via AbortSignal, and an explicit justification
  for the inherently sequential pagination.

How to reproduce.

```
npm run typecheck
npm audit --omit=dev
npm run hygiene
npx knip
npm run smoke      # live, free reads across all three surfaces
npx tsx test/eval.ts   # live validating audit, 39 of 39
```
