/**
 * Generic per-surface request tools. These give complete coverage of every Hetzner
 * endpoint, including ones without a curated wrapper, while still enforcing the
 * read-only and cost guards.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig, SurfaceName } from "../config.js";
import { hetznerRequest } from "../http.js";
import { classifyCost, cloudServerPriceNote } from "../cost.js";
import { isWrite, normalizeMethod } from "../security.js";
import { formatResult } from "../format.js";

export interface ToolText {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function textResult(value: unknown, isError = false): ToolText {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
}

const CONTRIBUTE_HINT =
  "If an endpoint you need is missing or misbehaving, use the contribute_or_report tool to open a prefilled issue or pull request.";

const SURFACE_LABEL: Record<SurfaceName, string> = {
  cloud: "Hetzner Cloud (api.hetzner.cloud)",
  storagebox: "Hetzner Storage Box (api.hetzner.com)",
  robot: "Hetzner Robot dedicated servers (robot-ws.your-server.de)",
};

function registerOne(server: McpServer, cfg: HetznerConfig, surface: SurfaceName): void {
  server.registerTool(
    `${surface}_request`,
    {
      title: `${surface} raw request`,
      description:
        `Call any ${SURFACE_LABEL[surface]} endpoint directly. Use a relative path like /servers. ` +
        `Reads are free. Writes obey the read-only and cost guards. ${CONTRIBUTE_HINT}`,
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .describe("HTTP method. Defaults to GET."),
        path: z.string().min(1).describe("Relative API path, for example /servers or /servers/123."),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query string parameters."),
        body: z.unknown().optional().describe("Request body for write methods."),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to create a billed resource. Reads and free resources do not need it."),
        verbose: z
          .boolean()
          .optional()
          .describe("Return the full payload. Default false returns a compact, token-efficient view."),
      },
    },
    async (args) => {
      try {
        const method = normalizeMethod(args.method);
        if (isWrite(method) && cfg.readOnly) {
          return textResult(
            `Refused. The server is in read-only mode (HETZNER_MCP_READONLY=1), so ${method} ${args.path} is not allowed.`,
            true,
          );
        }
        if (isWrite(method)) {
          const cost = classifyCost(surface, method, args.path);
          if (cost.billed) {
            if (!cfg.allowBilled) {
              return textResult(
                `Blocked. Billed creation is disabled (HETZNER_MCP_ALLOW_BILLED=0). ${cost.reason}.`,
                true,
              );
            }
            if (args.confirm !== true) {
              let note = "";
              if (surface === "cloud" && /^\/servers\/?$/i.test(args.path)) {
                const body = args.body as { server_type?: string } | undefined;
                const priced = await cloudServerPriceNote(cfg, body?.server_type);
                if (priced) note = " " + priced;
              }
              return textResult(
                `COST GUARD. ${cost.reason}. This costs money. Re-run with confirm set to true to proceed.${note}`,
                true,
              );
            }
          }
        }
        const result = await hetznerRequest(cfg, {
          surface,
          method,
          path: args.path,
          query: args.query,
          body: args.body,
        });
        return { content: [{ type: "text", text: formatResult(result, args.verbose ?? false) }] };
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );
}

export function registerGenericTools(server: McpServer, cfg: HetznerConfig): void {
  registerOne(server, cfg, "cloud");
  registerOne(server, cfg, "storagebox");
  registerOne(server, cfg, "robot");
}
