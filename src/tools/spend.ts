// MCP tool for spend history: estimated monthly spend from the resources running today, plus the
// invoices added on the map's Spend tab, checked and reconciled month by month.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { collectGraph } from "../map/collect.js";
import { cachedGraph } from "../map/graph-cache.js";
import { defaultWorkspace, discoverProjects, resolveTarget } from "../map/projects.js";
import { readStored } from "../map/store.js";
import { sampleGraph } from "../map/sample.js";
import { sampleInvoices } from "../map/sample-spend.js";
import { spendReport, spendText } from "../map/spend.js";
import { readInvoices } from "../map/spend-store.js";
import { DATA_FENCE } from "../text.js";
import { capText } from "../format.js";

export function registerSpendTool(server: McpServer, cfg: HetznerConfig): void {
  server.registerTool(
    "spend_history",
    {
      title: "Spend history",
      description: "Read-only. Estimated spend per month and project from running resources, checked against invoices added on the map's Spend tab.",
      inputSchema: {
        workspace: z.string().max(200).optional(),
        months: z.number().int().min(1).max(24).optional(),
        demo: z.boolean().optional().describe("Use the labelled sample estate."),
        refresh: z.boolean().optional(),
      },
    },
    async (a) => {
      try {
        if (a.demo) {
          const g = sampleGraph();
          return { content: [{ type: "text" as const, text: `${DATA_FENCE}\n${spendText(spendReport(g, sampleInvoices(g)), a.months)}` }] };
        }
        let scope: { workspace?: string } = {};
        if (a.workspace) {
          const t = resolveTarget(discoverProjects(cfg, process.env, readStored()), a.workspace, process.env, !!(cfg.robotUser && cfg.robotPassword));
          if ("error" in t) return { content: [{ type: "text" as const, text: `Error: ${t.error}` }], isError: true };
          scope = { workspace: t.workspace };
        }
        const graph = await cachedGraph(JSON.stringify(scope), () => collectGraph(cfg, process.env, scope), { refresh: a.refresh });
        const invoices = readInvoices(process.env, scope.workspace, defaultWorkspace(process.env));
        const text = `${DATA_FENCE}\n${spendText(spendReport(graph, invoices), a.months)}`;
        return { content: [{ type: "text" as const, text: capText(text, "Pass workspace to read one workspace, or months for fewer months.") }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}
