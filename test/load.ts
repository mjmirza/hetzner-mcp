/** Offline load tests: request limits, the shared map cache, page limits, text caps and linear cost. */
import { request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type HetznerConfig } from "../src/config.js";
import { hetznerRequest, MAX_IN_FLIGHT, MAX_IN_FLIGHT_PER_TOKEN, MAX_RESPONSE_BYTES } from "../src/http.js";
import { HetznerApiError } from "../src/errors.js";
import { collectGraph, listAll } from "../src/map/collect.js";
import { collectStatuses, resetStatusMemory, POLL_MS_PER_PAGE } from "../src/map/live.js";
import { invalidateGraphs } from "../src/map/graph-cache.js";
import { discoverProjects } from "../src/map/projects.js";
import { audit, auditMarkdown } from "../src/map/audit.js";
import { finalize } from "../src/map/totals.js";
import { summarize, SUMMARY_PROJECTS } from "../src/map/summary.js";
import { startMapServer } from "../src/map/server.js";
import { registerMapTool } from "../src/tools/map.js";
import { registerAuditTool } from "../src/tools/audit.js";
import type { InfraGraph, MapNode } from "../src/map/types.js";
import type { StatusSnapshot } from "../src/map/status.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

type Json = Record<string, unknown>;
type ToolAnswer = { content: Array<{ text: string }> };
const realFetch = globalThis.fetch;
const cfgDir = mkdtempSync(join(tmpdir(), "hz-load-"));
const tokenA = "loadtesttokenA" + "a".repeat(50);
const tokenB = "loadtesttokenB" + "b".repeat(50);
const tokenC = "loadtesttokenC" + "c".repeat(50);

/** A stub Hetzner that counts calls and requests in flight. Lists are sized per path. */
function stubHetzner(opts: { delayMs?: number; sizes?: Record<string, number> } = {}) {
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0, perToken: new Map<string, number>(), maxPerToken: 0 };
  globalThis.fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const u = new URL(String(input));
    const tok = String((init.headers as Record<string, string>)?.Authorization ?? "").replace("Bearer ", "");
    stats.calls++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    stats.perToken.set(tok, (stats.perToken.get(tok) ?? 0) + 1);
    stats.maxPerToken = Math.max(stats.maxPerToken, stats.perToken.get(tok)!);
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const path = u.pathname.replace(/^\/v1/, "");
      if (path === "/pricing") return Response.json({ pricing: { currency: "EUR", vat_rate: "19.00", server_types: [], load_balancer_types: [], primary_ips: [], floating_ips: [] } });
      const page = Number(u.searchParams.get("page") ?? 1);
      const per = Number(u.searchParams.get("per_page") ?? 25);
      const size = opts.sizes?.[path] ?? 0;
      const count = Math.max(0, Math.min(per, size - (page - 1) * per));
      const items = Array.from({ length: count }, (_, i) => ({ id: (page - 1) * per + i + 1, name: `r${i}`, status: "running", location: { name: "fsn1" } }));
      const next = page * per < size ? page + 1 : null;
      return Response.json({ [path.slice(1)]: items, meta: { pagination: { page, next_page: next } } });
    } finally {
      stats.inFlight--;
      stats.perToken.set(tok, stats.perToken.get(tok)! - 1);
    }
  }) as typeof fetch;
  return stats;
}

const baseEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ XDG_CONFIG_HOME: cfgDir, HOME: cfgDir, ...extra });

// 1. Requests in flight are capped for the whole process and for each token.
{
  const stats = stubHetzner({ delayMs: 15 });
  const cfg = loadConfig(baseEnv({ HETZNER_CLOUD_TOKEN: tokenA }));
  const cfgs: HetznerConfig[] = [tokenA, tokenB, tokenC, tokenA + "d", tokenB + "e", tokenC + "f"].map((t) => ({ ...cfg, cloudToken: t }));
  const jobs = Array.from({ length: 120 }, (_, i) => hetznerRequest(cfgs[i % cfgs.length]!, { surface: "cloud", path: "/servers" }));
  const results = await Promise.allSettled(jobs);
  assert(`at most ${MAX_IN_FLIGHT} requests in flight at once (saw ${stats.maxInFlight})`, stats.maxInFlight <= MAX_IN_FLIGHT);
  assert(`at most ${MAX_IN_FLIGHT_PER_TOKEN} requests in flight per token (saw ${stats.maxPerToken})`, stats.maxPerToken <= MAX_IN_FLIGHT_PER_TOKEN);
  assert("every queued request still completes", results.every((r) => r.status === "fulfilled") && stats.calls === 120);
}

