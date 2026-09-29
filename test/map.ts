/** Offline tests for the infrastructure map: cost model, findings, projects, server security. */
import { request } from "node:http";
import { loadConfig } from "../src/config.js";
import { sampleGraph } from "../src/map/sample.js";
import { discoverProjects } from "../src/map/projects.js";
import { startMapServer, mapPortFromEnv, DEFAULT_MAP_PORT } from "../src/map/server.js";
import { summarize, toMermaid } from "../src/map/summary.js";
import { renderPage } from "../src/map/page.js";

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
assert("traffic near the allowance noted", byLabel("web-1").flags.some((f) => /outgoing traffic/.test(f.text)));
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

// Page: nonce applied, no external origins, no innerHTML sinks.
const page = renderPage("NONCE123");
assert("page carries the nonce on script and style", (page.match(/nonce="NONCE123"/g) ?? []).length === 2);
assert("page makes no external requests", !/https?:\/\/(?!www\.w3\.org)/.test(page));
assert("page never uses innerHTML", !page.includes("innerHTML"));

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
assert("page served with a CSP", String((await get("/", okHost)).headers["content-security-policy"]).includes("default-src 'none'"));
assert("foreign Host header rejected (DNS rebinding)", (await get("/", "evil.example")).status === 421);
assert("POST refused, read-only", (await get("/api/graph", okHost, "POST")).status === 405);
const api = await get("/api/graph", okHost);
assert("graph endpoint returns the graph", api.status === 200 && JSON.parse(api.body).source === "sample");
assert("localhost Host also accepted", (await get("/healthz", `localhost:${handle.port}`)).status === 200);
const again = await startMapServer(loadConfig({}), { demo: true });
assert("second start reuses the running server", again.port === handle.port);
await handle.close();

process.stdout.write(`\n${passed}/${total} map checks passed\n`);
if (passed !== total) process.exitCode = 1;
