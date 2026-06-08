/**
 * Tears down everything the deploy demo created, by label (purpose=mcpdemo), through
 * the built MCP server. Deletes the attached resources first (servers, load balancer),
 * then the free building blocks (network, firewall, placement group, ssh key). Deleting
 * is free and stops billing. Requires HETZNER_CLOUD_TOKEN.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "index.js");
const SELECTOR = "purpose==mcpdemo";

type CallResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean };
function textOf(r: CallResult): string {
  return (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

async function main(): Promise<void> {
  const token = process.env.HETZNER_CLOUD_TOKEN;
  if (!token) {
    console.error("FAIL  HETZNER_CLOUD_TOKEN not set");
    process.exit(1);
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, HETZNER_CLOUD_TOKEN: token },
  });
  const client = new Client({ name: "teardown-demo", version: "1.0.0" });
  await client.connect(transport);
  const req = (args: Record<string, unknown>): Promise<CallResult> =>
    client.callTool({ name: "cloud_request", arguments: args }) as Promise<CallResult>;

  const idsOf = async (collection: string): Promise<number[]> => {
    const r = await req({ method: "GET", path: `/${collection}`, query: { label_selector: SELECTOR }, verbose: true });
    try {
      const items = (JSON.parse(textOf(r)) as Record<string, Array<{ id: number }>>)[collection] ?? [];
      return items.map((i) => i.id);
    } catch {
      return [];
    }
  };
  const del = async (collection: string, id: number): Promise<void> => {
    const r = await req({ method: "DELETE", path: `/${collection}/${id}`, confirm: true });
    console.log(`${r.isError ? "FAIL" : "OK  "}  delete ${collection}/${id}`);
  };
  const wipe = async (collection: string): Promise<void> => {
    const ids = await idsOf(collection);
    if (ids.length === 0) {
      console.log(`--    ${collection}: none`);
      return;
    }
    await Promise.all(ids.map((id) => del(collection, id)));
  };

  // Attached resources first (so the network can then be removed), then the free blocks.
  await Promise.all([wipe("servers"), wipe("load_balancers")]);
  await Promise.all([wipe("networks"), wipe("firewalls"), wipe("placement_groups"), wipe("ssh_keys")]);

  await client.close();
  console.log("\nTeardown complete. Verify in the portal that nothing labelled mcpdemo remains.");
}

main().catch((err) => {
  console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
