/** Offline tests for workspaces: grouping, bounded collection, the API, bulk import. No network. */
import { request } from "node:http";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { collectGraph } from "../src/map/collect.js";
import { settleWithLimit } from "../src/map/limit.js";
import { discoverProjects, listWorkspaces, resolveTarget } from "../src/map/projects.js";
import { importProjects, maskToken, parseImport, runProjects } from "../src/map/projects-cli.js";
import { startMapServer } from "../src/map/server.js";
import { readStored, saveStored, storeDir } from "../src/map/store.js";
import { mkdirSync, utimesSync } from "node:fs";
import { sampleGraph } from "../src/map/sample.js";
import { toMermaid } from "../src/map/summary.js";
import { auditMarkdown } from "../src/map/audit.js";
import type { InfraGraph } from "../src/map/types.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean, detail = ""): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}${cond || !detail ? "" : `  -> ${detail.slice(0, 200)}`}\n`);
}
const tok = (c: string) => c.repeat(64);
const home = () => mkdtempSync(join(tmpdir(), "hzws-"));

// Backward compatibility: nothing configured about workspaces means one default workspace.
const legacy = { HETZNER_CLOUD_TOKEN: tok("a"), HETZNER_CLOUD_TOKEN_PROD: tok("b"), HETZNER_ACCOUNT_PROD: "Acme" };
const lp = discoverProjects(loadConfig(legacy), legacy);
assert("legacy projects all join the Personal workspace", lp.length === 2 && lp.every((p) => p.workspace === "Personal"));
const lws = listWorkspaces(lp, legacy);
assert("legacy setup lists exactly one workspace", lws.length === 1 && lws[0]!.name === "Personal" && lws[0]!.projects === 2 && lws[0]!.accounts === 2);
const envWs = { ...legacy, HETZNER_WORKSPACE_PROD: "Acme client", HETZNER_WORKSPACE_NAME: "Mine" };
const ep = discoverProjects(loadConfig(envWs), envWs);
assert("env HETZNER_WORKSPACE_<NAME> assigns a workspace", ep.find((p) => p.name === "prod")?.workspace === "Acme client");
assert("HETZNER_WORKSPACE_NAME renames the default", ep.find((p) => p.name === "default")?.workspace === "Mine");
assert("default workspace is listed first", listWorkspaces(ep, envWs)[0]!.name === "Mine");
assert("robot creds count an account in the default workspace", listWorkspaces([], {}, true)[0]?.accounts === 1);

// Targets for the MCP tool.
assert("target resolves a workspace", JSON.stringify(resolveTarget(ep, "Acme client", envWs)) === JSON.stringify({ workspace: "Acme client" }));
assert("target resolves one project", "project" in resolveTarget(ep, "Acme client/Acme/prod", envWs));
const unknownT = resolveTarget(ep, "Nope", envWs);
assert("unknown target explains how to list names", "error" in unknownT && /projects list/.test(unknownT.error) && /Acme client/.test(unknownT.error));
assert("malformed target rejected", "error" in resolveTarget(ep, "a/b", envWs));

// Bounded concurrency: a fake task counts how many run at once.
let live = 0;
let peak = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settled = await settleWithLimit(Array.from({ length: 25 }, (_, i) => i), 4, async (i) => {
  live++;
  peak = Math.max(peak, live);
  await sleep(5 + (i % 3));
  live--;
  if (i === 7) throw new Error("boom");
  return i * 2;
});
assert("never more than 4 in flight", peak === 4, `peak ${peak}`);
assert("one failure does not stop the rest", settled.filter((r) => r.status === "fulfilled").length === 24 && settled[7]!.status === "rejected");
assert("results keep input order", settled[3]!.status === "fulfilled" && settled[3].value === 6);

