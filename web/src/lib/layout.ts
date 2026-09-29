import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { InfraGraph, MapNode } from "./types";
import { SHELF_KINDS } from "./format";
import { relationsByNode } from "./relations";

export type Direction = "LR" | "TB";
export type View = "hierarchy" | "connections";

export interface CardData extends Record<string, unknown> {
  node: MapNode;
  /** Volumes and IPs folded into their server card, so they never float as loose boxes. */
  rows: MapNode[];
  /** Hidden descendants when this card is collapsed. 0 when it has no children. */
  childCount: number;
  collapsed: boolean;
  direction: Direction;
  dim: boolean;
  related: boolean;
  /** Short relation sentences shown on the card, for example "Protected by web-fw". */
  links: string[];
}

const FOLD_INTO_SERVER = new Set(["volume", "primary_ip"]);
const WIDTH = { account: 240, project: 260, location: 220, network: 220, shelf: 280, default: 264 } as const;

function widthOf(n: MapNode): number {
  if (n.id.endsWith("#shelf")) return WIDTH.shelf;
  return (WIDTH as Record<string, number>)[n.kind] ?? WIDTH.default;
}

function heightOf(n: MapNode, rows: number, links: number): number {
  if (n.kind === "account") return 72;
  if (n.kind === "project") return 92;
  if (n.kind === "location" || n.kind === "network") return 64;
  if (n.id.endsWith("#shelf")) return 52 + rows * 34;
  return 76 + (n.flags.some((f) => f.kind !== "info") ? 28 : 0) + rows * 34 + (links ? 8 + links * 20 : 0) + (rows ? 8 : 0);
}

export interface BuildResult {
  nodes: Node<CardData>[];
  edges: Edge[];
  /** Maps any graph node id (even folded ones) to the card that shows it. */
  hostOf: Map<string, string>;
}

/**
 * Turns the infra graph into a tidy tree. Only parent-child links are drawn, so no line ever
 * crosses a card. Relations (firewall protects, load balancer routes) appear on selection.
 */
