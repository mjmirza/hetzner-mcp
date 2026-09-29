/** MCP tool that maps the whole Hetzner estate and serves the interactive canvas. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { collectGraph } from "../map/collect.js";
import { sampleGraph } from "../map/sample.js";
import { startMapServer } from "../map/server.js";
import { summarize, toMermaid } from "../map/summary.js";

export function registerMapTool(server: McpServer, cfg: HetznerConfig): void {
  server.registerTool(
    "infra_map",
    {
      title: "Map infrastructure and costs",
      description:
        "Read-only. Maps every configured Hetzner project (one per token) and account: servers, networks, volumes, " +
        "firewalls, load balancers, IPs, snapshots, storage boxes, dedicated servers. Returns estimated monthly cost per " +
        "project and resource, top cost drivers, and idle or orphaned resources still being billed. By default also " +
        "starts a local interactive canvas on http://127.0.0.1:43390 and returns its URL.",
      inputSchema: {
        serve: z.boolean().optional().describe("Start the local interactive map. Default true."),
        mermaid: z.boolean().optional().describe("Also return a Mermaid diagram. Default false."),
        demo: z.boolean().optional().describe("Use a labelled sample estate instead of your account."),
      },
    },
    async (a) => {
      try {
        const graph = a.demo ? sampleGraph() : await collectGraph(cfg);
        let url: string | undefined;
        if (a.serve !== false) {
          try {
            url = (await startMapServer(cfg, { demo: a.demo })).url;
          } catch (err) {
            url = undefined;
            graph.caveats.push(`Map server not started. ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        let text = summarize(graph, url);
        if (a.mermaid) text += "\n\n```mermaid\n" + toMermaid(graph) + "\n```";
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}
