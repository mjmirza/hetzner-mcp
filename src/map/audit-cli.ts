// `hetzner-mcp audit`: the same report the map shows, for a terminal, a file, or a CI job.
// Default output is a short summary; --out writes the full Markdown report, --json the raw data.
import { writeFileSync } from "node:fs";
import { loadConfig } from "../config.js";
import { collectGraph } from "./collect.js";
import { sampleGraph } from "./sample.js";
import { audit, auditMarkdown, type AuditReport } from "./audit.js";

/** A few lines an AI or a person can act on without reading the whole report. */
export function auditSummary(r: AuditReport, currency = "EUR", top = 5): string {
  const money = (v: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(v);
  const lines = [
    `Audit score ${r.score}/100 (grade ${r.grade}). ${r.counts.critical} critical, ${r.counts.high} high, ${r.counts.medium} medium, ${r.counts.low} low.`,
  ];
  if (r.monthlySaving > 0) lines.push(`Fixing the cost findings saves about ${money(r.monthlySaving)} a month.`);
  r.findings.slice(0, top).forEach((f, i) => {
    const where = [f.resource.project, f.resource.label].filter(Boolean).join("/");
    lines.push(`${i + 1}. [${f.severity}] ${f.title}: ${where}${f.monthlySaving ? ` (saves ${money(f.monthlySaving)}/mo)` : ""}`);
  });
  if (r.findings.length > top) lines.push(`${r.findings.length - top} more in the full report.`);
  if (!r.findings.length) lines.push("Nothing to fix right now.");
  return lines.join("\n");
}

export async function runAudit(argv: string[]): Promise<number> {
  const demo = argv.includes("--demo");
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  if (outIdx >= 0 && (!out || out.startsWith("--"))) {
    process.stderr.write("Usage: hetzner-mcp audit [--demo] [--json] [--out report.md] [--fail-on critical|high]\n");
    return 2;
  }
  const failOn = argv.includes("--fail-on") ? argv[argv.indexOf("--fail-on") + 1] : undefined;
  const graph = demo ? sampleGraph() : await collectGraph(loadConfig());
  const report = graph.audit ?? audit(graph);

  if (argv.includes("--json")) process.stdout.write(JSON.stringify(report) + "\n");
  else process.stdout.write(auditSummary(report, graph.currency) + "\n");
  if (out) {
    writeFileSync(out, auditMarkdown(report, graph.currency));
    process.stderr.write(`Full report written to ${out}\n`);
  }
  for (const c of graph.caveats.filter((x) => x.startsWith("No Cloud token") || x.startsWith("Project"))) process.stderr.write(`Note: ${c}\n`);

  // Lets a CI job fail when serious findings appear, without failing on low ones.
  if (failOn === "critical" && report.counts.critical > 0) return 1;
  if (failOn === "high" && report.counts.critical + report.counts.high > 0) return 1;
  return 0;
}
