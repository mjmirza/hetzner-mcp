import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";

// Where the straight line between two card centers leaves a card's rectangle.
function exitPoint(from: InternalNode, to: InternalNode): { x: number; y: number } {
  const w = (from.measured.width ?? 0) / 2;
  const h = (from.measured.height ?? 0) / 2;
  const cx = from.internals.positionAbsolute.x + w;
  const cy = from.internals.positionAbsolute.y + h;
  const tx = to.internals.positionAbsolute.x + (to.measured.width ?? 0) / 2;
  const ty = to.internals.positionAbsolute.y + (to.measured.height ?? 0) / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(w / Math.abs(dx || 1e-9), h / Math.abs(dy || 1e-9));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** A straight line from edge to edge of two cards, so a relation never loops around a column. */
export function RelationEdge({ id, source, target, label, markerEnd, style }: EdgeProps) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  let a = exitPoint(s, t);
  let b = exitPoint(t, s);
  let path = `M ${a.x},${a.y} L ${b.x},${b.y}`;
  let mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  // Same column or same row: bow around the cards in between instead of cutting through them.
  const box = (n: InternalNode) => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? 0, h: n.measured.height ?? 0 });
  const A = box(s);
  const B = box(t);
  const sameColumn = Math.abs(A.x + A.w / 2 - (B.x + B.w / 2)) < Math.min(A.w, B.w) / 2;
  const sameRow = !sameColumn && Math.abs(A.y + A.h / 2 - (B.y + B.h / 2)) < Math.min(A.h, B.h) / 2;
  if (sameColumn) {
    a = { x: A.x + A.w, y: A.y + A.h / 2 };
    b = { x: B.x + B.w, y: B.y + B.h / 2 };
    const bow = Math.max(a.x, b.x) + 40 + Math.abs(a.y - b.y) * 0.12;
    path = `M ${a.x},${a.y} C ${bow},${a.y} ${bow},${b.y} ${b.x},${b.y}`;
    mid = { x: bow - 10, y: (a.y + b.y) / 2 };
  } else if (sameRow) {
    a = { x: A.x + A.w / 2, y: A.y + A.h };
    b = { x: B.x + B.w / 2, y: B.y + B.h };
    const bow = Math.max(a.y, b.y) + 40 + Math.abs(a.x - b.x) * 0.12;
    path = `M ${a.x},${a.y} C ${a.x},${bow} ${b.x},${bow} ${b.x},${b.y}`;
    mid = { x: (a.x + b.x) / 2, y: bow - 10 };
  }
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-md bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground shadow-[var(--shadow)]"
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
