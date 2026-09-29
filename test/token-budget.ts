/** Token budget: the tool list and the common responses must stay small. Fails on regressions. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { registerAllTools } from "../src/tools/register.js";
import { formatResult } from "../src/format.js";
import { sampleGraph } from "../src/map/sample.js";
import { toMermaid } from "../src/map/summary.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

const cfg = loadConfig({ HETZNER_CLOUD_TOKEN: "x".repeat(64), HETZNER_ROBOT_USER: "u", HETZNER_ROBOT_PASSWORD: "p" });
async function list(env: NodeJS.ProcessEnv) {
  const server = new McpServer({ name: "hetzner-mcp", version: "test" });
  registerAllTools(server, cfg, env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "budget", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}
const tools = await list({});
const lean = await list({ HETZNER_MCP_TOOLS: "lean" });
const leanChars = JSON.stringify(lean).length;
const listChars = JSON.stringify(tools).length;
if (process.env.BUDGET_DETAIL) for (const t of [...tools].sort((x, y) => JSON.stringify(y).length - JSON.stringify(x).length).slice(0, 12)) process.stdout.write(`  ${JSON.stringify(t).length} ${t.name}\n`);
process.stdout.write(`tools=${tools.length} list=${listChars} chars (about ${Math.round(listChars / 4)} tokens)\n`);
process.stdout.write(`lean: tools=${lean.length} list=${leanChars} chars (about ${Math.round(leanChars / 4)} tokens)\n`);
// Budgets sit just above the measured size, so any growth fails here first. Lower them, never raise casually.
assert("full tool list stays under 38000 chars", listChars < 38000);
assert("lean tool list stays under 24000 chars", leanChars < 24000);
assert("lean keeps the request, write, map and audit tools", ["cloud_request", "cloud_create_server", "infra_map", "infra_audit"].every((n) => lean.some((t) => t.name === n)));
assert("lean drops the list shortcuts", !lean.some((t) => t.name === "cloud_list_servers"));
assert("no tool repeats its name as its title", tools.every((t) => t.title !== t.name));
assert("every tool still has a description", tools.every((t) => (t.description ?? "").length > 10));

// Compact view: nested objects collapse to a name, empty values vanish, no indentation.
const fake = { servers: [{ id: 1, name: "web", status: "running", server_type: { name: "cx23", cores: 2, prices: [{ location: "fsn1", price_monthly: { gross: "5.49" } }] }, location: { name: "fsn1", city: "Falkenstein" }, labels: {}, created: "2026-01-01" }] };
const out = formatResult(fake, false);
assert("compact view collapses nested objects to their name", out.includes('"server_type":"cx23"') && out.includes('"location":"fsn1"'));
assert("compact view drops prices from nested objects", !out.includes("price_monthly"));
assert("compact view drops empty labels", !out.includes("labels"));
assert("compact view has no indentation", !out.includes("\n  "));
assert("verbose still returns everything", formatResult(fake, true).includes("price_monthly"));

// Responses of the tools an AI calls most, on the sample estate.
{
  const server = new McpServer({ name: "hetzner-mcp", version: "test" });
  registerAllTools(server, cfg, {});
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "budget", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
    return r.content.map((c) => c.text).join("\n");
  };
  const summary = await call("infra_audit", { demo: true });
  const page1 = await call("infra_audit", { demo: true, full: true });
  const page2 = await call("infra_audit", { demo: true, full: true, page: 2 });
  const one = await call("infra_audit", { demo: true, finding: 1 });
  const map = await call("infra_map", { demo: true, serve: false });
  const mermaid = await call("infra_map", { demo: true, serve: false, mermaid: true });
  process.stdout.write(`sizes: audit=${summary.length} full-page=${page1.length} finding=${one.length} map=${map.length} map+mermaid=${mermaid.length}\n`);
  assert("audit summary under 1200 chars", summary.length < 1200);
  assert("one audit finding under 1500 chars", one.length < 1500);
  assert("full audit is paged, page 1 points to page 2", page1.includes("page=2"));
  assert("full audit page 2 continues the numbering", page2.includes("## 11."));
  assert("full audit page under 9000 chars", page1.length < 9000);
  assert("map summary under 3500 chars", map.length < 3500);
  assert("map with mermaid under 7000 chars", mermaid.length < 7000);
  await client.close();
}
const big = { ...sampleGraph(), nodes: Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, kind: "server" as const, label: `s${i}`, account: "A", monthly: 1, flags: [], details: {} })), edges: [] };
const drawn = toMermaid(big);
assert("mermaid is capped on a big estate", drawn.split("\n").length < 170 && drawn.includes("more resources not drawn"));

process.stdout.write(`\n${passed}/${total} token-budget checks passed\n`);
if (passed !== total) process.exitCode = 1;