// 8. A huge page does not overflow the stack, and an oversized answer fails clearly.
{
  const cfg = { ...loadConfig(baseEnv({ HETZNER_CLOUD_TOKEN: tokenA })), maxPages: 1 };
  globalThis.fetch = (async () => Response.json({ servers: Array.from({ length: 300_000 }, (_, i) => ({ id: i })), meta: { pagination: { next_page: null } } })) as typeof fetch;
  const got = await listAll(cfg, "cloud", "/servers", "servers").then((l) => l.length, () => -1);
  assert("a page of 300,000 items is read without a stack overflow", got === 300_000);
  const big = "x".repeat(MAX_RESPONSE_BYTES + 1024);
  globalThis.fetch = (async () => new Response(`{"servers":["${big}"]}`, { status: 200 })) as typeof fetch;
  const code = await hetznerRequest(cfg, { surface: "cloud", path: "/servers" }).then(
    () => "",
    (err: unknown) => (err instanceof HetznerApiError ? err.code : "other"),
  );
  assert("an answer over the size cap fails with response_too_large", code === "response_too_large");
  let cancelled = false;
  const endless = new ReadableStream({ pull: () => new Promise(() => undefined), cancel: () => void (cancelled = true) });
  globalThis.fetch = (async () => new Response(endless, { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } })) as typeof fetch;
  const declared = await hetznerRequest(cfg, { surface: "cloud", path: "/servers" }).then(() => "", (err: unknown) => (err instanceof HetznerApiError ? err.code : "other"));
  assert("an answer declared over the size cap is cancelled unread", declared === "response_too_large" && cancelled);
  stubHetzner();
  const freed = await Promise.all(Array.from({ length: MAX_IN_FLIGHT_PER_TOKEN }, () => hetznerRequest(cfg, { surface: "cloud", path: "/servers" }).then(() => true, () => false)));
  assert("a cancelled answer frees its request slot", freed.every(Boolean));
}


// 3. The page limit is reported, never silent.
{
  stubHetzner({ sizes: { "/servers": 500, "/load_balancers": 5 } });
  const env = baseEnv({ HETZNER_CLOUD_TOKEN: tokenA, HETZNER_MCP_MAX_PAGES: "2" });
  const g = await collectGraph(loadConfig(env), env);
  const project = g.nodes.find((n) => n.kind === "project");
  assert("only the allowed pages are read (100 of 500 servers)", g.nodes.filter((n) => n.kind === "server").length === 100);
  assert("a caveat says the server list is incomplete", g.caveats.some((c) => c.includes("Only the first 100 servers were read; totals are incomplete.")));
  assert("the project node is marked incomplete", project?.details.incomplete === true && project.flags.some((f) => f.code === "list_incomplete"));
  resetStatusMemory();
  const snap = await collectStatuses(loadConfig(env), env);
  assert("the status poll marks the project incomplete", !!snap.incompleteProjects?.includes(project!.id) && !!snap.note);
}

// 10. A project needing several pages is polled less often and says its values are older.
{
  const stats = stubHetzner({ sizes: { "/servers": 120, "/load_balancers": 1 } });
  const env = baseEnv({ HETZNER_CLOUD_TOKEN: tokenA });
  const cfg = loadConfig(env);
  resetStatusMemory();
  const t0 = 1_000_000;
  const first = await collectStatuses(cfg, env, { now: t0 });
  const afterFirst = stats.calls;
  const second = await collectStatuses(cfg, env, { now: t0 + POLL_MS_PER_PAGE });
  const afterSecond = stats.calls;
  await collectStatuses(cfg, env, { now: t0 + 3 * POLL_MS_PER_PAGE });
  const projectId = Object.keys(first.entries)[0]!.split("/srv:")[0]!;
  assert("a 3-page project is not re-read on the next minute", afterSecond === afterFirst);
  assert("its last values are kept and marked as from an earlier check", Object.keys(second.entries).length === 121 && !!second.deferredProjects?.includes(projectId));
  assert("it is re-read once its interval has passed", stats.calls > afterSecond);
}