export function buildFlow(
  graph: InfraGraph,
  opts: {
    view: View;
    direction: Direction;
    collapsed: Set<string>;
    focusProject: string | null;
    selected: string | null;
    positions: Map<string, { x: number; y: number }>;
    /** Real card heights measured in the browser. They replace the estimate so nothing overlaps. */
    heights?: Map<string, number>;
    /** Run the dots along every line, like a workflow executing. */
    animate?: boolean;
  },
): BuildResult {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const hostOf = new Map<string, string>();
  const rows = new Map<string, MapNode[]>();
  const cards: MapNode[] = [];

  // Fold attachments into their server, and project-wide items into one shelf per project.
  const shelves = new Map<string, MapNode>();
  for (const n of graph.nodes) {
    const parent = n.parent ? byId.get(n.parent) : undefined;
    if (FOLD_INTO_SERVER.has(n.kind) && parent?.kind === "server") {
      hostOf.set(n.id, parent.id);
      rows.set(parent.id, [...(rows.get(parent.id) ?? []), n]);
      continue;
    }
    if (SHELF_KINDS.has(n.kind) && parent?.kind === "project") {
      const shelfId = `${parent.id}#shelf`;
      if (!shelves.has(shelfId)) {
        const shelf: MapNode = { id: shelfId, kind: "firewall", label: "Project-wide", parent: parent.id, project: parent.project, account: parent.account, monthly: 0, flags: [], details: {} };
        shelves.set(shelfId, shelf);
        cards.push(shelf);
      }
      const shelf = shelves.get(shelfId)!;
      shelf.monthly = (shelf.monthly ?? 0) + (n.monthly ?? 0);
      hostOf.set(n.id, shelfId);
      rows.set(shelfId, [...(rows.get(shelfId) ?? []), n]);
      continue;
    }
    hostOf.set(n.id, n.id);
    cards.push(n);
  }

  const rel = relationsByNode(graph);
  const linksOf = (id: string) => [...new Set((rel.get(id) ?? []).filter((r) => hostOf.get(r.otherId) !== id).map((r) => r.text))].slice(0, 3);

  const children = new Map<string, string[]>();
  for (const c of cards) if (c.parent) children.set(c.parent, [...(children.get(c.parent) ?? []), c.id]);

  // Project focus keeps the account and that one project subtree.
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const visible = new Set<string>();
  const descendants = (id: string): number => (children.get(id) ?? []).reduce((s, c) => s + 1 + descendants(c), 0);
  const walk = (id: string) => {
    visible.add(id);
    if (opts.collapsed.has(id)) return;
    for (const c of children.get(id) ?? []) walk(c);
  };
  const roots = cards.filter((c) => !c.parent || !cardById.has(c.parent));
  for (const r of roots) {
    if (!opts.focusProject) {
      walk(r.id);
      continue;
    }
    const inFocus = (children.get(r.id) ?? []).some((c) => c === opts.focusProject);
    if (!inFocus) continue;
    visible.add(r.id);
    walk(opts.focusProject);
  }

  // Relations for the selected card, mapped onto the cards that show each end.
  const selectedHost = opts.selected ? hostOf.get(opts.selected) ?? opts.selected : null;
  const relatedCards = new Set<string>();
  const relEdges: Edge[] = [];
  const members = selectedHost ? new Set([selectedHost, ...graph.nodes.filter((n) => hostOf.get(n.id) === selectedHost).map((n) => n.id)]) : null;
  const seenPair = new Set<string>();
  {
    graph.edges.forEach((e, i) => {
      const touches = members ? members.has(e.from) || members.has(e.to) : false;
      if (!touches && opts.view !== "connections") return;
      const a = hostOf.get(e.from);
      const b = hostOf.get(e.to);
      if (!a || !b || a === b || !visible.has(a) || !visible.has(b)) return;
      // The card already sits under its network or project, a second line adds nothing.
      if (cardById.get(a)?.parent === b || cardById.get(b)?.parent === a) return;
      // A folded volume or IP already sits inside its server card, so its link needs no line.
      if ((e.kind === "attached" || e.kind === "assigned") && hostOf.get(e.from) !== e.from) return;
      const pair = `${a}|${b}|${e.kind}`;
      if (seenPair.has(pair)) return;
      seenPair.add(pair);
      if (touches) {
        relatedCards.add(a);
        relatedCards.add(b);
      }
      relEdges.push({
        id: `rel-${i}`,
        source: a,
        target: b,
        type: "relation",
        className: touches ? "relation hot" : "relation",
        label: e.kind.replace("_", " "),
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        zIndex: 10,
        animated: opts.animate === true,
      });
    });
    if (selectedHost) relatedCards.add(selectedHost);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: opts.direction, nodesep: opts.direction === "LR" ? 28 : 36, ranksep: opts.direction === "LR" ? 88 : 72, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const size = new Map<string, { w: number; h: number }>();
  for (const id of visible) {
    const c = cardById.get(id)!;
    const estimate = heightOf(c, rows.get(id)?.length ?? 0, c.id.endsWith("#shelf") || c.kind === "account" || c.kind === "project" || c.kind === "location" || c.kind === "network" ? 0 : linksOf(id).length);
    const s = { w: widthOf(c), h: opts.heights?.get(id) ?? estimate };
    size.set(id, s);
    g.setNode(id, { width: s.w, height: s.h });
  }
  const treeEdges: Edge[] = [];
  for (const id of visible) {
    const c = cardById.get(id)!;
    if (c.parent && visible.has(c.parent)) {
      g.setEdge(c.parent, id);
      treeEdges.push({ id: `t-${c.parent}->${id}`, source: c.parent, target: id, type: "smoothstep", className: "tree", selectable: false, animated: opts.animate === true });
    }
  }
  // In the connections view the layout also weighs the relations, so linked cards sit close
  // together and the lines stay short instead of cutting across the canvas.
  if (opts.view === "connections") {
    for (const e of relEdges) if (!g.hasEdge(e.source, e.target) && !g.hasEdge(e.target, e.source)) g.setEdge(e.source, e.target, { weight: 1, minlen: 1 });
  }
  dagre.layout(g);

  const nodes: Node<CardData>[] = [];
  for (const id of visible) {
    const c = cardById.get(id)!;
    const p = g.node(id);
    const s = size.get(id)!;
    const manual = opts.positions.get(id);
    nodes.push({
      id,
      type: "card",
      position: manual ?? { x: p.x - s.w / 2, y: p.y - s.h / 2 },
      width: s.w,
      data: {
        node: c,
        rows: rows.get(id) ?? [],
        childCount: descendants(id),
        collapsed: opts.collapsed.has(id),
        direction: opts.direction,
        dim: selectedHost != null && !relatedCards.has(id),
        related: selectedHost != null && relatedCards.has(id) && id !== selectedHost,
        links: linksOf(id),
      },
      selected: id === selectedHost,
    });
  }
  return { nodes, edges: [...treeEdges, ...relEdges], hostOf };
}
