// Curated, guarded write tools for the common cloud resources. Every billed create needs
// confirm, and every delete needs confirm, before the request runs.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";
import { classifyCost } from "../cost.js";

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

// Hetzner resource ids are positive integers. Accept a numeric string too, but reject anything
// that is not all digits so a stray value never reaches a path.
const id = z.union([z.number().int().positive(), z.string().regex(/^[0-9]+$/, "id must be a positive integer")]);
const enc = (v: string | number) => encodeURIComponent(String(v));

/**
 * The shared guard. Blocks on read-only, blocks a billed create unless allowBilled and
 * confirm, blocks a delete unless confirm, then runs the request and relays any API error.
 */
async function guarded(
  cfg: HetznerConfig,
  opts: {
    method: "POST" | "PUT" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
    label: string;
    destructive?: boolean;
    confirm?: boolean;
  },
): Promise<ReturnType<typeof text>> {
  if (cfg.readOnly) return text("Refused. The server is in read-only mode (HETZNER_MCP_READONLY=1).", true);
  const cost = classifyCost("cloud", opts.method, opts.path);
  if (cost.billed) {
    if (!cfg.allowBilled) return text("Blocked. Billed operations are disabled (HETZNER_MCP_ALLOW_BILLED=0).", true);
    if (opts.confirm !== true) {
      return text(`COST GUARD. ${opts.label} may cost money (${cost.reason}). Re-run with confirm set to true.`, true);
    }
  }
  // A DELETE is always destructive, even if a caller forgets the flag.
  const destructive = opts.destructive === true || opts.method === "DELETE";
  if (destructive && opts.confirm !== true) {
    return text(`DESTRUCTIVE GUARD. ${opts.label} is permanent and can cause data loss. Re-run with confirm set to true.`, true);
  }
  try {
    const res = await hetznerRequest(cfg, { surface: "cloud", method: opts.method, path: opts.path, body: opts.body });
    return text(JSON.stringify(res, null, 2));
  } catch (err) {
    return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

/** Strip undefined so an optional field never lands in the request body as null. */
function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

export function registerCloudWriteTools(server: McpServer, cfg: HetznerConfig): void {
  // ---- Volumes ----
  server.registerTool(
    "cloud_create_volume",
    {
      title: "Create a volume",
      description: "Create a Hetzner Cloud volume. Billed. Requires confirm true. Attach to a server or place in a location.",
      inputSchema: {
        name: z.string().min(1).describe("Volume name."),
        size: z.number().int().min(10).describe("Size in GB (minimum 10)."),
        location: z.string().optional().describe("For example nbg1, fsn1, hel1. Use this or server."),
        server: z.number().optional().describe("Server id to create and attach the volume to."),
        format: z.string().optional().describe("Filesystem to format with, for example ext4 or xfs."),
        automount: z.boolean().optional().describe("Automount on the attached server."),
        confirm: z.boolean().optional().describe("Must be true. Creating a volume costs money."),
      },
    },
    async (a) =>
      guarded(cfg, {
        method: "POST",
        path: "/volumes",
        confirm: a.confirm,
        label: `Creating volume ${a.name}`,
        body: clean({ name: a.name, size: a.size, location: a.location, server: a.server, format: a.format, automount: a.automount }),
      }),
  );
  server.registerTool(
    "cloud_delete_volume",
    { title: "Delete a volume", description: "Delete a volume. Free but destructive, requires confirm true.", inputSchema: { id: id.describe("Volume id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/volumes/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting volume ${a.id}` }),
  );
  server.registerTool(
    "cloud_attach_volume",
    { title: "Attach a volume", description: "Attach a volume to a server.", inputSchema: { id: id.describe("Volume id."), server: z.number().describe("Server id."), automount: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "POST", path: `/volumes/${enc(a.id)}/actions/attach`, label: `Attaching volume ${a.id}`, body: clean({ server: a.server, automount: a.automount }) }),
  );
  server.registerTool(
    "cloud_detach_volume",
    { title: "Detach a volume", description: "Detach a volume from its server.", inputSchema: { id: id.describe("Volume id.") } },
    async (a) => guarded(cfg, { method: "POST", path: `/volumes/${enc(a.id)}/actions/detach`, label: `Detaching volume ${a.id}` }),
  );

  // ---- Networks ----
  server.registerTool(
    "cloud_create_network",
    {
      title: "Create a network",
      description: "Create a private network. Free.",
      inputSchema: {
        name: z.string().min(1).describe("Network name."),
        ip_range: z.string().describe("CIDR of the whole network, for example 10.0.0.0/16."),
        subnets: z.array(z.record(z.string(), z.unknown())).optional().describe("Optional subnets to create with the network."),
        expose_routes_to_vswitch: z.boolean().optional(),
      },
    },
    async (a) => guarded(cfg, { method: "POST", path: "/networks", label: `Creating network ${a.name}`, body: clean({ name: a.name, ip_range: a.ip_range, subnets: a.subnets, expose_routes_to_vswitch: a.expose_routes_to_vswitch }) }),
  );
  server.registerTool(
    "cloud_delete_network",
    { title: "Delete a network", description: "Delete a private network. Free but destructive, requires confirm true.", inputSchema: { id: id.describe("Network id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/networks/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting network ${a.id}` }),
  );

  // ---- Firewalls ----
  server.registerTool(
    "cloud_create_firewall",
    {
      title: "Create a firewall",
      description: "Create a firewall with rules. Free.",
      inputSchema: {
        name: z.string().min(1).describe("Firewall name."),
        rules: z.array(z.record(z.string(), z.unknown())).optional().describe("Rule objects: direction, protocol, port, source_ips or destination_ips."),
        apply_to: z.array(z.record(z.string(), z.unknown())).optional().describe("Resources to apply the firewall to on creation."),
      },
    },
    async (a) => guarded(cfg, { method: "POST", path: "/firewalls", label: `Creating firewall ${a.name}`, body: clean({ name: a.name, rules: a.rules, apply_to: a.apply_to }) }),
  );
  server.registerTool(
    "cloud_delete_firewall",
    { title: "Delete a firewall", description: "Delete a firewall. Free but destructive, requires confirm true.", inputSchema: { id: id.describe("Firewall id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/firewalls/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting firewall ${a.id}` }),
  );

  // ---- Load balancers ----
  server.registerTool(
    "cloud_create_load_balancer",
    {
      title: "Create a load balancer",
      description: "Create a load balancer. Billed. Requires confirm true.",
      inputSchema: {
        name: z.string().min(1).describe("Load balancer name."),
        load_balancer_type: z.string().describe("For example lb11. List options with cloud_list_load_balancer_types."),
        location: z.string().optional().describe("For example nbg1. Use this or network_zone."),
        network_zone: z.string().optional().describe("For example eu-central. Use this or location."),
        algorithm: z.record(z.string(), z.unknown()).optional().describe("For example { type: round_robin }."),
        services: z.array(z.record(z.string(), z.unknown())).optional(),
        targets: z.array(z.record(z.string(), z.unknown())).optional(),
        public_interface: z.boolean().optional(),
        confirm: z.boolean().optional().describe("Must be true. A load balancer costs money."),
      },
    },
    async (a) =>
      guarded(cfg, {
        method: "POST",
        path: "/load_balancers",
        confirm: a.confirm,
        label: `Creating load balancer ${a.name}`,
        body: clean({ name: a.name, load_balancer_type: a.load_balancer_type, location: a.location, network_zone: a.network_zone, algorithm: a.algorithm, services: a.services, targets: a.targets, public_interface: a.public_interface }),
      }),
  );
  server.registerTool(
    "cloud_delete_load_balancer",
    { title: "Delete a load balancer", description: "Delete a load balancer. Free but destructive, requires confirm true.", inputSchema: { id: id.describe("Load balancer id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/load_balancers/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting load balancer ${a.id}` }),
  );

  // ---- Floating IPs ----
  server.registerTool(
    "cloud_create_floating_ip",
    {
      title: "Create a floating IP",
      description: "Create a floating IP. Billed. Requires confirm true.",
      inputSchema: {
        type: z.enum(["ipv4", "ipv6"]).describe("ipv4 or ipv6."),
        home_location: z.string().optional().describe("For example nbg1. Use this or server."),
        server: z.number().optional().describe("Server id to assign the floating IP to."),
        name: z.string().optional(),
        description: z.string().optional(),
        confirm: z.boolean().optional().describe("Must be true. A floating IP costs money."),
      },
    },
    async (a) =>
      guarded(cfg, {
        method: "POST",
        path: "/floating_ips",
        confirm: a.confirm,
        label: `Creating floating IP (${a.type})`,
        body: clean({ type: a.type, home_location: a.home_location, server: a.server, name: a.name, description: a.description }),
      }),
  );
  server.registerTool(
    "cloud_delete_floating_ip",
    { title: "Delete a floating IP", description: "Delete a floating IP. Free but destructive, requires confirm true. Note. an assigned IP must be unassigned first.", inputSchema: { id: id.describe("Floating IP id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/floating_ips/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting floating IP ${a.id}` }),
  );
  server.registerTool(
    "cloud_assign_floating_ip",
    { title: "Assign a floating IP", description: "Assign a floating IP to a server.", inputSchema: { id: id.describe("Floating IP id."), server: z.number().describe("Server id.") } },
    async (a) => guarded(cfg, { method: "POST", path: `/floating_ips/${enc(a.id)}/actions/assign`, label: `Assigning floating IP ${a.id}`, body: { server: a.server } }),
  );
  server.registerTool(
    "cloud_unassign_floating_ip",
    { title: "Unassign a floating IP", description: "Unassign a floating IP from its server.", inputSchema: { id: id.describe("Floating IP id.") } },
    async (a) => guarded(cfg, { method: "POST", path: `/floating_ips/${enc(a.id)}/actions/unassign`, label: `Unassigning floating IP ${a.id}` }),
  );

  // ---- Primary IPs ----
  server.registerTool(
    "cloud_create_primary_ip",
    {
      title: "Create a primary IP",
      description: "Create a primary IP. Billed. Requires confirm true. Assign to a server, or create standalone with a location.",
      inputSchema: {
        type: z.enum(["ipv4", "ipv6"]).describe("ipv4 or ipv6."),
        name: z.string().min(1).describe("Primary IP name."),
        location: z.string().optional().describe("For a standalone unassigned IP, for example fsn1."),
        assignee_type: z.string().optional().describe("For example server, when assigning on creation."),
        assignee_id: z.number().optional().describe("Server id to assign to."),
        auto_delete: z.boolean().optional().describe("Delete the primary IP when its server is deleted."),
        confirm: z.boolean().optional().describe("Must be true. A primary IP costs money."),
      },
    },
    async (a) =>
      guarded(cfg, {
        method: "POST",
        path: "/primary_ips",
        confirm: a.confirm,
        label: `Creating primary IP ${a.name}`,
        body: clean({ type: a.type, name: a.name, location: a.location, assignee_type: a.assignee_type, assignee_id: a.assignee_id, auto_delete: a.auto_delete }),
      }),
  );
  server.registerTool(
    "cloud_delete_primary_ip",
    { title: "Delete a primary IP", description: "Delete a primary IP. Free but destructive, requires confirm true. An assigned IP must be unassigned first.", inputSchema: { id: id.describe("Primary IP id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/primary_ips/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting primary IP ${a.id}` }),
  );
  server.registerTool(
    "cloud_assign_primary_ip",
    { title: "Assign a primary IP", description: "Assign a primary IP to a server. The server must be off.", inputSchema: { id: id.describe("Primary IP id."), assignee_id: z.number().describe("Server id."), assignee_type: z.string().optional().describe("Defaults to server.") } },
    async (a) => guarded(cfg, { method: "POST", path: `/primary_ips/${enc(a.id)}/actions/assign`, label: `Assigning primary IP ${a.id}`, body: clean({ assignee_id: a.assignee_id, assignee_type: a.assignee_type ?? "server" }) }),
  );
  server.registerTool(
    "cloud_unassign_primary_ip",
    { title: "Unassign a primary IP", description: "Unassign a primary IP from its server. The server must be off.", inputSchema: { id: id.describe("Primary IP id.") } },
    async (a) => guarded(cfg, { method: "POST", path: `/primary_ips/${enc(a.id)}/actions/unassign`, label: `Unassigning primary IP ${a.id}` }),
  );

  // ---- SSH keys ----
  server.registerTool(
    "cloud_create_ssh_key",
    { title: "Create an SSH key", description: "Add an SSH public key. Free.", inputSchema: { name: z.string().min(1).describe("Key name."), public_key: z.string().min(1).describe("The public key text."), labels: z.record(z.string(), z.string()).optional() } },
    async (a) => guarded(cfg, { method: "POST", path: "/ssh_keys", label: `Creating SSH key ${a.name}`, body: clean({ name: a.name, public_key: a.public_key, labels: a.labels }) }),
  );
  server.registerTool(
    "cloud_delete_ssh_key",
    { title: "Delete an SSH key", description: "Delete an SSH key. Free but destructive, requires confirm true.", inputSchema: { id: id.describe("SSH key id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/ssh_keys/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting SSH key ${a.id}` }),
  );

  // ---- Placement groups ----
  server.registerTool(
    "cloud_create_placement_group",
    { title: "Create a placement group", description: "Create a placement group. Free.", inputSchema: { name: z.string().min(1).describe("Placement group name."), type: z.string().optional().describe("For example spread."), labels: z.record(z.string(), z.string()).optional() } },
    async (a) => guarded(cfg, { method: "POST", path: "/placement_groups", label: `Creating placement group ${a.name}`, body: clean({ name: a.name, type: a.type ?? "spread", labels: a.labels }) }),
  );
  server.registerTool(
    "cloud_delete_placement_group",
    { title: "Delete a placement group", description: "Delete a placement group. Free but destructive, requires confirm true.", inputSchema: { id: id.describe("Placement group id."), confirm: z.boolean().optional() } },
    async (a) => guarded(cfg, { method: "DELETE", path: `/placement_groups/${enc(a.id)}`, destructive: true, confirm: a.confirm, label: `Deleting placement group ${a.id}` }),
  );
}
