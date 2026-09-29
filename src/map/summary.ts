/** Plain-text and Mermaid views of the graph, for MCP clients that cannot open a browser. */
import type { InfraGraph } from "./types.js";
import { DATA_FENCE, oneLine } from "../text.js";

const fmt = (v: number | null, cur: string) =>
  v == null ? "not priced" : new Intl.NumberFormat("en-DE", { style: "currency", currency: cur }).format(v);

export function summarize(g: InfraGraph, url?: string): string {
  const cur = g.currency;
  const lines: string[] = [];
  if (g.source === "sample") lines.push("SAMPLE DATA, not your account.");
  lines.push(`Estimated monthly cost ${fmt(g.totals.monthly, cur)} across ${g.totals.byProject.length} project(s). ${g.vatNote}`);
  if (url) lines.push(`Interactive map. ${url}`);
  lines.push("", DATA_FENCE, "", "By project");
  for (const p of g.totals.byProject) lines.push(`  ${oneLine(p.project)} (${oneLine(p.account)}). ${fmt(p.monthly, cur)}, ${p.resources} resources${p.error ? `, unreadable. ${oneLine(p.error, 200)}` : ""}`);
  if (g.totals.topDrivers.length) {
    lines.push("", "Top cost drivers");
    for (const d of g.totals.topDrivers.slice(0, 5)) lines.push(`  ${oneLine(d.label)} (${d.kind}, ${oneLine(d.project ?? "account")}). ${fmt(d.monthly, cur)}`);
  }
  const group = (kind: "risk" | "waste" | "info", title: string) => {
    const items = g.totals.findings.filter((f) => f.kind === kind);
    if (!items.length) return;
    const sum = items.reduce((a, f) => a + (f.monthly ?? 0), 0);
    lines.push("", kind === "waste" ? `${title}, about ${fmt(sum, cur)} a month` : title);
    for (const f of items.slice(0, 8)) lines.push(`  ${oneLine(f.title, 200)}${f.monthly ? ` ${fmt(f.monthly, cur)}` : ""}`);
    if (items.length > 8) lines.push(`  and ${items.length - 8} more, see the map`);
  };
  group("risk", "Risks to fix");
  group("waste", "Money you can save");
  group("info", "Good to know");
  lines.push("", ...g.caveats);
  return lines.join("\n");
}

// eslint-disable-next-line no-control-regex
const safe = (s: string) => s.replace(/[\u0000-\u001f\u007f"[\]{}()<>|#;`]/g, " ").slice(0, 40);

/** Bounded so a big estate cannot flood the model. The canvas has everything; this is a sketch. */
export function toMermaid(g: InfraGraph, maxNodes = 150): string {
  const idOf = new Map<string, string>();
  g.nodes.forEach((n, i) => idOf.set(n.id, `n${i}`));
  const byParent = new Map<string, string[]>();
  for (const n of g.nodes) {
    const key = n.parent ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), n.id]);
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = ["flowchart LR"];
  const shown = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (shown.size >= maxNodes) return;
    shown.add(id);
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
  for (const e of g.edges) if (shown.has(e.from) && shown.has(e.to)) out.push(`  ${ref(e.from)} -->|${e.kind}| ${ref(e.to)}`);
  if (g.nodes.length > shown.size) out.push(`  %% ${g.nodes.length - shown.size} more resources not drawn. Open the map for all of them.`);
  return out.join("\n");
}