// collectGraph: only the asked workspace is read, with bounded concurrency, errors isolated.
const many: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: home() };
for (let i = 0; i < 12; i++) saveStored(many, { name: `p${i}`, account: `Client ${i % 3}`, workspace: `WS${i % 3}`, token: tok(String.fromCharCode(97 + i)) });
let inFlight = 0;
let maxIn = 0;
const touched: string[] = [];
const collector = async (ref: { name: string; account: string }) => {
  inFlight++;
  maxIn = Math.max(maxIn, inFlight);
  touched.push(ref.name);
  await sleep(10);
  inFlight--;
  if (ref.name === "p3") throw new Error("token revoked");
  return { nodes: [], edges: [] };
};
const pricingLoader = async () => ({ currency: "EUR", vatRate: "19", serverTypes: new Map(), lbTypes: new Map(), volumePerGb: null, imagePerGb: null, backupPct: null, primaryIp: new Map(), floatingIp: new Map() }) as never;
const g0 = await collectGraph(loadConfig(many), many, { workspace: "WS0", collector, pricingLoader });
assert("only the active workspace is collected", touched.length === 4 && touched.every((n) => ["p0", "p3", "p6", "p9"].includes(n)), touched.join(","));
assert("graph says which workspace it is", g0.workspace === "WS0");
assert("a failing token becomes project_unreadable, the rest survive", g0.nodes.some((n) => n.flags.some((f) => f.code === "project_unreadable") && n.project === "p3") && g0.totals.byProject.length === 1);
touched.length = 0;
await collectGraph(loadConfig(many), many, { collector, pricingLoader });
assert("collect without a workspace still reads everything, 4 at a time", touched.length === 12 && maxIn === 4, `n=${touched.length} max=${maxIn}`);
let pricingCalls = 0;
const flakyPricing = async () => {
  pricingCalls++;
  if (pricingCalls === 1) throw new Error("401");
  return pricingLoader();
};
const gp = await collectGraph(loadConfig(many), many, { workspace: "WS1", collector, pricingLoader: flakyPricing });
assert("a bad first token does not block prices", pricingCalls === 2 && gp.currency === "EUR");

// Server: /api/workspaces never leaks tokens, ?workspace is validated, one collect per workspace.
const senv: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: home(), HETZNER_CLOUD_TOKEN: tok("z") };
saveStored(senv, { name: "shop", account: "Client A", workspace: "Client A", token: tok("y") });
const asked: Array<string | undefined> = [];
const fake = async (ws: string | undefined): Promise<InfraGraph> => {
  asked.push(ws);
  return { source: "live", generatedAt: "", currency: "EUR", vatNote: "", nodes: [], edges: [], totals: { monthly: 0, byProject: [], byKind: [], topDrivers: [], findings: [] }, caveats: [], workspace: ws };
};
const handle = await startMapServer(loadConfig(senv), { env: senv, port: 43390 + 21, collect: fake });
const okHost = `127.0.0.1:${handle.port}`;
const get = (path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port: handle.port, path, headers: { Host: okHost, "X-Hzmap": "1" } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    r.on("error", reject);
    r.end();
  });
const wsRes = await get("/api/workspaces");
const wsJson = JSON.parse(wsRes.body) as { default: string; workspaces: Array<{ name: string; accounts: number; projects: number }> };
assert("/api/workspaces lists names and counts", wsRes.status === 200 && wsJson.default === "Personal" && wsJson.workspaces.length === 2 && wsJson.workspaces[1]!.name === "Client A");
assert("/api/workspaces never contains a token", !wsRes.body.includes(tok("y").slice(0, 20)) && !wsRes.body.includes(tok("z").slice(0, 20)) && !/token/i.test(wsRes.body));
const g1 = await get("/api/graph");
assert("graph without a workspace loads the default", g1.status === 200 && JSON.parse(g1.body).workspace === "Personal" && asked[0] === "Personal");
const g2 = await get("/api/graph?workspace=Client%20A");
assert("graph loads the asked workspace", g2.status === 200 && JSON.parse(g2.body).workspace === "Client A");
assert("unknown workspace is a 400", (await get("/api/graph?workspace=Evil")).status === 400);
assert("empty workspace is a 400", (await get("/api/graph?workspace=")).status === 400);
await get("/api/graph?workspace=Client%20A");
assert("a workspace is cached, not re-collected", asked.filter((w) => w === "Client A").length === 1, asked.join(","));
const meta = JSON.parse((await get("/api/meta")).body) as { projects: Array<{ workspace: string }> };
assert("meta tells each project its workspace", meta.projects.some((p) => p.workspace === "Client A"));
await handle.close();

