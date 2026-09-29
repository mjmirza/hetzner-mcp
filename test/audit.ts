/** Offline tests for the infrastructure audit: playbooks, scoring, Markdown, CLI and MCP shapes. */
import { sampleGraph } from "../src/map/sample.js";
import { audit, auditMarkdown, findingMarkdown, playbookCodes } from "../src/map/audit.js";
import { auditSummary, runAudit } from "../src/map/audit-cli.js";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MapNode } from "../src/map/types.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

const g = sampleGraph();
const r = g.audit!;
assert("audit is attached to every map build", !!r && r.findings.length > 0);
assert("score is between 0 and 100", r.score >= 0 && r.score <= 100);
assert("grade matches score band", (r.score >= 90) === (r.grade === "A"));
assert("one bad project does not zero a healthy estate", r.score > 0);
assert("findings sorted most severe first", r.findings[0]!.severity === "critical");
assert("every finding has console steps", r.findings.every((f) => f.console.length > 0));
assert("every finding has an MCP step", r.findings.every((f) => f.mcp.length > 0));
assert("every finding has a reason", r.findings.every((f) => f.why.length > 20));
assert("no finding uses the fallback playbook", r.findings.every((f) => f.code !== "fallback"));
assert("open SSH is critical security", r.findings.some((f) => f.code === "fw_open_ports" && f.severity === "critical" && f.category === "security"));
assert("powered-off server saving counted", r.findings.some((f) => f.code === "server_off" && (f.monthlySaving ?? 0) > 0));
assert("savings add up", Math.abs(r.monthlySaving - r.findings.reduce((s, f) => s + (f.monthlySaving ?? 0), 0)) < 0.01);
assert("backups on production are not a cost finding", !r.findings.some((f) => f.code === "backup_surcharge" && /prod/i.test(f.resource.project ?? "")));
assert("production server without backups is flagged", r.findings.some((f) => f.code === "no_backups_prod"));
assert("counts match findings", Object.values(r.counts).reduce((a, b) => a + b, 0) === r.findings.length);
assert("every project has a scope", g.nodes.filter((n) => n.kind === "project").every((p) => r.scopes.some((s) => s.project === p.project)));
assert("limits are stated", r.limits.length >= 2);

// Every code the collector can raise has a real playbook, so no finding is ever generic.
const collectorCodes = ["backup_surcharge", "server_off", "type_retiring", "traffic_overage", "traffic_high", "volume_unattached", "ip_unassigned", "fip_unassigned", "lb_no_targets", "fw_unused", "fw_open_ports", "no_firewall", "snapshot_orphan", "snapshot_old", "cert_expired", "cert_expiring", "robot_cancelled", "project_unreadable"];
for (const c of collectorCodes) assert(`playbook exists for ${c}`, playbookCodes().includes(c));

// Edge cases.
const empty = audit({ nodes: [] });
assert("empty estate scores 100 with no findings", empty.score === 100 && empty.findings.length === 0 && empty.grade === "A");
assert("empty estate summary says nothing to fix", auditSummary(empty).includes("Nothing to fix"));
const lb = (targets: number): MapNode => ({ id: "p:A/x/lb:1", kind: "load_balancer", label: "lb", account: "A", project: "x", monthly: 5, flags: [], details: { targets } });
assert("single-target load balancer flagged", audit({ nodes: [lb(1)] }).findings.some((f) => f.code === "lb_single_target"));
assert("two-target load balancer not flagged", !audit({ nodes: [lb(2)] }).findings.some((f) => f.code === "lb_single_target"));
const unknown: MapNode = { id: "x", kind: "server", label: "s", account: "A", monthly: 1, flags: [{ kind: "risk", code: "made_up", text: "odd", monthly: null }], details: {} };
assert("unknown code still gets a usable playbook", audit({ nodes: [unknown] }).findings[0]!.console.length > 0);

// Output shapes.
const md = auditMarkdown(r, g.currency);
assert("markdown has title, table and limits", md.startsWith("# Hetzner infrastructure audit") && md.includes("| Account |") && md.includes("cannot see"));
assert("markdown numbers every finding", md.includes(`## ${r.findings.length}.`));
const one = findingMarkdown(r.findings[0]!, 1, g.currency);
assert("single finding is short, no report header", !one.includes("# Hetzner infrastructure audit") && one.length < 1500);
const sum = auditSummary(r, g.currency, 5);
assert("summary is compact", sum.split("\n").length <= 8 && sum.length < 1200);
assert("summary never contains a token-like string", !/[A-Za-z0-9]{40,}/.test(sum));

// CLI.
const dir = mkdtempSync(join(tmpdir(), "hz-audit-"));
const file = join(dir, "r.md");
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);
let captured = "";
process.stdout.write = ((c: string) => ((captured += c), true)) as typeof process.stdout.write;
process.stderr.write = (() => true) as typeof process.stderr.write;
const code = await runAudit(["--demo", "--out", file]);
const codeFail = await runAudit(["--demo", "--fail-on", "critical"]);
const codeBad = await runAudit(["--demo", "--out"]);
process.stdout.write = origOut;
process.stderr.write = origErr;
assert("cli writes the full report", readFileSync(file, "utf8").startsWith("# Hetzner infrastructure audit") && statSync(file).size > 1000);
assert("cli prints the summary", captured.includes("Audit score"));
assert("cli exit 0 by default", code === 0);
assert("cli --fail-on critical fails on a critical finding", codeFail === 1);
assert("cli rejects --out without a path", codeBad === 2);

process.stdout.write(`\n${passed}/${total} audit checks passed\n`);
if (passed !== total) process.exitCode = 1;
