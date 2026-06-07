/**
 * Curated read tools, generated from a declarative table to stay lean.
 * Every entry is a free GET. Optional id fetches a single resource.
 * Responses are compact by default for token efficiency, verbose on request.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig, SurfaceName } from "../config.js";
import { hetznerRequest } from "../http.js";
import { formatResult } from "../format.js";

interface ReadDef {
  surface: SurfaceName;
  name: string;
  path: string;
  desc: string;
  paginated: boolean;
}

const READS: ReadDef[] = [
  { surface: "cloud", name: "cloud_list_servers", path: "/servers", desc: "List cloud servers", paginated: true },
  { surface: "cloud", name: "cloud_list_ssh_keys", path: "/ssh_keys", desc: "List SSH keys", paginated: true },
  { surface: "cloud", name: "cloud_list_networks", path: "/networks", desc: "List private networks", paginated: true },
  { surface: "cloud", name: "cloud_list_firewalls", path: "/firewalls", desc: "List firewalls", paginated: true },
  { surface: "cloud", name: "cloud_list_volumes", path: "/volumes", desc: "List volumes", paginated: true },
  { surface: "cloud", name: "cloud_list_load_balancers", path: "/load_balancers", desc: "List load balancers", paginated: true },
  { surface: "cloud", name: "cloud_list_floating_ips", path: "/floating_ips", desc: "List floating IPs", paginated: true },
  { surface: "cloud", name: "cloud_list_primary_ips", path: "/primary_ips", desc: "List primary IPs", paginated: true },
  { surface: "cloud", name: "cloud_list_placement_groups", path: "/placement_groups", desc: "List placement groups", paginated: true },
  { surface: "cloud", name: "cloud_list_certificates", path: "/certificates", desc: "List certificates", paginated: true },
  { surface: "cloud", name: "cloud_list_images", path: "/images", desc: "List images", paginated: true },
  { surface: "cloud", name: "cloud_list_isos", path: "/isos", desc: "List ISOs", paginated: true },
  { surface: "cloud", name: "cloud_list_dns_zones", path: "/zones", desc: "List DNS zones, part of the Cloud API", paginated: true },
  { surface: "cloud", name: "cloud_list_server_types", path: "/server_types", desc: "List server types and specs", paginated: true },
  { surface: "cloud", name: "cloud_list_load_balancer_types", path: "/load_balancer_types", desc: "List load balancer types", paginated: true },
  { surface: "cloud", name: "cloud_list_locations", path: "/locations", desc: "List locations", paginated: true },
  { surface: "cloud", name: "cloud_list_datacenters", path: "/datacenters", desc: "List datacenters", paginated: true },
  { surface: "cloud", name: "cloud_get_pricing", path: "/pricing", desc: "Get full pricing for the account currency", paginated: false },
  { surface: "storagebox", name: "storagebox_list", path: "/storage_boxes", desc: "List storage boxes", paginated: true },
  { surface: "storagebox", name: "storagebox_list_types", path: "/storage_box_types", desc: "List storage box types", paginated: true },
  { surface: "robot", name: "robot_list_servers", path: "/server", desc: "List dedicated servers", paginated: false },
  { surface: "robot", name: "robot_list_ips", path: "/ip", desc: "List single IPs", paginated: false },
  { surface: "robot", name: "robot_list_subnets", path: "/subnet", desc: "List subnets", paginated: false },
  { surface: "robot", name: "robot_list_vswitches", path: "/vswitch", desc: "List vSwitches", paginated: false },
  { surface: "robot", name: "robot_list_failover", path: "/failover", desc: "List failover IPs", paginated: false },
  { surface: "robot", name: "robot_list_ssh_keys", path: "/key", desc: "List Robot SSH keys", paginated: false },
  { surface: "robot", name: "robot_list_storageboxes", path: "/storagebox", desc: "List Robot storage boxes (legacy)", paginated: false },
  { surface: "robot", name: "robot_list_rdns", path: "/rdns", desc: "List reverse DNS entries", paginated: false },
];

type ReadArgs = { id?: string; query?: Record<string, string | number | boolean>; verbose?: boolean };

function makeReadHandler(cfg: HetznerConfig, def: ReadDef) {
  return async (args: ReadArgs) => {
    try {
      const path = args.id ? `${def.path}/${encodeURIComponent(args.id)}` : def.path;
      const query =
        def.paginated && !args.id ? { per_page: 50, ...(args.query ?? {}) } : args.query;
      const result = await hetznerRequest(cfg, { surface: def.surface, path, query });
      return { content: [{ type: "text" as const, text: formatResult(result, args.verbose ?? false) }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  };
}

export function registerReadTools(server: McpServer, cfg: HetznerConfig): void {
  for (const def of READS) {
    server.registerTool(
      def.name,
      {
        title: def.name,
        description: `${def.desc}. Read only, free. Compact by default.`,
        inputSchema: {
          id: z.string().optional().describe("Optional resource id to fetch a single item."),
          query: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
            .optional()
            .describe("Optional query parameters such as name or label_selector."),
          verbose: z.boolean().optional().describe("Return full payload instead of the compact view."),
        },
      },
      makeReadHandler(cfg, def),
    );
  }
}

export const READ_TOOL_COUNT = READS.length;
