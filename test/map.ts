/** Offline tests for the infrastructure map: cost model, findings, projects, server security. */
import { request } from "node:http";
import { loadConfig } from "../src/config.js";
import { sampleGraph } from "../src/map/sample.js";
import { discoverProjects } from "../src/map/projects.js";
import { startMapServer, mapPortFromEnv, DEFAULT_MAP_PORT } from "../src/map/server.js";
import { summarize, toMermaid } from "../src/map/summary.js";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { openBrowser, openerFor } from "../src/map/cli.js";
import { CSP } from "../src/map/server.js";
import { readStored, saveStored, removeStored } from "../src/map/store.js";
import { connectProject, ActionError } from "../src/map/actions.js";
import { serverState, robotState, healthState, targetHealth, liveOf, liveLookup, rollup, type StatusSnapshot } from "../src/map/status.js";
import { collectStatuses } from "../src/map/live.js";
import { placeName, explainLocation, explainType, familyOf } from "../web/src/lib/glossary.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

const g = sampleGraph();
const byLabel = (l: string) => g.nodes.find((n) => n.label === l)!;
assert("sample is labelled sample", g.source === "sample" && g.caveats[0]!.startsWith("SAMPLE"));
assert("total equals sum of billable nodes", Math.abs(g.totals.monthly - g.nodes.reduce((s, n) => s + (n.monthly ?? 0), 0)) < 0.01);
assert("project totals add up to the grand total", Math.abs(g.totals.byProject.reduce((s, p) => s + p.monthly, 0) - g.totals.monthly) < 0.01);
assert("backups add 20% to a server (31.49 to 37.79)", byLabel("db-primary").monthly === 37.79);
assert("volume priced per GB (200 GB = 11.44)", byLabel("db-data").monthly === 11.44);
assert("attached volume sits inside its server", byLabel("db-data").parent === byLabel("db-primary").id);
assert("server in a network sits inside the network", g.nodes.find((n) => n.id === byLabel("web-1").parent)?.kind === "network");
assert("powered-off server flagged", byLabel("old-migration-box").flags.some((f) => f.kind === "waste" && f.text.includes("Powered off")));
assert("unattached volume flagged as waste with its full cost", byLabel("orphan-disk").flags[0]?.kind === "waste" && byLabel("orphan-disk").flags[0]?.monthly === 14.3);
assert("unassigned primary IP flagged", byLabel("203.0.113.153").flags.length === 1);
assert("snapshot of deleted server flagged", byLabel("pre-upgrade 2026-03").flags.length === 1);
assert("healthy protected server has no risk or waste", byLabel("web-2").flags.every((f) => f.kind === "info"));
assert("backup finding counts only the 20% surcharge", byLabel("db-primary").flags.find((f) => f.text.includes("backups"))?.monthly === 6.3);
assert("retiring server type flagged as risk with its date", byLabel("worker").flags.some((f) => f.kind === "risk" && /retired/.test(f.text)));
assert("server with no firewall flagged", byLabel("staging-app").flags.some((f) => f.kind === "risk" && /No Hetzner firewall/.test(f.text)));
assert("firewalled server not flagged as unprotected", !byLabel("web-1").flags.some((f) => /No Hetzner firewall/.test(f.text)));
assert("SSH open to the world flagged, HTTPS is not", byLabel("web-fw").flags.some((f) => f.kind === "risk" && f.text.includes("SSH (22)") && !f.text.includes("443")));
assert("port range 80-443 does not trip sensitive ports", byLabel("blog-fw").flags.length === 0);
assert("uploaded cert expiring in under 30 days flagged", byLabel("legacy-partner").flags.some((f) => f.kind === "risk"));
assert("managed cert with 70 days left not flagged", byLabel("acme.example").flags.length === 0);
assert("old snapshot flagged as waste", byLabel("db before 2025 migration").flags.some((f) => f.kind === "waste" && /days old/.test(f.text)));
assert("traffic near the allowance noted", byLabel("web-1").flags.some((f) => /outgoing traffic/i.test(f.text)));
assert("findings list risks before waste", g.totals.findings.findIndex((f) => f.kind === "waste") > g.totals.findings.findIndex((f) => f.kind === "risk"));
assert("waste findings sorted by money, largest first", g.totals.findings.filter((f) => f.kind === "waste")[0]!.monthly === 16.49);
assert("load balancer routes to both web servers", g.edges.filter((e) => e.kind === "routes").length === 2);
assert("robot server is not priced and says why", byLabel("ax52-archive").monthly === null && /Robot API/.test(byLabel("ax52-archive").costNote ?? ""));
assert("no flags array is shared between nodes", new Set(g.nodes.map((n) => n.flags)).size === g.nodes.length);

