// MCP tool for the infrastructure audit. Summary first to save tokens; the model asks for one
// finding's full fix steps by number instead of receiving every playbook at once.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HetznerConfig } from "../config.js";
import { collectGraph } from "../map/collect.js";
import { cachedGraph } from "../map/graph-cache.js";
import { sampleGraph } from "../map/sample.js";
import { audit, auditMarkdown, findingMarkdown } from "../map/audit.js";
import { auditSummary } from "../map/audit-cli.js";
import { DATA_FENCE } from "../text.js";
import { capText } from "../format.js";

/** Rows of the per-project table, shown on the first page only. */
const PAGE_SCOPES = 20;

export function registerAuditTool(server: McpServer, cfg: HetznerConfig): void {
  server.registerTool(
    "infra_audit",
    {
      title: "Audit infrastructure",
      description:
        "Read-only. Audits every configured Hetzner project for security, cost, reliability and hygiene issues. " +
        "Returns a score, counts and the top findings. Pass finding=N for one finding's full fix steps, or full=true for the whole report.",
      inputSchema: {
        finding: z.number().int().min(1).optional().describe("One finding, with fix steps."),
        full: z.boolean().optional().describe("Full report, 10 findings per page."),
        page: z.number().int().min(1).optional().describe("Page of the full report."),
        top: z.number().int().min(1).max(50).optional().describe("Summary size. Default 8."),
        demo: z.boolean().optional().describe("Use the labelled sample estate."),
        refresh: z.boolean().optional(),
      },
    },
    async (a) => {
      try {
        const graph = a.demo ? sampleGraph() : await cachedGraph(JSON.stringify({}), () => collectGraph(cfg), { refresh: a.refresh });
        const report = graph.audit ?? audit(graph);
        let text: string;
        if (a.finding) {
          const f = report.findings[a.finding - 1];
          if (!f) return { content: [{ type: "text" as const, text: `No finding ${a.finding}. There are ${report.findings.length}.` }], isError: true };
          text = `${DATA_FENCE}\n\n${findingMarkdown(f, a.finding, graph.currency)}`;
        } else if (a.full) {
          const per = 10;
          const pages = Math.max(1, Math.ceil(report.findings.length / per));
          const page = Math.min(a.page ?? 1, pages);
          const findings = report.findings.slice((page - 1) * per, page * per);
          text = `${DATA_FENCE}\n\n${auditMarkdown({ ...report, findings }, graph.currency, (page - 1) * per, { maxScopes: page === 1 ? PAGE_SCOPES : 0 })}`;
          if (page < pages) text += `\nPage ${page} of ${pages}. Call again with page=${page + 1}.`;
        } else {
          text = auditSummary(report, graph.currency, a.top ?? 8);
          if (report.findings.length) text = `${DATA_FENCE}\n${text}`;
        }
        return { content: [{ type: "text" as const, text: capText(text, "Ask for one finding with finding=N.") }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}