// Bulk import: CSV and JSON, duplicates, bad rows with numbers, 0600, masked list.
const csv = [
  "workspace,account,project,token",
  `Client B,Client B GmbH,prod,${tok("c")}`,
  `"Client, C",Client C,staging,${tok("d")}`,
  `Client B,Client B GmbH,dup-token,${tok("c")}`,
  "Client B,Client B GmbH,short,abc",
  "only,three,fields",
  "",
  "# a comment",
  `Client B,Client B GmbH,prod,${tok("e")}`,
].join("\r\n");
const parsed = parseImport(csv, "x.csv");
assert("CSV header skipped, quoted comma kept", parsed.rows.length === 4 && parsed.rows[1]!.workspace === "Client, C");
assert("malformed rows carry their row number", parsed.invalid.some((b) => b.row === 5 && /token/.test(b.reason)) && parsed.invalid.some((b) => b.row === 6 && /4 fields/.test(b.reason)));
const ienv: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: home() };
const rep = await importProjects(ienv, csv, "x.csv");
assert("import adds the two good rows", rep.added.length === 2, JSON.stringify(rep.added.map((r) => r.project)));
assert("duplicate token and duplicate project reported", rep.duplicates.length === 2 && rep.duplicates.some((d) => d.row === 4) && rep.duplicates.some((d) => d.row === 9));
assert("store keeps workspaces", readStored(ienv).some((p) => p.workspace === "Client, C"));
assert("store file is 0600 after import", (statSync(join(ienv.XDG_CONFIG_HOME!, "hetzner-mcp", "projects.json")).mode & 0o777) === 0o600);
const again = await importProjects(ienv, csv, "x.csv");
assert("re-import is idempotent", again.added.length === 0 && readStored(ienv).length === 2);
const json = JSON.stringify([
  { workspace: "Client D", account: "Client D", project: "web", token: tok("f") },
  { workspace: "Client D", account: "Client D", project: "bad/name", token: tok("g") },
  { workspace: "Client X", account: "Client B GmbH", project: "prod", token: tok("h") },
]);
const jrep = await importProjects(ienv, json, "x.json");
assert("JSON import adds good entries", jrep.added.length === 1 && jrep.added[0]!.project === "web");
assert("JSON bad entry rejected with its index", jrep.invalid.length === 1 && jrep.invalid[0]!.row === 2);
assert("same account and project in another workspace is refused", jrep.duplicates.length === 1 && /unique/.test(jrep.duplicates[0]!.reason));
assert("non-array JSON rejected", parseImport('{"a":1}', "x.json").invalid.length === 1);
const vrep = await importProjects({ XDG_CONFIG_HOME: home() }, `W,A,p1,${tok("i")}\nW,A,p2,${tok("j")}`, "v.csv", {
  verify: true,
  verifier: async (_b, t) => {
    if (t === tok("j")) throw Object.assign(new Error("no"), { status: 401 });
  },
});
assert("--verify keeps good tokens and drops rejected ones", vrep.added.length === 1 && vrep.failed.length === 1 && /rejected/.test(vrep.failed[0]!.reason));

