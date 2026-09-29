// MCP tool for the infrastructure audit. Summary first to save tokens; the model asks for one
// finding's full fix steps by number instead of receiving every playbook at once.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { collectGraph } from "../map/collect.js";
import { sampleGraph } from "../map/sample.js";
import { audit, auditMarkdown, findingMarkdown } from "../map/audit.js";
import { auditSummary } from "../map/audit-cli.js";

export function registerAuditTool(server: McpServer, cfg: HetznerConfig): void {
  server.registerTool(
    "infra_audit",
    {
      title: "Audit infrastructure",
      description:
        "Read-only. Audits every configured Hetzner project for security, cost, reliability and hygiene issues. " +
        "Returns a score, counts and the top findings. Pass finding=N for one finding's full fix steps, or full=true for the whole report.",
      inputSchema: {
        finding: z.number().int().min(1).optional().describe("Number of one finding to expand with fix steps."),
        full: z.boolean().optional().describe("Return the full Markdown report. Large."),
        top: z.number().int().min(1).max(50).optional().describe("How many findings in the summary. Default 8."),
        demo: z.boolean().optional().describe("Use the labelled sample estate."),
      },
    },
    async (a) => {
      try {
        const graph = a.demo ? sampleGraph() : await collectGraph(cfg);
        const report = graph.audit ?? audit(graph);
        let text: string;
        if (a.finding) {
          const f = report.findings[a.finding - 1];
          if (!f) return { content: [{ type: "text" as const, text: `No finding ${a.finding}. There are ${report.findings.length}.` }], isError: true };
          text = findingMarkdown(f, a.finding, graph.currency);
        } else if (a.full) {
          text = auditMarkdown(report, graph.currency);
        } else {
          text = auditSummary(report, graph.currency, a.top ?? 8);
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}
