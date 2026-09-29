import dagre from "@dagrejs/dagre";

/** Plain sizes and links, so the layout can run in a Web Worker as well as on the page. */
export interface LayoutPlan {
  direction: "LR" | "TB";
  nodes: Array<{ id: string; w: number; h: number }>;
  /** Tree links first; weight marks the relation links the connections view also weighs. */
  edges: Array<{ source: string; target: string; weight?: number }>;
}

/** Card centres by id. */
export function runDagre(plan: LayoutPlan): Map<string, { x: number; y: number }> {
  const lr = plan.direction === "LR";
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: plan.direction, nodesep: lr ? 28 : 36, ranksep: lr ? 88 : 72, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of plan.nodes) g.setNode(n.id, { width: n.w, height: n.h });
  for (const e of plan.edges) {
    if (e.weight === undefined) g.setEdge(e.source, e.target);
    else if (!g.hasEdge(e.source, e.target) && !g.hasEdge(e.target, e.source)) g.setEdge(e.source, e.target, { weight: e.weight, minlen: 1 });
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of plan.nodes) {
    const p = g.node(n.id);
    out.set(n.id, { x: p.x, y: p.y });
  }
  return out;
}
