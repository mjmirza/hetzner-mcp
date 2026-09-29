import { useMemo, useState } from "react";
import { Alert02Icon, ArrowDown02Icon, ArrowRight02Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KIND_ICON } from "@/components/InfraNode";
import { cn } from "@/lib/utils";
import { KIND_LABEL, money } from "@/lib/format";
import type { InfraGraph, MapNode } from "@/lib/types";

// The same estate as a plain outline. Readable on a phone and fully keyboard and screen reader
// friendly, where a zoomable canvas is not.
export function ListView({ graph, focus, selected, onSelect }: { graph: InfraGraph; focus: string | null; selected: string | null; onSelect: (id: string) => void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const children = useMemo(() => {
    const m = new Map<string, MapNode[]>();
    for (const n of graph.nodes) if (n.parent) m.set(n.parent, [...(m.get(n.parent) ?? []), n]);
    return m;
  }, [graph]);
  const ids = new Set(graph.nodes.map((n) => n.id));
  const roots = focus ? graph.nodes.filter((n) => n.id === focus) : graph.nodes.filter((n) => !n.parent || !ids.has(n.parent));

  const item = (n: MapNode, depth: number): React.ReactNode => {
    const kids = children.get(n.id) ?? [];
    const open = !closed.has(n.id);
    const Icon = KIND_ICON[n.kind];
    const risky = n.flags.some((f) => f.kind === "risk");
    return (
      <li key={n.id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={selected === n.id}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
          {kids.length ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="rounded-md"
              aria-label={open ? `Collapse ${n.label}` : `Expand ${n.label}`}
              onClick={() =>
                setClosed((s) => {
                  const next = new Set(s);
                  if (next.has(n.id)) next.delete(n.id);
                  else next.add(n.id);
                  return next;
                })
              }
            >
              {open ? <ArrowDown02Icon size={14} /> : <ArrowRight02Icon size={14} />}
            </Button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <Button variant="ghost" size="sm" className={cn("h-auto min-h-11 flex-1 justify-between gap-3 rounded-lg py-2 font-normal", selected === n.id && "bg-secondary")} onClick={() => onSelect(n.id)}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Icon size={17} className="shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate text-[14px] font-medium">{n.label}</span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {KIND_LABEL[n.kind]}
                  {kids.length ? ` · ${kids.length} inside` : ""}
                </span>
              </span>
              {risky && <Alert02Icon size={14} className="shrink-0 text-risk" aria-label="Needs attention" />}
            </span>
            {n.monthly != null && <span className="shrink-0 text-[13px] tabular-nums">{money(n.monthly, graph.currency)}</span>}
          </Button>
        </div>
        {kids.length > 0 && open && (
          <ul role="group" className="flex flex-col">
            {kids.map((k) => item(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ScrollArea className="h-full">
      <ul role="tree" aria-label="Infrastructure" className="mx-auto flex max-w-3xl flex-col gap-0.5 p-3">
        {roots.map((r) => item(r, 0))}
      </ul>
    </ScrollArea>
  );
}