const text = summarize(g, "http://127.0.0.1:43390/");
assert("summary names the URL and the savings", text.includes("43390") && text.includes("Money you can save") && text.includes("Risks to fix"));
const mm = toMermaid(g);
assert("mermaid starts as a flowchart", mm.startsWith("flowchart LR"));
assert("mermaid strips quote and bracket characters from labels", !/\["[^"]*[\[\]{}<>][^"]*"\]/.test(mm));

// Projects from env, never duplicating a token and never leaking robot creds to extras.
const env = { HETZNER_CLOUD_TOKEN: "a", HETZNER_CLOUD_TOKEN_PROD: "b", HETZNER_CLOUD_TOKEN_DUP: "a", HETZNER_ACCOUNT_PROD: "Acme", HETZNER_ROBOT_USER: "u", HETZNER_ROBOT_PASSWORD: "p" };
const projects = discoverProjects(loadConfig(env), env);
assert("two distinct tokens become two projects", projects.length === 2);
assert("extra project gets its account label", projects.find((p) => p.name === "prod")?.account === "Acme");
assert("extra project does not inherit robot credentials", projects.find((p) => p.name === "prod")?.cfg.robotUser === undefined);
assert("default port is 43390", mapPortFromEnv({}) === DEFAULT_MAP_PORT && DEFAULT_MAP_PORT === 43390);
assert("port env below 1024 is ignored", mapPortFromEnv({ HETZNER_MCP_MAP_PORT: "80" }) === 43390);

// CSP: same-origin scripts only, no eval, no framing. (RENAME_OK: the old inline page and its test are gone.)
assert("CSP allows only same-origin scripts", CSP.includes("script-src 'self'") && !CSP.includes("unsafe-eval") && !/script-src[^;]*unsafe-inline/.test(CSP));
assert("CSP blocks framing and foreign connections", CSP.includes("frame-ancestors 'none'") && CSP.includes("connect-src 'self'"));

// Local project store: owner-only file, env tokens win, removal works.
const cfgHome = mkdtempSync(join(tmpdir(), "hzmap-"));
const senv = { XDG_CONFIG_HOME: cfgHome, HETZNER_CLOUD_TOKEN: "a" };
saveStored(senv, { name: "side", account: "Me", token: "t".repeat(64) });
saveStored(senv, { name: "dupe", account: "Me", token: "a" });
assert("store file is owner-only (0600)", (statSync(join(cfgHome, "hetzner-mcp", "projects.json")).mode & 0o777) === 0o600);
assert("store dir is owner-only (0700)", (statSync(join(cfgHome, "hetzner-mcp")).mode & 0o777) === 0o700);
const merged = discoverProjects(loadConfig(senv), senv, readStored(senv));
assert("saved project joins the map as a local project", merged.some((p) => p.name === "side" && p.source === "local"));
assert("a saved duplicate of an env token is ignored", !merged.some((p) => p.name === "dupe"));
assert("remove deletes only the named project", removeStored(senv, "Me", "side") && readStored(senv).length === 1);
const bad = async (body: Record<string, unknown>) =>
  connectProject({ base: loadConfig(senv), env: senv, demo: false }, body).then(() => 0, (e) => (e instanceof ActionError ? e.status : -1));
assert("connect rejects a malformed token before any network call", (await bad({ name: "x", token: "not a token" })) === 400);
assert("connect rejects a name with a slash", (await bad({ name: "a/b", token: "t".repeat(64) })) === 400);
const demoConnect = await connectProject({ base: loadConfig(senv), env: senv, demo: true }, { name: "x", token: "t".repeat(64) }).then(() => 0, (e) => e.status);
assert("connect is refused on sample data", demoConnect === 403);