// CLI output never contains a full token.
let printed = "";
const capture = (s: string) => void (printed += s);
const file = join(ienv.XDG_CONFIG_HOME!, "more.csv");
writeFileSync(file, `Client E,Client E,api,${tok("k")}\n`);
const code = await runProjects(["import", file], ienv, capture);
assert("import CLI succeeds on a clean file", code === 0 && /Added 1/.test(printed), printed);
printed = "";
await runProjects(["list"], ienv, capture);
assert("list masks tokens to the last 4 chars", printed.includes(maskToken(tok("k"))) && !printed.includes(tok("k").slice(0, 8)), printed);
printed = "";
await runProjects(["list", "--json"], ienv, capture);
const listed = JSON.parse(printed) as Array<{ token: string }>;
assert("list --json masks every token", listed.length === 4 && listed.every((p) => /^\*{4}.{4}$/.test(p.token)));
printed = "";
assert("remove needs the full path", (await runProjects(["remove", "Client E"], ienv, capture)) === 2);
assert("remove deletes one project", (await runProjects(["remove", "Client E/Client E/api"], ienv, capture)) === 0 && readStored(ienv).length === 3);
assert("remove of a missing project fails", (await runProjects(["remove", "Client E/Client E/api"], ienv, capture)) === 1);
assert("a missing file exits 2", (await runProjects(["import", file.replace("more", "none")], ienv, capture)) === 2);
writeFileSync(file, "W,A,p,short\n");
assert("a file with bad rows exits 1", (await runProjects(["import", file], ienv, capture)) === 1);

// Regressions found by Codex attack pass 2.
{
  const NL = String.fromCharCode(10);
  // Three revoked tokens first must not hide a valid fourth project.
  let calls = 0;
  const lateGood = async () => {
    calls++;
    if (calls <= 3) throw new Error("401");
    return pricingLoader();
  };
  touched.length = 0;
  const g4 = await collectGraph(loadConfig(many), many, { workspace: "WS0", collector, pricingLoader: lateGood });
  assert("prices load from the 4th token when the first 3 are revoked", calls === 4 && touched.length === 4 && !g4.nodes.some((n) => n.project !== "p3" && n.flags.some((f) => f.code === "project_unreadable")), `calls=${calls} touched=${touched.length}`);

  // Short or malformed stored tokens are never printed whole.
  assert("a short token is fully hidden", maskToken("abc") === "****" && !maskToken("abcdefghij").includes("ghij"));
  assert("a real token still shows its last 4", maskToken(tok("q") + "WXYZ") === "****WXYZ");

  // A crashed import left its lock behind; the next write takes it over instead of hanging.
  const lenv: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: home() };
  mkdirSync(join(storeDir(lenv), ".lock"), { recursive: true });
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(storeDir(lenv), ".lock"), old, old);
  saveStored(lenv, { name: "x", account: "A", token: tok("x") });
  assert("a stale lock is taken over and the write lands", readStored(lenv).some((p) => p.name === "x"));

  // Names with a pipe or a newline cannot break the Markdown table or the Mermaid diagram.
  const g = sampleGraph();
  const evil = `Evil|Co${NL}flowchart`;
  const md = auditMarkdown({ ...g.audit!, scopes: [{ account: evil, project: "p", score: 50, findings: 1, monthlySaving: 0 }] });
  const row = md.split(NL).find((l) => l.includes("Evil"))!;
  assert("a pipe in a name is escaped in the report table", row.split(" | ").length === 5 && !row.includes(NL));
  const mer = toMermaid({ ...g, nodes: g.nodes.map((n, i) => (i === 0 ? { ...n, label: evil } : n)) });
  assert("a newline in a name cannot inject Mermaid lines", !mer.split(NL).some((l) => l.trim() === "flowchart"));

  // Malformed CSV quoting is rejected with a row number instead of silently merged.
  const bad = parseImport(`"Client"x,Acc,prod,${tok("m")}`, "c.csv");
  assert("text after a closing quote is rejected", bad.rows.length === 0 && /Row 1/.test(bad.invalid[0]?.reason ?? ""), JSON.stringify(bad.invalid));
  const bad2 = parseImport(`Cli"ent,Acc,prod,${tok("m")}`, "c.csv");
  assert("a quote in the middle of a field is rejected", bad2.rows.length === 0 && bad2.invalid.length === 1);
  const good = parseImport(`"Client, Inc",Acc,prod,${tok("m")}`, "c.csv");
  assert("a quoted comma still works", good.rows.length === 1 && good.rows[0]!.workspace === "Client, Inc");
}

process.stdout.write(`\n${passed}/${total} workspace checks passed\n`);
if (passed !== total) process.exitCode = 1;
