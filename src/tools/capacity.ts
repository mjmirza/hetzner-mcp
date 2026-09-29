/**
 * find_capacity. Which server types can be bought right now, where, and for how much.
 * Read-only. Uses server_types[].locations[].available, recommended and deprecation,
 * which replace the deprecated datacenter availability fields.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CapacityRow {
  type: string;
  location: string;
  available: boolean;
  recommended: boolean;
  monthly: number | null;
  hourly: number | null;
  cores: number;
  memory_gb: number;
  disk_gb: number;
  architecture: string;
  retiring_after: string | null;
}

export function capacityRows(serverTypes: Json[]): CapacityRow[] {
  const rows: CapacityRow[] = [];
  for (const t of serverTypes) {
    for (const l of (t.locations ?? []) as Json[]) {
      const price = ((t.prices ?? []) as Json[]).find((p) => p.location === l.name);
      const n = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
      rows.push({
        type: t.name,
        location: l.name,
        available: l.available !== false,
        recommended: l.recommended === true,
        monthly: n(price?.price_monthly?.gross),
        hourly: n(price?.price_hourly?.gross),
        cores: t.cores,
        memory_gb: t.memory,
        disk_gb: t.disk,
        architecture: t.architecture,
        retiring_after: l.deprecation?.unavailable_after ?? null,
      });
    }
  }
  return rows;
}

export function rankCapacity(
  rows: CapacityRow[],
  f: { type?: string; location?: string; minCores?: number; minMemoryGb?: number; architecture?: string; includeRetiring?: boolean },
): CapacityRow[] {
  return rows
    .filter((r) => r.available)
    .filter((r) => (f.type ? r.type === f.type.toLowerCase() : true))
    .filter((r) => (f.location ? r.location === f.location.toLowerCase() : true))
    .filter((r) => (f.minCores ? r.cores >= f.minCores : true))
    .filter((r) => (f.minMemoryGb ? r.memory_gb >= f.minMemoryGb : true))
    .filter((r) => (f.architecture ? r.architecture === f.architecture : true))
    .filter((r) => (f.includeRetiring ? true : !r.retiring_after))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || (a.monthly ?? Infinity) - (b.monthly ?? Infinity));
}

export function registerCapacityTool(server: McpServer, cfg: HetznerConfig): void {
  server.registerTool(
    "find_capacity",
    {
      title: "Find buyable server capacity",
      description:
        "Read-only, free. Lists which server types can be ordered right now and where, recommended first then cheapest, with the " +
        "monthly price, whether Hetzner recommends it, and retirement dates. Use it before creating a server to avoid " +
        "resource_unavailable errors and to pick a fallback location.",
      inputSchema: {
        server_type: z.string().optional().describe("Only this type, for example cx33."),
        location: z.string().optional().describe("Only this location, for example fsn1, nbg1, hel1, ash, hil, sin."),
        min_cores: z.number().int().positive().optional().describe("At least this many vCPUs."),
        min_memory_gb: z.number().positive().optional().describe("At least this much RAM in GB."),
        architecture: z.enum(["x86", "arm"]).optional().describe("CPU architecture."),
        include_retiring: z.boolean().optional().describe("Also list types that are being retired. Default false."),
        limit: z.number().int().positive().max(100).optional().describe("How many rows to return. Default 15."),
      },
    },
    async (a) => {
      try {
        const types: Json[] = [];
        for (let page = 1; page <= cfg.maxPages; page++) {
          const res = (await hetznerRequest(cfg, { surface: "cloud", path: "/server_types", query: { page, per_page: 50 } })) as Json;
          types.push(...((res.server_types as Json[]) ?? []));
          if (!res.meta?.pagination?.next_page) break;
        }
        const all = capacityRows(types);
        const rows = rankCapacity(all, {
          type: a.server_type, location: a.location, minCores: a.min_cores, minMemoryGb: a.min_memory_gb,
          architecture: a.architecture, includeRetiring: a.include_retiring,
        }).slice(0, a.limit ?? 15);
        if (!rows.length) {
          const soldOut = all.filter((r) => !r.available && (!a.server_type || r.type === a.server_type.toLowerCase()));
          const hint = soldOut.length ? ` Unavailable right now: ${soldOut.slice(0, 8).map((r) => `${r.type} in ${r.location}`).join(", ")}.` : "";
          return { content: [{ type: "text" as const, text: `Nothing matches those filters that can be ordered right now.${hint} Loosen a filter or try another location.` }] };
        }
        const lines = rows.map(
          (r) =>
            `${r.type.padEnd(8)} ${r.location.padEnd(5)} ${r.monthly == null ? "   n/a" : r.monthly.toFixed(2).padStart(7)} a month  ` +
            `${r.cores} vCPU, ${r.memory_gb} GB RAM, ${r.disk_gb} GB disk, ${r.architecture}` +
            `${r.recommended ? ", recommended" : ""}${r.retiring_after ? `, retiring after ${r.retiring_after.slice(0, 10)}` : ""}`,
        );
        return { content: [{ type: "text" as const, text: `Orderable now, gross prices:\n${lines.join("\n")}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}