// 2. infra_map and infra_audit share one read, pages reuse it, refresh and writes read again.
{
  for (const k of Object.keys(process.env)) if (k.startsWith("HETZNER_")) delete process.env[k];
  Object.assign(process.env, baseEnv({ HETZNER_CLOUD_TOKEN: tokenA }));
  const stats = stubHetzner({ delayMs: 5, sizes: { "/servers": 30, "/volumes": 5 } });
  const handlers: Record<string, (a: Json) => Promise<ToolAnswer>> = {};
  const fake = { registerTool: (name: string, _d: unknown, h: (a: Json) => Promise<ToolAnswer>) => void (handlers[name] = h) };
  const cfg = loadConfig(process.env);
  registerMapTool(fake as never, cfg);
  registerAuditTool(fake as never, cfg);
  invalidateGraphs();
  await Promise.all(Array.from({ length: 10 }, () => handlers.infra_map!({ serve: false })));
  const oneRead = stats.calls;
  const pages = await Promise.all([handlers.infra_audit!({ full: true }), handlers.infra_audit!({ full: true, page: 2 }), handlers.infra_audit!({ finding: 1 }), handlers.infra_map!({ serve: false })]);
  assert(`10 parallel maps plus audit pages read Hetzner once (${stats.calls} calls, one read is ${oneRead})`, stats.calls === oneRead && pages.length === 4);
  const again = (await handlers.infra_map!({ serve: false })).content[0]!.text;
  assert("a cached map does not pile up notes on repeat calls", (again.match(/Costs are estimates/g) ?? []).length === 1);
  await handlers.infra_audit!({ refresh: true });
  assert("refresh=true reads Hetzner again", stats.calls === 2 * oneRead);
  await hetznerRequest(cfg, { surface: "cloud", method: "POST", path: "/servers/1/actions/poweron" }).catch(() => undefined);
  const beforeRead = stats.calls;
  await handlers.infra_audit!({});
  assert("a write drops the cached map, the next call reads again", stats.calls > beforeRead + 1);
}

// 5. Text answers stay bounded on a huge estate.
{
  const nodes: MapNode[] = [{ id: "a:x", kind: "account", label: "x", account: "x", monthly: null, flags: [], details: {} }];
  for (let i = 0; i < 3000; i++) {
    const id = `p:x/p${i}`;
    nodes.push({ id, kind: "project", label: `p${i}`, parent: "a:x", project: `p${i}`, account: "x", monthly: null, flags: [], details: {} });
    nodes.push({ id: `${id}/srv:1`, kind: "server", label: "s", parent: id, project: `p${i}`, account: "x", monthly: 4.5, flags: [], details: { ipv4: "1.2.3.4", firewalls: 0 } });
  }
  const errors = Array.from({ length: 500 }, (_, i) => ({ project: `p${i}`, account: "x", error: "unreadable" }));
  const g = finalize({ source: "live", currency: "EUR", vatNote: "", nodes, edges: [], errors, projectCount: 3000 });
  const text = summarize(g);
  assert(`the map summary lists ${SUMMARY_PROJECTS} projects and counts the rest`, text.includes("and 2980 more project(s)") && (text.match(/ resources/g) ?? []).length === SUMMARY_PROJECTS);
  assert(`the map summary stays short (${text.length} chars)`, text.length < 6000);
  const report = g.audit ?? audit(g);
  const page2 = auditMarkdown({ ...report, findings: report.findings.slice(10, 20) }, "EUR", 10, { maxScopes: 0 });
  const page1 = auditMarkdown({ ...report, findings: report.findings.slice(0, 10) }, "EUR", 0, { maxScopes: 20 });
  assert("audit page 2 does not repeat the project table", !page2.includes("## By project"));
  assert(`audit page 1 shows 20 project rows and counts the rest (${page1.length} chars)`, page1.includes("2980 more project(s)") && page1.length < 12000);
}

// 6. Cost stays linear in the number of projects.
{
  const stored = Array.from({ length: 20000 }, (_, i) => ({ name: `p${i}`, account: `a${i % 150}`, token: `T${i}`.padEnd(64, "x"), addedAt: "", workspace: `ws-${i % 150}` }));
  let t = performance.now();
  const ps = discoverProjects(loadConfig({}), {}, stored);
  const discoverMs = performance.now() - t;
  assert(`20,000 saved projects are listed in under 300 ms (${Math.round(discoverMs)} ms)`, discoverMs < 300 && ps.length === 20000);
  const nodes: MapNode[] = [{ id: "a:x", kind: "account", label: "x", account: "x", monthly: null, flags: [], details: {} }];
  for (let i = 0; i < 10000; i++) {
    const id = `p:x/p${i}`;
    nodes.push({ id, kind: "project", label: `p${i}`, parent: "a:x", project: `p${i}`, account: "x", monthly: null, flags: [], details: {} });
    nodes.push({ id: `${id}/loc:fsn1`, kind: "location", label: "fsn1", parent: id, project: `p${i}`, account: "x", monthly: null, flags: [], details: {} });
    nodes.push({ id: `${id}/srv:1`, kind: "server", label: "s", parent: `${id}/loc:fsn1`, project: `p${i}`, account: "x", monthly: 4.5, flags: [], status: "running", details: {} });
  }
  t = performance.now();
  finalize({ source: "live", currency: "EUR", vatNote: "", nodes, edges: [], errors: [], projectCount: 10000 });
  const finalizeMs = performance.now() - t;
  assert(`totals and audit for 10,000 projects take under 500 ms (${Math.round(finalizeMs)} ms)`, finalizeMs < 500);
}

