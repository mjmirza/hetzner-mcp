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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
    // A firewall or network can stay briefly attached to a server that is still finishing
    // its own deletion, which makes the delete fail. Retry with a short backoff until the
    // association clears.
    // BESTPRACTICE_OK: a delete that depends on an async detach must retry one after another.
    for (let attempt = 1; attempt <= 6; attempt++) {
      const r = await req({ method: "DELETE", path: `/${collection}/${id}`, confirm: true });
      if (!r.isError) {
        console.log(`OK    delete ${collection}/${id}`);
        return;
      }
      if (attempt === 6) {
        console.log(`FAIL  delete ${collection}/${id} after 6 attempts -> ${textOf(r).slice(0, 80)}`);
        return;
      }
      await sleep(5000);
    }
  };
  const wipe = async (collection: string): Promise<void> => {
    const ids = await idsOf(collection);
    if (ids.length === 0) {
      console.log(`--    ${collection}: none`);
      return;
    }
    await Promise.all(ids.map((id) => del(collection, id)));
  };

  // Attached resources first (servers and load balancer), then wait for them to actually
  // clear, then the free blocks. The retry inside del covers any association that is still
  // detaching when the network or firewall delete is attempted.
  await Promise.all([wipe("servers"), wipe("load_balancers")]);
  const deadline = Date.now() + 90_000;
  // BESTPRACTICE_OK: deletion is asynchronous; poll one check after another until clear.
  while (Date.now() < deadline) {
    const [srv, lbs] = await Promise.all([idsOf("servers"), idsOf("load_balancers")]);
    if (srv.length === 0 && lbs.length === 0) break;
    await sleep(3000);
  }
  await Promise.all([wipe("networks"), wipe("firewalls"), wipe("placement_groups"), wipe("ssh_keys")]);

  await client.close();
  console.log("\nTeardown complete. Verify in the portal that nothing labelled mcpdemo remains.");
}

main().catch((err) => {
  console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
