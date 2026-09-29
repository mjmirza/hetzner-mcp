/** Rolls node prices up into project, kind, top-driver, and finding totals. */
import type { InfraGraph, MapEdge, MapNode, NodeKind } from "./types.js";

const round = (n: number) => Math.round(n * 100) / 100;

export function finalize(input: {
  source: InfraGraph["source"];
  currency: string;
  vatNote: string;
  nodes: MapNode[];
  edges: MapEdge[];
  errors: Array<{ project: string; account: string; error: string }>;
  projectCount: number;
}): InfraGraph {
  const { nodes, edges } = input;
  const billable = nodes.filter((n) => typeof n.monthly === "number" && n.monthly > 0);
  const monthly = round(billable.reduce((s, n) => s + (n.monthly as number), 0));

  const byProject = nodes
    .filter((n) => n.kind === "project")
    .map((p) => {
      const inside = nodes.filter((n) => n.project === p.project && n.account === p.account && !["project", "location", "account"].includes(n.kind));
      const err = input.errors.find((e) => e.project === p.project && e.account === p.account)?.error;
      return {
        project: p.label,
        account: p.account,
        monthly: round(inside.reduce((s, n) => s + (n.monthly ?? 0), 0)),
        resources: inside.length,
        ...(err ? { error: err } : {}),
      };
    })
    .sort((a, b) => b.monthly - a.monthly);

  const kinds = new Map<NodeKind, { monthly: number; count: number }>();
  for (const n of nodes) {
    if (["account", "project", "location"].includes(n.kind)) continue;
    const k = kinds.get(n.kind) ?? { monthly: 0, count: 0 };
    k.monthly += n.monthly ?? 0;
    k.count += 1;
    kinds.set(n.kind, k);
  }
  const byKind = [...kinds.entries()]
    .map(([kind, v]) => ({ kind, monthly: round(v.monthly), count: v.count }))
    .sort((a, b) => b.monthly - a.monthly);

  const topDrivers = billable
    .slice()
    .sort((a, b) => (b.monthly as number) - (a.monthly as number))
    .slice(0, 8)
    .map((n) => ({ nodeId: n.id, label: n.label, kind: n.kind, project: n.project, monthly: n.monthly as number }));

  const rank = { risk: 0, waste: 1, info: 2 } as const;
  const findings = nodes
    .flatMap((n) => n.flags.map((f) => ({ nodeId: n.id, project: n.project, kind: f.kind, title: `${n.label}. ${f.text}`, monthly: f.monthly })))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || (b.monthly ?? 0) - (a.monthly ?? 0));

  const caveats = [
    "Costs are estimates from Hetzner list prices, not your invoice. Hetzner has no Cloud billing API.",
    "Traffic above the included allowance, partial hours, and Robot dedicated servers are not priced.",
  ];
  if (input.projectCount === 0 && input.source === "live") {
    caveats.unshift("No Cloud token found. Set HETZNER_CLOUD_TOKEN, or run: npx hetzner-mcp setup");
  }
  for (const e of input.errors) caveats.push(`Project ${e.project} could not be read. ${e.error}`);

  return {
    source: input.source,
    generatedAt: new Date().toISOString(),
    currency: input.currency,
    vatNote: input.vatNote,
    nodes,
    edges,
    totals: { monthly, byProject, byKind, topDrivers, findings },
    caveats,
  };
}
