/** Offline tests for issue #83 (User-Agent) and #84 (wait on actions). Fetch is mocked. */
import { loadConfig } from "../src/config.js";
import { collectActions, waitForActions, anyActionFailed } from "../src/actions.js";
import { hetznerRequest } from "../src/http.js";
import { deletionPreview, describeSurvivors } from "../src/tools/delete-preview.js";
import { capacityRows, rankCapacity } from "../src/tools/capacity.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

const cfg = { ...loadConfig({ HETZNER_CLOUD_TOKEN: "testtoken" }), actionWaitMs: 5000 };
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

// Delete preview: what keeps billing after a server delete, and what is lost.
const srvX = { id: 5, volumes: [77] };
const prev = describeSurvivors(
  srvX,
  [{ ip: "1.2.3.4", assignee_id: 5, auto_delete: false }, { ip: "5.6.7.8", assignee_id: 5, auto_delete: true }],
  [{ created_from: { id: 5 } }, { created_from: { id: 9 } }],
  [{ created_from: { id: 5 } }],
);
assert("preview names the IP that keeps billing", prev.includes("1.2.3.4") && !prev.includes("5.6.7.8"));
assert("preview names the attached volume", prev.includes("volume 77"));
assert("preview counts only this server's snapshots", prev.includes("1 snapshot(s)"));
assert("preview warns backups are lost", prev.includes("1 automatic backup(s)"));
assert("preview is empty for a clean server", describeSurvivors({ id: 1 }, [], [], []) === "");

// A billed survivor that sits past the first 50 must still be named. Hetzner pages at 50.
{
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL | string) => {
    const u = new URL(String(url));
    const page = Number(u.searchParams.get("page") ?? "1");
    const path = u.pathname;
    if (path.endsWith("/servers/5")) return Response.json({ server: { id: 5, volumes: [77] } });
    if (path.endsWith("/primary_ips")) {
      if (page === 1) {
        return Response.json({
          primary_ips: Array.from({ length: 50 }, (_, i) => ({ ip: `10.0.0.${i}`, assignee_id: 1, auto_delete: false })),
          meta: { pagination: { page: 1, next_page: 2 } },
        });
      }
      return Response.json({
        primary_ips: [{ ip: "9.9.9.9", assignee_id: 5, auto_delete: false }],
        meta: { pagination: { page: 2, next_page: null } },
      });
    }
    if (path.endsWith("/images") && u.searchParams.get("type") === "snapshot") {
      if (page === 1) {
        return Response.json({
          images: Array.from({ length: 50 }, () => ({ created_from: { id: 9 } })),
          meta: { pagination: { page: 1, next_page: 2 } },
        });
      }
      return Response.json({
        images: [{ created_from: { id: 5 } }],
        meta: { pagination: { page: 2, next_page: null } },
      });
    }
    if (path.endsWith("/images") && u.searchParams.get("type") === "backup") {
      return Response.json({ images: [{ created_from: { id: 5 } }], meta: { pagination: { next_page: null } } });
    }
    return Response.json({ error: { code: "unexpected", message: path } }, { status: 500 });
  }) as typeof fetch;

  const preview = await deletionPreview(cfg, 5);
  assert("preview names a primary IP that is only on page 2", preview.includes("9.9.9.9") && !preview.includes("10.0.0.1"));
  assert("preview counts a snapshot that is only on page 2", preview.includes("1 snapshot(s)"));
  assert("preview still names the volume and the backups", preview.includes("volume 77") && preview.includes("1 automatic backup(s)"));
  assert("a finished list does not claim the check was cut short", !preview.includes("were checked"));

  const cut = await deletionPreview({ ...cfg, maxPages: 1 }, 5);
  assert("a list stopped at the page cap says the check is incomplete", cut.includes("Only the first 50 primary IPs and snapshots were checked"));
  assert("the page cap does not report a primary IP it never read", !cut.includes("9.9.9.9"));
  assert("the page cap still reports what the server record itself shows", cut.includes("volume 77"));
  globalThis.fetch = savedFetch;
}

// Capacity: sold-out and retiring types never offered by default, recommended first.
const types = [
  { name: "cx23", cores: 2, memory: 4, disk: 40, architecture: "x86", prices: [{ location: "fsn1", price_monthly: { gross: "5.49" } }, { location: "hel1", price_monthly: { gross: "5.49" } }], locations: [{ name: "fsn1", available: false }, { name: "hel1", available: true, recommended: true }] },
  { name: "cpx11", cores: 2, memory: 2, disk: 40, architecture: "x86", prices: [{ location: "fsn1", price_monthly: { gross: "4.99" } }], locations: [{ name: "fsn1", available: true, deprecation: { unavailable_after: "2026-12-01T00:00:00Z" } }] },
  { name: "cax11", cores: 2, memory: 4, disk: 40, architecture: "arm", prices: [{ location: "fsn1", price_monthly: { gross: "4.49" } }], locations: [{ name: "fsn1", available: true }] },
];
const ranked = rankCapacity(capacityRows(types), {});
assert("capacity hides sold-out combos", !ranked.some((r) => r.type === "cx23" && r.location === "fsn1"));
assert("capacity hides retiring types by default", !ranked.some((r) => r.type === "cpx11"));
assert("capacity can include retiring types", rankCapacity(capacityRows(types), { includeRetiring: true }).some((r) => r.type === "cpx11"));
assert("capacity puts recommended first", ranked[0]?.type === "cx23" && ranked[0]?.location === "hel1");
assert("capacity architecture filter works", rankCapacity(capacityRows(types), { architecture: "arm" }).every((r) => r.architecture === "arm"));

process.stdout.write(`\n${passed}/${total} action checks passed\n`);
if (passed !== total) process.exitCode = 1;
