/** Offline tests for issue #83 (User-Agent) and #84 (wait on actions). Fetch is mocked. */
import { loadConfig } from "../src/config.js";
import { collectActions, waitForActions, anyActionFailed } from "../src/actions.js";
import { hetznerRequest } from "../src/http.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

const cfg = { ...loadConfig({ HETZNER_CLOUD_TOKEN: "test-token" }), actionWaitMs: 5000 };
const seenHeaders: Record<string, string>[] = [];
const polls: Record<number, string[]> = {
  1: ["running", "success"],
  2: ["running", "running", "error"],
};

globalThis.fetch = (async (url: URL, init: RequestInit) => {
  seenHeaders.push(init.headers as Record<string, string>);
  const m = String(url).match(/\/actions\/(\d+)$/);
  const id = m ? Number(m[1]) : 0;
  const status = polls[id]?.shift() ?? "success";
  const body = { action: { id, command: `cmd${id}`, status, error: status === "error" ? { code: "x", message: "boom" } : null } };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const found = collectActions({ action: { id: 1 }, next_actions: [{ id: 2 }, { id: 1 }] });
assert("collectActions dedupes action and next_actions", found.length === 2);
assert("collectActions ignores responses with no actions", collectActions({ server: {} }).length === 0);

await hetznerRequest(cfg, { surface: "cloud", path: "/servers" });
const ua = seenHeaders[0]?.["User-Agent"] ?? "";
assert(`#83: User-Agent sent (${ua})`, /^hetzner-mcp\/\d+\.\d+\.\d+/.test(ua));

const out = await waitForActions(cfg, { action: { id: 1, command: "create_server", status: "running" }, next_actions: [{ id: 2, command: "start_server", status: "running" }] }, { intervalMs: 5 });
assert("#84: running action polled to success", out.find((o) => o.id === 1)?.status === "success");
assert("#84: failed action reported as error with message", out.find((o) => o.id === 2)?.error === "boom");
assert("#84: anyActionFailed true when one fails", anyActionFailed(out));

const skipped = await waitForActions({ ...cfg, actionWaitMs: 0 }, { action: { id: 9, status: "running" } });
assert("#84: wait disabled with budget 0 returns running, no polling", skipped[0]?.status === "running");

polls[3] = Array(1000).fill("running");
const t0 = Date.now();
const slow = await waitForActions(cfg, { action: { id: 3, status: "running" } }, { budgetMs: 60, intervalMs: 10 });
assert("#84: deadline bounds a stuck action", slow[0]?.status === "running" && Date.now() - t0 < 1000);

process.stdout.write(`\n${passed}/${total} action checks passed\n`);
if (passed !== total) process.exitCode = 1;