// Server: loopback, host check, read-only, no token in output.
const handle = await startMapServer(loadConfig({}), { demo: true, port: 43390 + 7 });
const get = (path: string, host: string, method = "GET") =>
  new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port: handle.port, path, method, headers: { Host: host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
const okHost = `127.0.0.1:${handle.port}`;
assert("server binds loopback only", handle.url.startsWith("http://127.0.0.1:"));
const home = await get("/", okHost);
assert("page served with the CSP (or a build hint)", home.status === 503 || String(home.headers["content-security-policy"]) === CSP);
assert("asset path traversal refused", (await get("/assets/../../package.json", okHost)).status === 404);
assert("foreign Host header rejected (DNS rebinding)", (await get("/", "evil.example")).status === 421);
assert("API POST without the page header refused", (await get("/api/apply", okHost, "POST")).status === 403);
assert("page POST refused", (await get("/", okHost, "POST")).status === 405);
const post = (path: string, headers: Record<string, string>, body: string) =>
  new Promise<number>((resolve, reject) => {
    const h = { Host: okHost, "X-Hzmap": handle.token, "Content-Type": "application/json", ...headers };
    const r = request({ host: "127.0.0.1", port: handle.port, path, method: "POST", headers: h }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    r.on("error", reject);
    r.end(body);
  });
assert("POST from a foreign Origin refused", (await post("/api/apply", { Origin: "http://evil.example" }, "{}")) === 403);
const createBody = JSON.stringify({ project: "p:Acme GmbH/production", kind: "server", params: {}, confirm: true });
assert("create on sample data refused", (await post("/api/apply", {}, createBody)) === 403);
assert("delete on sample data refused", (await post("/api/delete", {}, JSON.stringify({ nodeId: "p:Acme GmbH/production/srv:11", typed: "web-1" }))) === 403);
assert("oversized body refused", (await post("/api/plan", {}, JSON.stringify({ x: "y".repeat(20000) }))) === 413);
assert("non-JSON body refused", (await post("/api/plan", { "Content-Type": "text/plain" }, "hi")) === 415);
assert("graph refused without the page header (cross-origin quota burn)", (await get("/api/graph?refresh=1", okHost)).status === 403);
const api = await new Promise<{ status: number; body: string }>((resolve, reject) => {
  const r = request({ host: "127.0.0.1", port: handle.port, path: "/api/graph", headers: { Host: okHost, "X-Hzmap": handle.token } }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
  });
  r.on("error", reject);
  r.end();
});
assert("graph endpoint returns the graph", api.status === 200 && JSON.parse(api.body).source === "sample");
assert("localhost Host also accepted", (await get("/healthz", `localhost:${handle.port}`)).status === 200);
const apiGet = (path: string) => new Promise<{ code: number; body: string }>((resolve, reject) => {
  const r = request({ host: "127.0.0.1", port: handle.port, path, headers: { Host: okHost, "X-Hzmap": handle.token } }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => resolve({ code: res.statusCode ?? 0, body }));
  });
  r.on("error", reject);
  r.end();
});
const status = await apiGet("/api/status");
const snapDemo = JSON.parse(status.body) as StatusSnapshot;
assert("demo /api/status returns sample statuses", status.code === 200 && snapDemo.entries["p:Acme GmbH/production/srv:12"]?.status === "migrating");
assert("demo /api/status carries load balancer health", snapDemo.entries["p:Acme GmbH/production/lb:31"]?.health?.unhealthy === 1);
assert("/api/status refused without the page header", (await get("/api/status", okHost)).status === 403);
assert("/api/status rejects an unknown workspace", (await apiGet("/api/status?workspace=nope")).code === 400);
const again = await startMapServer(loadConfig({}), { demo: true });
assert("second start reuses the running server", again.port === handle.port);
const withKey = (key: string) => new Promise<number>((resolve, reject) => {
  const r = request({ host: "127.0.0.1", port: handle.port, path: "/api/meta", headers: { Host: okHost, "X-Hzmap": key } }, (res) => {
    res.resume();
    res.on("end", () => resolve(res.statusCode ?? 0));
  });
  r.on("error", reject);
  r.end();
});
assert("the map URL carries the per-launch key in its fragment", /^[0-9a-f]{64}$/.test(handle.token) && handle.url.endsWith(`/#k=${handle.token}`));
assert("the old fixed header value 1 is refused", (await withKey("1")) === 403);
assert("a wrong key of the right length is refused", (await withKey("0".repeat(64))) === 403);
assert("the per-launch key is accepted", (await withKey(handle.token)) === 200);
await handle.close();

