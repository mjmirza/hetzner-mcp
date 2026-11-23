/**
 * Offline. Every registered tool advertises MCP annotations, and the hints match
 * what the tool actually does. No network.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { registerAllTools } from "../src/tools/register.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

interface Hints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
interface Listed {
  name: string;
  annotations?: Hints;
}

/** The 27 list and get shortcuts. Lean mode leaves these out. cloud_request GET covers the same reads. */
const LIST_SHORTCUTS = [
  "cloud_list_servers",
  "cloud_list_ssh_keys",
  "cloud_list_networks",
  "cloud_list_firewalls",
  "cloud_list_volumes",
  "cloud_list_load_balancers",
  "cloud_list_floating_ips",
  "cloud_list_primary_ips",
  "cloud_list_placement_groups",
  "cloud_list_certificates",
  "cloud_list_images",
  "cloud_list_isos",
  "cloud_list_dns_zones",
  "cloud_list_server_types",
  "cloud_list_load_balancer_types",
  "cloud_list_locations",
  "cloud_list_network_members",
  "cloud_get_pricing",
  "storagebox_list",
  "storagebox_list_types",
  "robot_list_servers",
  "robot_list_ips",
  "robot_list_subnets",
  "robot_list_vswitches",
  "robot_list_failover",
  "robot_list_ssh_keys",
  "robot_list_rdns",
];

/** Every read of the Hetzner account, including the list shortcuts lean mode drops. A repeat does not change it. */
const READS = [
  ...LIST_SHORTCUTS,
  "infra_audit",
  "infra_map",
  "spend_history",
  "find_capacity",
];

/** Builds a link in process. No Hetzner call, so the world is closed. */
const CLOSED = ["contribute_or_report"];

/** Creates, attaches, and assigns. Additive. A second call is not a no-op. */
const ADDITIVE = [
  "cloud_create_server",
  "cloud_create_volume",
  "cloud_attach_volume",
  "cloud_create_network",
  "cloud_create_firewall",
  "cloud_create_load_balancer",
  "cloud_create_floating_ip",
  "cloud_assign_floating_ip",
  "cloud_create_primary_ip",
  "cloud_assign_primary_ip",
  "cloud_create_ssh_key",
  "cloud_create_placement_group",
];

/**
 * Deletes, detaches, unassigns, and the raw request tools. Detach and unassign drop
 * state the destructive guard already requires confirm for. The request tools can send
 * any method, including power-off, rebuild, and DELETE, so they take the cautious hint.
 */
const DESTRUCTIVE = [
  "cloud_delete_server",
  "cloud_delete_volume",
  "cloud_detach_volume",
  "cloud_delete_network",
  "cloud_delete_firewall",
  "cloud_delete_load_balancer",
  "cloud_delete_floating_ip",
  "cloud_unassign_floating_ip",
  "cloud_delete_primary_ip",
  "cloud_unassign_primary_ip",
  "cloud_delete_ssh_key",
  "cloud_delete_placement_group",
  "cloud_request",
  "storagebox_request",
  "robot_request",
];

const READ_HINTS: Required<Hints> = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const CLOSED_HINTS: Required<Hints> = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ADD_HINTS: Required<Hints> = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTROY_HINTS: Required<Hints> = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

function same(got: Hints | undefined, want: Required<Hints>): boolean {
  if (!got) return false;
  return (
    got.readOnlyHint === want.readOnlyHint &&
    got.destructiveHint === want.destructiveHint &&
    got.idempotentHint === want.idempotentHint &&
    got.openWorldHint === want.openWorldHint
  );
}

async function list(env: NodeJS.ProcessEnv): Promise<Listed[]> {
  const server = new McpServer({ name: "hetzner-mcp", version: "test" });
  registerAllTools(server, loadConfig({}), env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "annotations", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools as Listed[];
}

function check(tools: Listed[], expectAbsent: string[]): void {
  const byName = new Map(tools.map((t) => [t.name, t]));
  assert("tool names are unique", tools.length === byName.size);

  const classes: Array<[string[], Required<Hints>, string]> = [
    [READS, READ_HINTS, "read"],
    [CLOSED, CLOSED_HINTS, "closed read"],
    [ADDITIVE, ADD_HINTS, "additive"],
    [DESTRUCTIVE, DESTROY_HINTS, "destructive"],
  ];
  const expected = new Set<string>();
  for (const [group, hints, label] of classes) {
    for (const name of group) {
      assert(`${label} class lists ${name} once`, !expected.has(name));
      expected.add(name);
      if (expectAbsent.includes(name)) {
        assert(`${name} is absent in this tool set`, !byName.has(name));
        continue;
      }
      const tool = byName.get(name);
      assert(`${name} is registered`, !!tool);
      assert(`${name} has annotations`, !!tool?.annotations);
      assert(`${name} hints match ${label}`, same(tool?.annotations, hints));
    }
  }

  for (const tool of tools) {
    assert(`${tool.name} is classified`, expected.has(tool.name));
    assert(`${tool.name} has annotations`, !!tool.annotations && typeof tool.annotations.readOnlyHint === "boolean");
    const writes = ADDITIVE.includes(tool.name) || DESTRUCTIVE.includes(tool.name);
    if (writes) assert(`${tool.name} is not marked read-only`, tool.annotations?.readOnlyHint === false);
    if (DESTRUCTIVE.includes(tool.name)) {
      assert(`${tool.name} is destructive and not read-only`, tool.annotations?.destructiveHint === true && tool.annotations?.readOnlyHint === false);
    }
    if (READS.includes(tool.name) || CLOSED.includes(tool.name)) {
      assert(`${tool.name} is read-only`, tool.annotations?.readOnlyHint === true);
    }
  }
}

const full = await list({});
const lean = await list({ HETZNER_MCP_TOOLS: "lean" });
process.stdout.write(`tools=${full.length} lean=${lean.length}\n`);
assert("full set is 59 tools", full.length === 59);
assert("lean set drops the 27 list shortcuts", lean.length === 32);
check(full, []);
check(lean, LIST_SHORTCUTS);

process.stdout.write(`\n${passed}/${total} annotation checks passed\n`);
if (passed !== total) process.exitCode = 1;
