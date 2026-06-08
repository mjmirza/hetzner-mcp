/**
 * Curated write tools for the two most common, highest-risk operations.
 * cloud_create_server is billed and goes through the cost guard with a live price preview.
 * cloud_delete_server is destructive and goes through the confirm guard.
 * Every other write remains available through the generic cloud_request tool.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";
import { cloudServerPriceNote } from "../cost.js";

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

export function registerWriteTools(server: McpServer, cfg: HetznerConfig): void {
  server.registerTool(
    "cloud_create_server",
    {
      title: "Create a cloud server",
      description:
        "Create a Hetzner Cloud server. This is billed. It requires confirm true and shows the live hourly and monthly price first. Optionally attach SSH keys, a private network, firewalls, cloud-init user_data, and labels.",
      inputSchema: {
        name: z.string().min(1).describe("Server name."),
        server_type: z.string().describe("For example cx23 or cax21. List options with cloud_list_server_types."),
        image: z.string().describe("For example ubuntu-24.04. List options with cloud_list_images."),
        location: z.string().optional().describe("For example nbg1, fsn1, hel1."),
        ssh_keys: z.array(z.union([z.string(), z.number()])).optional().describe("SSH key ids or names."),
        networks: z.array(z.number()).optional().describe("Private network ids to attach."),
        firewalls: z.array(z.number()).optional().describe("Firewall ids to apply."),
        user_data: z.string().optional().describe("cloud-init user data run at first boot."),
        labels: z.record(z.string(), z.string()).optional().describe("Key value labels."),
        start_after_create: z.boolean().optional().describe("Start the server after creation. Default true."),
        confirm: z.boolean().optional().describe("Must be true. Creating a server costs money."),
      },
    },
    async (args) => {
      if (cfg.readOnly) return text("Refused. The server is in read-only mode (HETZNER_MCP_READONLY=1).", true);
      if (!cfg.allowBilled) return text("Blocked. Billed creation is disabled (HETZNER_MCP_ALLOW_BILLED=0).", true);
      if (args.confirm !== true) {
        const priced = await cloudServerPriceNote(cfg, args.server_type);
        return text(
          `COST GUARD. Creating server ${args.name} (${args.server_type}) costs money. Re-run with confirm set to true.` +
            (priced ? ` ${priced}` : ""),
          true,
        );
      }
      try {
        const body: Record<string, unknown> = {
          name: args.name,
          server_type: args.server_type,
          image: args.image,
          start_after_create: args.start_after_create ?? true,
        };
        if (args.location) body.location = args.location;
        if (args.ssh_keys) body.ssh_keys = args.ssh_keys;
        if (args.networks) body.networks = args.networks;
        if (args.firewalls) body.firewalls = args.firewalls.map((id) => ({ firewall: id }));
        if (args.user_data) body.user_data = args.user_data;
        if (args.labels) body.labels = args.labels;

        const res = (await hetznerRequest(cfg, { surface: "cloud", method: "POST", path: "/servers", body })) as {
          server?: { id?: number; name?: string; status?: string; public_net?: { ipv4?: { ip?: string } } };
          root_password?: string | null;
        };
        const s = res.server;
        const summary = {
          id: s?.id,
          name: s?.name,
          status: s?.status,
          ipv4: s?.public_net?.ipv4?.ip ?? null,
          root_password: res.root_password ?? null,
          note: "Server is billed while it exists. Delete it with cloud_delete_server when done. A root password is returned only when no SSH key was attached.",
        };
        return text(JSON.stringify(summary, null, 2));
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );

  server.registerTool(
    "cloud_delete_server",
    {
      title: "Delete a cloud server",
      description:
        "Delete a Hetzner Cloud server. Deleting is free and stops billing, but it destroys the server, so it requires confirm true. Auto-created primary IPs are released by Hetzner shortly after.",
      inputSchema: {
        id: z.union([z.string(), z.number()]).describe("Server id."),
        confirm: z.boolean().optional().describe("Must be true. This permanently deletes the server."),
      },
    },
    async (args) => {
      if (cfg.readOnly) return text("Refused. The server is in read-only mode (HETZNER_MCP_READONLY=1).", true);
      if (args.confirm !== true) {
        return text(
          `DESTRUCTIVE GUARD. Deleting server ${args.id} is permanent and can cause data loss. Re-run with confirm set to true.`,
          true,
        );
      }
      try {
        await hetznerRequest(cfg, { surface: "cloud", method: "DELETE", path: `/servers/${encodeURIComponent(String(args.id))}` });
        return text(`Server ${args.id} deleted. Billing stopped. Auto-created primary IPs release shortly after.`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );
}