// Sample data never shows the names of the real workspace, accounts or projects.
{
  const denv: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "hz-demo-")),
    HETZNER_CLOUD_TOKEN: "t".repeat(64),
    HETZNER_WORKSPACE_NAME: "SecretWorkspace",
    HETZNER_ACCOUNT_NAME: "SecretAccount",
    HETZNER_CLOUD_TOKEN_ZZ: "z".repeat(64),
  };
  saveStored(denv, { name: "secretproject", account: "SecretStored", workspace: "SecretWs2", token: "s".repeat(64) });
  const dh = await startMapServer(loadConfig(denv), { demo: true, env: denv, port: 43462 });
  const dget = (path: string) => new Promise<string>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port: dh.port, path, headers: { Host: `127.0.0.1:${dh.port}`, "X-Hzmap": dh.token } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    });
    r.on("error", reject);
    r.end();
  });
  const bodies = [await dget("/api/meta"), await dget("/api/workspaces"), await dget("/api/graph")];
  assert("demo meta, workspaces and graph carry no real names", bodies.every((b) => b.length > 20 && !/secret/i.test(b)));
  assert("demo meta lists the sample projects", (JSON.parse(bodies[0]!) as { projects: Array<{ name: string }> }).projects.some((p) => p.name === "production"));
  await dh.close();
}

// Every location and server type code on the map has a plain-language name.
for (const code of ["fsn1", "nbg1", "hel1", "ash", "hil", "sin"]) assert(`location ${code} has a place name`, placeName(code) !== null && explainLocation(code) !== null);
for (const t of ["cx23", "cpx22", "cax11", "ccx13"]) assert(`server type ${t} has a family`, familyOf(t) !== null);
assert("cpx is not mistaken for cx", familyOf("cpx22") === "x86 CPU, shared, regular");
assert("unknown location stays null", placeName("zzz9") === null);
for (const n of g.nodes.filter((x) => x.kind === "location")) assert(`sample location ${n.label} is named`, placeName(n.label) !== null);
const srv = g.nodes.find((x) => x.kind === "server" && typeof x.details.type === "string")!;
assert("server type explains itself in a sentence", /^\w+ is .+\.$/.test(explainType(srv) ?? ""));

