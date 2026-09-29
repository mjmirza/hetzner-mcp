import type { InfraGraph, MapEdge } from "./types";

export interface Relation {
  otherId: string;
  text: string;
}

/** Plain-language sentence for one end of a relation, so meaning never relies on color. */
function sentence(kind: MapEdge["kind"], outgoing: boolean, other: string, otherKind: string): string {
  switch (kind) {
    case "protects":
      return outgoing ? `Protects ${other}` : `Protected by ${other}`;
    case "routes":
      return outgoing ? `Sends traffic to ${other}` : `Behind load balancer ${other}`;
    case "assigned":
      return outgoing ? `Assigned to ${other}` : `Uses IP ${other}`;
    case "attached":
      return outgoing ? `Attached to ${other}` : `Volume ${other} attached`;
    case "backs_up":
      return outgoing ? `Copy of ${other}` : `Has a copy, ${other}`;
    case "member":
      if (otherKind === "network") return outgoing ? `In network ${other}` : `Has member ${other}`;
      return outgoing ? `Groups ${other}` : `In placement group ${other}`;
  }
}

export function relationsByNode(graph: InfraGraph): Map<string, Relation[]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Relation[]>();
  const add = (id: string, r: Relation) => out.set(id, [...(out.get(id) ?? []), r]);
  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    add(a.id, { otherId: b.id, text: sentence(e.kind, true, b.label, b.kind) });
    add(b.id, { otherId: a.id, text: sentence(e.kind, false, a.label, a.kind) });
  }
  return out;
}
