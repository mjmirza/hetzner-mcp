/**
 * Offline tests for resource ids on the curated write tools. No network.
 * A bad id must be refused before any request, including zero and leading zeros
 * written as text. A valid id, as a number or a canonical string, is sent as-is.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { id } from "../src/tools/write-cloud.js";
import { registerAllTools } from "../src/tools/register.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

const FIFTEEN = 999999999999999;
const shown = (v: unknown) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : JSON.stringify(v));

for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e16, null, "", "0", "00", "01", "000000000000001", "+12", " 12", "12 ", "12abc", "1.5", "1e2"]) {
  assert(`id schema rejects ${shown(bad)}`, !id.safeParse(bad).success);
}
for (const good of [1, 42, FIFTEEN, "1", "42", "10", String(FIFTEEN)]) {
  const parsed = id.safeParse(good);
  assert(`id schema accepts ${JSON.stringify(good)}`, parsed.success && parsed.data === good);
}

interface Seen {
  method: string;
  path: string;
  body?: string;
}
const calls: Seen[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  calls.push({ method: (init?.method ?? "GET").toUpperCase(), path: u.pathname, body: typeof init?.body === "string" ? init.body : undefined });
  return Response.json({});
}) as typeof fetch;

const cfg = loadConfig({ HETZNER_CLOUD_TOKEN: "goodtoken", HETZNER_MCP_ACTION_WAIT_MS: "0" });
const readOnly = loadConfig({ HETZNER_CLOUD_TOKEN: "goodtoken", HETZNER_MCP_READONLY: "1", HETZNER_MCP_ACTION_WAIT_MS: "0" });

async function caller(config: ReturnType<typeof loadConfig>) {
  const server = new McpServer({ name: "hetzner-mcp", version: "test" });
  registerAllTools(server, config, {});
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content?: Array<{ text?: string }>; isError?: boolean };
    return { text: (r.content ?? []).map((c) => c.text ?? "").join("\n"), isError: !!r.isError };
  };
}

const call = await caller(cfg);
const callRo = await caller(readOnly);

const DELETES: Array<[string, string]> = [
  ["cloud_delete_server", "/servers"],
  ["cloud_delete_volume", "/volumes"],
  ["cloud_delete_network", "/networks"],
  ["cloud_delete_firewall", "/firewalls"],
  ["cloud_delete_load_balancer", "/load_balancers"],
  ["cloud_delete_floating_ip", "/floating_ips"],
  ["cloud_delete_primary_ip", "/primary_ips"],
  ["cloud_delete_ssh_key", "/ssh_keys"],
  ["cloud_delete_placement_group", "/placement_groups"],
];

for (const [tool, path] of DELETES) {
  for (const bad of ["0", "00", "01", 0, -1, "1.5"]) {
    calls.length = 0;
    const refused = await call(tool, { id: bad, confirm: true });
    assert(`${tool} refuses id ${JSON.stringify(bad)} before any request`, refused.isError && calls.length === 0);
  }
  calls.length = 0;
  const sent = await call(tool, { id: "42", confirm: true });
  const hit = calls.find((c) => c.method === "DELETE" && c.path.endsWith(`${path}/42`));
  assert(`${tool} sends a confirmed string id on ${path}/42`, !sent.isError && !!hit && calls.length === 1);

  calls.length = 0;
  const numeric = await call(tool, { id: 42, confirm: true });
  const hitNum = calls.find((c) => c.method === "DELETE" && c.path.endsWith(`${path}/42`));
  assert(`${tool} sends a confirmed numeric id on ${path}/42`, !numeric.isError && !!hitNum && calls.length === 1);
}

calls.length = 0;
const unconfirmed = await call("cloud_delete_volume", { id: "42" });
assert("an unconfirmed delete is refused and not sent", unconfirmed.isError && /DESTRUCTIVE GUARD/.test(unconfirmed.text) && calls.length === 0);

calls.length = 0;
const locked = await callRo("cloud_delete_server", { id: 42, confirm: true });
assert("read-only mode refuses a confirmed delete before any request", locked.isError && /read-only/.test(locked.text) && calls.length === 0);

calls.length = 0;
const attachBad = await call("cloud_attach_volume", { id: "01", server: 3 });
assert("attach refuses a leading-zero volume id", attachBad.isError && calls.length === 0);

calls.length = 0;
const attach = await call("cloud_attach_volume", { id: "7", server: 3 });
const attachHit = calls.find((c) => c.method === "POST" && c.path.endsWith("/volumes/7/actions/attach"));
assert("attach sends the volume id and the server", !attach.isError && !!attachHit && JSON.parse(attachHit.body ?? "{}").server === 3 && calls.length === 1);

calls.length = 0;
const detach = await call("cloud_detach_volume", { id: 7 });
assert("detach without confirm is refused and not sent", detach.isError && /DESTRUCTIVE GUARD/.test(detach.text) && calls.length === 0);

calls.length = 0;
const detachBad = await call("cloud_detach_volume", { id: "00", confirm: true });
assert("detach refuses id 00 even with confirm", detachBad.isError && calls.length === 0);

calls.length = 0;
const unassign = await call("cloud_unassign_floating_ip", { id: "9" });
assert("unassign without confirm is refused and not sent", unassign.isError && /DESTRUCTIVE GUARD/.test(unassign.text) && calls.length === 0);

calls.length = 0;
const assign = await call("cloud_assign_primary_ip", { id: 8, assignee_id: 4 });
const assignHit = calls.find((c) => c.method === "POST" && c.path.endsWith("/primary_ips/8/actions/assign"));
const assignBody = JSON.parse(assignHit?.body ?? "{}") as { assignee_id?: number; assignee_type?: string };
assert(
  "assign sends the primary IP id and the server",
  !assign.isError && assignBody.assignee_id === 4 && assignBody.assignee_type === "server" && calls.length === 1,
);

globalThis.fetch = realFetch;

process.stdout.write(`\n${passed}/${total} resource-id checks passed\n`);
if (passed !== total) process.exitCode = 1;
