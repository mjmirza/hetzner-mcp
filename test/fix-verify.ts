/**
 * End-to-end verification for the cloud_request write-body fix.
 *
 * Spawns the built MCP server over stdio (the exact artifact a client loads),
 * then:
 *   1. tools/list  - asserts the `body` parameter has a non-empty schema, the
 *      property that stops MCP clients (Claude Code) from dropping it.
 *   2. tools/call  - creates a FREE placement group through cloud_request with a
 *      JSON-object body and a JSON-string body, proving the body round-trips to
 *      the Hetzner API, then deletes both so the test leaves nothing behind.
 *
 * Requires HETZNER_CLOUD_TOKEN in the environment.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "index.js");

function fail(msg: string): never {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`OK    ${msg}`);
}

function textOf(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  return (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

type CallResult = { isError?: boolean };

async function createPlacementGroup(
  client: Client,
  body: Record<string, unknown> | string,
  label: string,
): Promise<number> {
  const res = await client.callTool({
    name: "cloud_request",
    arguments: { method: "POST", path: "/placement_groups", body, verbose: true },
  });
  const text = textOf(res);
  if ((res as CallResult).isError || /required|failed to parse|Error:/i.test(text)) {
    fail(`${label} create failed -> ${text.slice(0, 300)}`);
  }
  const id = JSON.parse(text)?.placement_group?.id;
  if (!id) fail(`${label} create returned no id -> ${text.slice(0, 300)}`);
  ok(`${label} created placement_group id=${id}`);
  return id;
}

async function deletePlacementGroup(client: Client, id: number): Promise<void> {
  const del = await client.callTool({
    name: "cloud_request",
    arguments: { method: "DELETE", path: `/placement_groups/${id}`, confirm: true },
  });
  if ((del as CallResult).isError) fail(`cleanup delete failed for ${id} -> ${textOf(del).slice(0, 200)}`);
  ok(`deleted placement_group id=${id}`);
}

async function main(): Promise<void> {
  const token = process.env.HETZNER_CLOUD_TOKEN;
  if (!token) fail("HETZNER_CLOUD_TOKEN not set in environment.");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, HETZNER_CLOUD_TOKEN: token },
  });
  const client = new Client({ name: "fix-verify", version: "1.0.0" });
  await client.connect(transport);

  // 1. Schema check. The body param must no longer be an empty schema.
  const tools = await client.listTools();
  const cloudReq = tools.tools.find((t) => t.name === "cloud_request");
  if (!cloudReq) fail("cloud_request tool not found in tools/list.");
  const props = (cloudReq.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
  const bodySchema = props["body"] as Record<string, unknown> | undefined;
  if (!bodySchema) fail("body property missing from cloud_request schema.");
  const realKeys = Object.keys(bodySchema).filter((k) => k !== "description");
  if (realKeys.length === 0) fail("body schema is still empty. Clients will drop it.");
  ok(`body schema is non-empty -> ${JSON.stringify(bodySchema).slice(0, 160)}`);

  // 2 + 3. Real writes through cloud_request with an OBJECT body and a JSON-STRING body.
  const idObject = await createPlacementGroup(
    client,
    { name: "fixverify-pg", type: "spread", labels: { purpose: "fix-verify" } },
    "object body",
  );
  const idString = await createPlacementGroup(
    client,
    JSON.stringify({ name: "fixverify-pg-str", type: "spread", labels: { purpose: "fix-verify" } }),
    "string body",
  );

  // 4. Clean up both. Independent deletes run concurrently.
  await Promise.all([deletePlacementGroup(client, idObject), deletePlacementGroup(client, idString)]);

  await client.close();
  console.log("\nALL GREEN  cloud_request write bodies round-trip (object + string), schema non-empty.");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
