/** Offline tests for issue #83 (User-Agent) and #84 (wait on actions). Fetch is mocked. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { collectActions, waitForActions, anyActionFailed } from "../src/actions.js";
import { hetznerRequest } from "../src/http.js";
import { describeSurvivors } from "../src/tools/delete-preview.js";
import { capacityRows, rankCapacity } from "../src/tools/capacity.js";
import { registerAllTools } from "../src/tools/register.js";
import { catalog, deletePlan, plan } from "../src/map/actions.js";
import { discoverProjects } from "../src/map/projects.js";

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

// Volume create and attach send assignee, never the deprecated server property. Nothing is billed.
{
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  let volume: Record<string, unknown> = {};
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  globalThis.fetch = (async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ path, method, body });
    if (method === "GET" && path.endsWith("/volumes/21")) return json({ volume });
    if (path.endsWith("/locations")) return json({ locations: [{ name: "fsn1", city: "Falkenstein", network_zone: "eu-central" }] });
    if (path.endsWith("/server_types")) return json({ server_types: [] });
    if (path.endsWith("/images")) return json({ images: [
      { name: "ubuntu-24.04", description: "Ubuntu", architecture: "x86", deprecated: true, deprecation: null },
      { name: "fedora-43", description: "Fedora 43", architecture: "x86", deprecation: { unavailable_after: "2027-02-12T00:00:00+00:00" } },
    ] });
    if (path.endsWith("/ssh_keys")) return json({ ssh_keys: [] });
    if (path.endsWith("/networks")) return json({ networks: [] });
    if (path.endsWith("/firewalls")) return json({ firewalls: [] });
    if (path.endsWith("/servers")) return json({ servers: [{ id: 13, name: "db", location: { name: "fsn1" } }] });
    if (path.endsWith("/pricing")) return json({ pricing: { currency: "EUR", volume: { price_per_gb_month: { gross: "0.05" } }, load_balancer_types: [] } });
    return json({ action: { id: 8, command: "create_volume", status: "success" } }, 201);
  }) as typeof fetch;

  const call = async (env: Record<string, string>, name: string, args: Record<string, unknown>) => {
    const server = new McpServer({ name: "hetzner-mcp", version: "test" });
    registerAllTools(server, loadConfig(env), {});
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    await client.close();
    return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
  };
  const billedEnv = { HETZNER_CLOUD_TOKEN: "testtoken", HETZNER_MCP_ALLOW_BILLED: "1", HETZNER_MCP_ACTION_WAIT_MS: "0" };
  const before = calls.length;
  const created = await call(billedEnv, "cloud_create_volume", { name: "db", size: 10, server: 13, location: "fsn1", format: "ext4", automount: true, confirm: true });
  const create = calls.at(-1);
  assert("create volume succeeds with confirm", !created.isError && create?.method === "POST" && create.path.endsWith("/volumes"));
  assert("create volume sends assignee and not server", create?.body?.name === "db" && create.body.size === 10 && create.body.location === "fsn1" && create.body.format === "ext4" && create.body.automount === true && JSON.stringify(create.body.assignee) === JSON.stringify({ id: 13, type: "server" }) && !("server" in (create.body ?? {})) && !("labels" in (create.body ?? {})));
  const bare = await call(billedEnv, "cloud_create_volume", { name: "empty", size: 10, location: "nbg1", confirm: true });
  const bareBody = calls.at(-1)?.body ?? {};
  assert("create volume without a server omits assignee", !bare.isError && bareBody.location === "nbg1" && !("assignee" in bareBody) && !("server" in bareBody));
  const refused = await call(billedEnv, "cloud_create_volume", { name: "db", size: 10, server: 13, confirm: false });
  assert("create volume still needs confirm", refused.isError && /COST GUARD/.test(refused.text) && calls.length === before + 2);
  const blocked = await call({ HETZNER_CLOUD_TOKEN: "testtoken" }, "cloud_create_volume", { name: "db", size: 10, server: 13, confirm: true });
  assert("create volume stays behind the billed opt-in", blocked.isError && /Billed operations are disabled/.test(blocked.text) && calls.length === before + 2);
  const attached = await call(billedEnv, "cloud_attach_volume", { id: 21, server: 13, automount: false });
  const attach = calls.at(-1);
  assert("attach volume sends assignee and not server", !attached.isError && attach?.method === "POST" && attach.path.endsWith("/volumes/21/actions/attach") && JSON.stringify(attach.body) === JSON.stringify({ assignee: { id: 13, type: "server" }, automount: false }));

  const mapCfg = { ...loadConfig({ HETZNER_CLOUD_TOKEN: "testtoken", HETZNER_MCP_ALLOW_BILLED: "1" }), actionWaitMs: 0 };
  const env = { HETZNER_CLOUD_TOKEN: "testtoken", HETZNER_PROJECT_NAME: "default", HETZNER_ACCOUNT_NAME: "Acme" };
  const mapEnv = { base: mapCfg, env, demo: false };
  const ref = discoverProjects(mapCfg, env)[0]!;
  volume = { id: 21, name: "disk", assignee: { id: 13, type: "server" }, server: null };
  const blockedDelete = await deletePlan(mapEnv, "p:Acme/default/vol:21");
  assert("delete plan blocks a volume attached through assignee", blockedDelete.blocked === "This volume is attached. Detach it from its server first.");
  volume = { id: 21, name: "disk", server: 13 };
  const legacyDelete = await deletePlan(mapEnv, "p:Acme/default/vol:21");
  assert("delete plan still blocks a volume that only has server", legacyDelete.blocked === "This volume is attached. Detach it from its server first.");
  volume = { id: 21, name: "disk", assignee: null, server: 13 };
  const freeDelete = await deletePlan(mapEnv, "p:Acme/default/vol:21");
  assert("delete plan allows a volume whose assignee is null", freeDelete.blocked === undefined && freeDelete.name === "disk");

  const planned = await plan(mapEnv, ref, "volume", { name: "data", size: 20, server: "13" });
  assert("map volume create sends assignee and not server", JSON.stringify(planned.body.assignee) === JSON.stringify({ id: 13, type: "server" }) && !("server" in planned.body) && planned.body.format === "ext4" && planned.body.automount === true && planned.body.location === undefined);
  const placed = await plan(mapEnv, ref, "volume", { name: "data", size: 20, location: "fsn1" });
  assert("map volume create without a server omits assignee", !("assignee" in placed.body) && !("server" in placed.body) && placed.body.location === "fsn1");
  const images = ((await catalog(ref)) as { images: Array<{ name: string }> }).images.map((i) => i.name);
  assert("image list ignores the removed deprecated flag and keeps deprecation", images.includes("ubuntu-24.04") && !images.includes("fedora-43"));
}

process.stdout.write(`\n${passed}/${total} action checks passed\n`);
if (passed !== total) process.exitCode = 1;
