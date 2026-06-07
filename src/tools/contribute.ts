/**
 * Contribution loop. Turns a gap into a contribution by handing the user a prefilled
 * issue link, and the steps to open a pull request if they already have the fix.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const REPO = "https://github.com/mjmirza/hetzner-mcp";

function issueUrl(title: string, body: string, labels: string): string {
  const url = new URL(`${REPO}/issues/new`);
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  url.searchParams.set("labels", labels);
  return url.toString();
}

export function registerContributeTool(server: McpServer): void {
  server.registerTool(
    "contribute_or_report",
    {
      title: "Report a gap or contribute",
      description:
        "When a Hetzner capability is missing or misbehaving, this returns a prefilled GitHub issue link and the steps to open a pull request. Every gap can become a contribution.",
      inputSchema: {
        what: z.string().min(1).describe("Describe what you wanted to do or what went wrong."),
        surface: z.enum(["cloud", "storagebox", "robot"]).optional().describe("Which surface, if known."),
        endpoint: z.string().optional().describe("Method and path if known, for example POST /servers."),
        kind: z.enum(["missing", "bug"]).optional().describe("missing capability or a bug. Default missing."),
      },
    },
    async (args) => {
      const kind = args.kind ?? "missing";
      const surface = args.surface ? `Surface: ${args.surface}\n` : "";
      const endpoint = args.endpoint ? `Endpoint: ${args.endpoint}\n` : "";
      const title =
        kind === "bug" ? `[bug] ${args.what.slice(0, 70)}` : `[missing] ${args.what.slice(0, 70)}`;
      const body =
        `## What I wanted to do\n${args.what}\n\n${surface}${endpoint}\n` +
        `## Notes\nFiled through the hetzner-mcp contribute_or_report tool. ` +
        `A workaround may be the generic ${args.surface ?? "<surface>"}_request tool.\n`;
      const labels = kind === "bug" ? "bug" : "enhancement,missing-endpoint";
      const link = issueUrl(title, body, labels);

      const text =
        `Thank you for helping the project grow. Two ways to contribute.\n\n` +
        `1. Open a prefilled issue, just review and submit:\n${link}\n\n` +
        `2. If you already have the fix, open a pull request:\n` +
        `   - Fork ${REPO}\n` +
        `   - Add or update the tool and the row in docs/ENDPOINT-AUDIT.md\n` +
        `   - Test it live against your own account and paste the result\n` +
        `   - Run npm run build and npm run hygiene, then open the PR\n` +
        `   See CONTRIBUTING.md for the full flow. Contributors are credited in docs/CREDITS.md.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