// 7 and 9. The map server: one status poll until it ends, deadlines, most-recently-used cache.
// The per-launch key of the server under test.
let mapKey = "";
function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path, headers: { "X-Hzmap": mapKey, Host: `127.0.0.1:${port}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    r.on("error", reject);
    r.end();
  });
}
const emptyGraph = (workspace?: string): InfraGraph => ({ source: "live", generatedAt: "", currency: "EUR", vatNote: "", nodes: [], edges: [], totals: { monthly: 0, byProject: [], byKind: [], topDrivers: [], findings: [] }, caveats: [], workspace });
{
  const env = baseEnv();
  for (let i = 0; i < 14; i++) env[`HETZNER_CLOUD_TOKEN_W${i}`] = `wstoken${i}`.padEnd(64, "q");
  for (let i = 0; i < 14; i++) env[`HETZNER_WORKSPACE_W${i}`] = `ws-${i}`;
  const collects: Record<string, number> = {};
  let statusJobs = 0;
  let release: (s: StatusSnapshot) => void = () => undefined;
  const h = await startMapServer(loadConfig(env), {
    port: 43483,
    env,
    deadlineMs: 150,
    collect: async (ws) => {
      collects[ws ?? ""] = (collects[ws ?? ""] ?? 0) + 1;
      if (ws === "ws-13") return new Promise<InfraGraph>(() => undefined);
      return emptyGraph(ws);
    },
    statuses: () => {
      statusJobs++;
      return new Promise<StatusSnapshot>((r) => (release = r));
    },
  });
  mapKey = h.token;
  try {
    // Loads run in this order on purpose: ws-0 is used after every other workspace.
    const order = ["ws-0", ...Array.from({ length: 11 }, (_, i) => [`ws-${i + 1}`, "ws-0"]).flat(), "ws-12", "ws-0"];
    await order.reduce<Promise<unknown>>((prev, ws) => prev.then(() => get(h.port, `/api/graph?workspace=${ws}`)), Promise.resolve());
    assert(`a workspace used after every other load stays cached (read ${collects["ws-0"]} time)`, collects["ws-0"] === 1);

    const started = Date.now();
    const slow = await get(h.port, "/api/graph?workspace=ws-13");
    assert(`a map read past the deadline answers 504 with a clear message (${Date.now() - started} ms)`, slow.status === 504 && slow.body.includes("taking longer than"));

    const realNow = Date.now;
    const first = get(h.port, "/api/status?workspace=ws-1");
    await new Promise((r) => setTimeout(r, 20));
    Date.now = () => realNow() + 25_000;
    const second = await get(h.port, "/api/status?workspace=ws-1");
    Date.now = realNow;
    assert("a running status poll is shared, even after 20 seconds", statusJobs === 1);
    assert("a status poll past the deadline answers 504", second.status === 504);
    release({ checkedAt: new Date().toISOString(), entries: {}, failedProjects: [] });
    await first;
    const cached = await get(h.port, "/api/status?workspace=ws-1");
    assert("the finished poll is reused for the next request", statusJobs === 1 && cached.status === 200);
  } finally {
    await h.close();
  }
}

// 11. A write drops the map server's own copies and the remembered live status too.
{
  const stats = stubHetzner({ sizes: { "/servers": 120, "/load_balancers": 1 } });
  const env = baseEnv({ HETZNER_CLOUD_TOKEN: tokenA });
  const cfg = loadConfig(env);
  resetStatusMemory();
  const t0 = 2_000_000;
  await collectStatuses(cfg, env, { now: t0 });
  await hetznerRequest(cfg, { surface: "cloud", method: "POST", path: "/servers/1/actions/poweron" }).catch(() => undefined);
  const beforePoll = stats.calls;
  const polled = await collectStatuses(cfg, env, { now: t0 + POLL_MS_PER_PAGE });
  assert("after a write the next status poll reads a large project again", stats.calls > beforePoll && !polled.deferredProjects);

  let reads = 0;
  const h = await startMapServer(cfg, { port: 43490, env, collect: async (ws) => (reads++, emptyGraph(ws)) });
  mapKey = h.token;
  try {
    await get(h.port, "/api/graph");
    await get(h.port, "/api/graph");
    const cachedReads = reads;
    await hetznerRequest(cfg, { surface: "cloud", method: "POST", path: "/servers/1/actions/poweron" }).catch(() => undefined);
    await get(h.port, "/api/graph");
    assert("a write from a tool in the same process drops the map server's cached graph", cachedReads === 1 && reads === 2, `reads=${reads}`);
  } finally {
    await h.close();
  }
}

globalThis.fetch = realFetch;
process.stdout.write(`\n${passed}/${total} load checks passed\n`);
if (passed !== total) process.exit(1);