// Live status: only what Hetzner returns, never a fresh-looking Live on missing or failed data.
for (const [s, want] of [["running", "live"], ["initializing", "changing"], ["starting", "changing"], ["stopping", "changing"], ["migrating", "changing"], ["rebuilding", "changing"], ["off", "off"], ["deleting", "interrupted"], ["unknown", "unknown"], ["weird", "unknown"]] as const) {
  assert(`server status ${s} maps to ${want}`, serverState(s) === want);
}
assert("absent server status is unknown, never live", serverState(undefined) === "unknown");
assert("robot ready is live, in process is changing, else unknown", robotState("ready") === "live" && robotState("in process") === "changing" && robotState(undefined) === "unknown");
assert("all healthy targets is live", healthState({ healthy: 2, unhealthy: 0, unknown: 0 }) === "live");
assert("one unhealthy target interrupts", healthState({ healthy: 3, unhealthy: 1, unknown: 0 }) === "interrupted");
assert("no targets or unknown checks is unknown", healthState({ healthy: 0, unhealthy: 0, unknown: 0 }) === "unknown" && healthState({ healthy: 1, unhealthy: 0, unknown: 1 }) === "unknown" && healthState(undefined) === "unknown");
const th = targetHealth([{ health_status: [{ status: "healthy" }, { status: "unhealthy" }] }, { type: "label_selector", targets: [{ health_status: [{ status: "unknown" }] }] }]);
assert("target health counts ports and label selector targets", th.healthy === 1 && th.unhealthy === 1 && th.unknown === 1);
assert("sample load balancer carries its target health", byLabel("prod-lb").health?.unhealthy === 1 && byLabel("prod-lb").health?.healthy === 1);
const lk = liveLookup(g.nodes, null, false);
assert("sample shows every state", ["live", "changing", "off", "interrupted"].every((st) => [...lk.views.values()].some((v) => v.state === st)));
assert("production roll-up counts the migrating server", lk.rollups.get("p:Acme GmbH/production")?.text === "3 of 4 live · 1 changing");
assert("staging roll-up counts off separately, not as interrupted", lk.rollups.get("p:Acme GmbH/staging")?.text === "1 of 2 live · 1 off" && lk.rollups.get("p:Acme GmbH/staging")?.tone === "live");
assert("all running reads Live", lk.rollups.get("p:Side projects/blog")?.text === "Live");
const noStatus = { ...byLabel("web-1"), status: undefined };
assert("server with no status shows Unknown", liveOf(noStatus, null, false)?.state === "unknown");
const failedView = liveOf(byLabel("web-1"), null, true)!;
assert("failed poll marks stale and keeps last known", failedView.state === "stale" && failedView.known === "live" && failedView.stale);
const staleRoll = rollup([failedView]);
assert("stale roll-up is labelled last known", staleRoll?.tone === "stale" && staleRoll.text === "Last known: Live");
const badRoll = rollup([liveOf(byLabel("web-1"), null, false)!, liveOf(noStatus, null, false)!]);
assert("unknown server counts as interrupted in the roll-up", badRoll?.text === "1 of 2 interrupted" && badRoll.tone === "interrupted");
const snap: StatusSnapshot = { checkedAt: new Date().toISOString(), entries: { [byLabel("web-1").id]: { status: "off" } }, failedProjects: [] };
assert("poll value overrides the graph", liveOf(byLabel("web-1"), snap, false)?.state === "off");
assert("a server missing from a fresh poll is unknown", liveOf(byLabel("db-primary"), snap, false)?.state === "unknown");
assert("a project that failed to poll is stale", liveOf(byLabel("web-1"), { ...snap, failedProjects: ["p:Acme GmbH/production"] }, false)?.state === "stale");
const ref = (name: string) => ({ name, account: "A", workspace: "w", source: "env" as const, cfg: loadConfig({}) });
const okRef = ref("ok");
const polledPaths = new Set<string>();
const polled = await collectStatuses(loadConfig({}), {}, {
  projects: [okRef, ref("broken")],
  list: async (cfg, path) => {
    polledPaths.add(path);
    if (cfg !== okRef.cfg) throw new Error("401 unauthorized");
    return path === "/servers" ? [{ id: 1, status: "running" }] : [{ id: 2, targets: [{ health_status: [{ status: "unhealthy" }] }] }];
  },
});
assert("status poll reads only servers and load balancers", [...polledPaths].sort().join() === "/load_balancers,/servers");
assert("status poll maps ids like the graph", polled.entries["p:A/ok/srv:1"]?.status === "running" && polled.entries["p:A/ok/lb:2"]?.health?.unhealthy === 1);
assert("a failing project is reported, not silently live", polled.failedProjects.includes("p:A/broken") && !polled.entries["p:A/broken/srv:1"]);

// The browser opener is an absolute path, and a missing one never crashes the map.
{
  const u = "http://127.0.0.1:1/#k=x";
  const mac = openerFor(u, "darwin", {}, () => true);
  const lin = openerFor(u, "linux", {}, () => true);
  const win = openerFor(u, "win32", { SystemRoot: "D:" + win32.sep + "Win" }, () => true);
  assert("openers are absolute paths, never looked up on PATH", mac?.cmd === "/usr/bin/open" && lin?.cmd === "/usr/bin/xdg-open" && win32.isAbsolute(win?.cmd ?? "") && win!.cmd.endsWith("cmd.exe"));
  assert("no xdg-open on Linux means no opener, not a PATH lookup", openerFor(u, "linux", {}, () => false) === undefined);
  let crashed = false;
  const onCrash = () => (crashed = true);
  process.once("uncaughtException", onCrash);
  openBrowser(u, { cmd: join(tmpdir(), "hz-no-such-opener"), args: [u] });
  await new Promise((r) => setTimeout(r, 300));
  process.off("uncaughtException", onCrash);
  assert("a missing opener does not crash the map", !crashed);
}

process.stdout.write(`\n${passed}/${total} map checks passed\n`);
if (passed !== total) process.exitCode = 1;
