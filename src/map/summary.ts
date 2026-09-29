/** Plain-text and Mermaid views of the graph, for MCP clients that cannot open a browser. */
import type { InfraGraph } from "./types.js";

const fmt = (v: number | null, cur: string) =>
  v == null ? "not priced" : new Intl.NumberFormat("en-DE", { style: "currency", currency: cur }).format(v);

export function summarize(g: InfraGraph, url?: string): string {
  const cur = g.currency;
  const lines: string[] = [];
  if (g.source === "sample") lines.push("SAMPLE DATA, not your account.");
  lines.push(`Estimated monthly cost ${fmt(g.totals.monthly, cur)} across ${g.totals.byProject.length} project(s). ${g.vatNote}`);
  if (url) lines.push(`Interactive map. ${url}`);
  lines.push("", "By project");
  for (const p of g.totals.byProject) lines.push(`  ${p.project} (${p.account}). ${fmt(p.monthly, cur)}, ${p.resources} resources${p.error ? `, unreadable. ${p.error}` : ""}`);
  if (g.totals.topDrivers.length) {
    lines.push("", "Top cost drivers");
    for (const d of g.totals.topDrivers.slice(0, 5)) lines.push(`  ${d.label} (${d.kind}, ${d.project ?? "account"}). ${fmt(d.monthly, cur)}`);
  }
  if (g.totals.findings.length) {
    const s = g.totals.findings.reduce((a, f) => a + (f.monthly ?? 0), 0);
    lines.push("", `Worth a look, about ${fmt(s, cur)} per month`);
    for (const f of g.totals.findings.slice(0, 8)) lines.push(`  ${f.title}${f.monthly ? ` ${fmt(f.monthly, cur)}` : ""}`);
  }
  lines.push("", ...g.caveats);
  return lines.join("\n");
}

const safe = (s: string) => s.replace(/["[\]{}()<>|#;`]/g, " ").slice(0, 40);

export function toMermaid(g: InfraGraph): string {
  const idOf = new Map<string, string>();
  g.nodes.forEach((n, i) => idOf.set(n.id, `n${i}`));
  const byParent = new Map<string, string[]>();
  for (const n of g.nodes) {
    const key = n.parent ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), n.id]);
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = ["flowchart LR"];
  const walk = (id: string, depth: number) => {
    const n = byId.get(id)!;
    const pad = "  ".repeat(depth);
    const kids = byParent.get(id) ?? [];
    const cost = n.monthly ? ` ${n.monthly.toFixed(2)} ${g.currency}` : "";
    if (["account", "project", "location", "network"].includes(n.kind) || kids.length) {
      out.push(`${pad}subgraph ${idOf.get(id)}["${n.kind} ${safe(n.label)}"]`);
      if (!["account", "project", "location", "network"].includes(n.kind)) out.push(`${pad}  ${idOf.get(id)}_self["${safe(n.label)}${cost}"]`);
      kids.forEach((k) => walk(k, depth + 1));
      out.push(`${pad}end`);
    } else {
      out.push(`${pad}${idOf.get(id)}["${n.kind} ${safe(n.label)}${cost}"]`);
    }
  };
  (byParent.get("") ?? []).forEach((id) => walk(id, 1));
  const ref = (id: string) => ((byParent.get(id)?.length && !["account", "project", "location", "network"].includes(byId.get(id)!.kind)) ? `${idOf.get(id)}_self` : idOf.get(id));
  for (const e of g.edges) out.push(`  ${ref(e.from)} -->|${e.kind}| ${ref(e.to)}`);
  return out.join("\n");
}
