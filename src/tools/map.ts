/** MCP tool that maps the whole Hetzner estate and serves the interactive canvas. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { collectGraph, type CollectOptions } from "../map/collect.js";
import { cachedGraph } from "../map/graph-cache.js";
import { discoverProjects, listWorkspaces, resolveTarget } from "../map/projects.js";
import { readStored } from "../map/store.js";
import { sampleGraph } from "../map/sample.js";
import { startMapServer } from "../map/server.js";
import { summarize, toMermaid } from "../map/summary.js";

export function registerMapTool(server: McpServer, cfg: HetznerConfig): void {
  server.registerTool(
    "infra_map",
    {
      title: "Map infrastructure and costs",
      description:
        "Read-only. Maps every configured Hetzner project and account with estimated monthly cost per project and " +
        "resource, top cost drivers, and idle resources still billed. Starts a local map at http://127.0.0.1:43390 " +
        "and returns its URL. Pass target to map one workspace or project. Other tools use the default token only.",
      inputSchema: {
        serve: z.boolean().optional().describe("Start the local map. Default true."),
        mermaid: z.boolean().optional().describe("Add a Mermaid diagram."),
        demo: z.boolean().optional().describe("Use the labelled sample estate."),
        refresh: z.boolean().optional(),
        target: z
          .string()
          .max(200)
          .optional()
          .describe('"workspace" or "workspace/account/project". Names: npx hetzner-mcp projects list'),
      },
    },
    async (a) => {
      try {
        let scope: CollectOptions = {};
        let workspaceCount = 1;
        if (!a.demo) {
          const projects = discoverProjects(cfg, process.env, readStored());
          const hasRobot = !!(cfg.robotUser && cfg.robotPassword);
          workspaceCount = listWorkspaces(projects, process.env, hasRobot).length;
          if (a.target) {
            const t = resolveTarget(projects, a.target, process.env, hasRobot);
            if ("error" in t) return { content: [{ type: "text" as const, text: `Error: ${t.error}` }], isError: true };
            scope = t;
          }
        }
        const read = a.demo ? sampleGraph() : await cachedGraph(JSON.stringify(scope), () => collectGraph(cfg, process.env, scope), { refresh: a.refresh });
        // The cached graph is shared, so notes for this answer go on a copy.
        const graph = { ...read, caveats: [...read.caveats] };
        if (!a.target && workspaceCount > 1) graph.caveats.push(`Mapped all ${workspaceCount} workspaces together. Pass target to map one workspace.`);
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
