import { useMemo, useState } from "react";
import { Alert02Icon, CheckmarkCircle02Icon, CoinsEuroIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { KIND_ICON } from "@/components/InfraNode";
import { cn } from "@/lib/utils";
import { KIND_LABEL, money, visible } from "@/lib/format";
import { cityName } from "@/lib/glossary";
import type { InfraGraph, MapNode } from "@/lib/types";

// The estate as a calm, flat list. One project per section, one line per resource, the most
// urgent things first, and plain words next to every icon. Built to be easy to scan.
type Filter = "all" | "attention" | "save" | "paid";

// Networks are real resources, so they are listed; only grouping levels are left out.
const CONTAINERS = new Set(["account", "project", "location"]);

const FILTERS: Array<{ id: Filter; label: string; test: (n: MapNode) => boolean }> = [
  { id: "all", label: "Everything", test: () => true },
  { id: "attention", label: "Needs attention", test: (n) => n.flags.some((f) => f.kind === "risk") },
  { id: "save", label: "Can save money", test: (n) => n.flags.some((f) => f.kind === "waste") },
  { id: "paid", label: "Costs money", test: (n) => (n.monthly ?? 0) > 0 },
];

function rank(n: MapNode): number {
  if (n.flags.some((f) => f.kind === "risk")) return 0;
  if (n.flags.some((f) => f.kind === "waste")) return 1;
  return 2;
}

/** One plain line under the name, for example "Volume in Falkenstein, available, on web-1". */
function where(n: MapNode, byId: Map<string, MapNode>): string {
  const parent = n.parent ? byId.get(n.parent) : undefined;
  const bits = [KIND_LABEL[n.kind]];
  const city = cityName(n.location);
  if (city) bits[0] += ` in ${city}`;
  if (n.status) bits.push(n.status);
  if (parent && !CONTAINERS.has(parent.kind)) bits.push(`on ${parent.label}`);
  return bits.join(", ");
}

function Status({ n, currency }: { n: MapNode; currency: string }) {
  const risk = n.flags.some((f) => f.kind === "risk");
  const waste = n.flags.filter((f) => f.kind === "waste");
  if (risk) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-risk-soft px-2 py-0.5 text-[12px] font-medium text-risk">
        <Alert02Icon size={13} /> Needs attention
      </span>
    );
  }
  if (waste.length) {
    const save = waste.reduce((s, f) => s + (f.monthly ?? 0), 0);
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[12px] font-medium">
        <CoinsEuroIcon size={13} /> {save > 0 ? `Save ${money(save, currency)}` : "Can save"}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-[12px] text-muted-foreground">
      <CheckmarkCircle02Icon size={13} className="text-ok" /> OK
    </span>
  );
}

export function ListView({ graph, focus, selected, onSelect }: { graph: InfraGraph; focus: string | null; selected: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // The project a node belongs to, found by walking up its parents.
  const projectOf = useMemo(() => {
    const memo = new Map<string, string | null>();
    const find = (n: MapNode | undefined): string | null => {
      if (!n) return null;
      if (n.kind === "project") return n.id;
      if (memo.has(n.id)) return memo.get(n.id)!;
      const p = find(n.parent ? byId.get(n.parent) : undefined);
      memo.set(n.id, p);
      return p;
    };
    return find;
  }, [byId]);

  const resources = graph.nodes.filter((n) => !CONTAINERS.has(n.kind) && (!focus || projectOf(n) === focus));
  const sort = (a: MapNode, b: MapNode) => rank(a) - rank(b) || (b.monthly ?? 0) - (a.monthly ?? 0);
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, resources.filter(f.test).length])) as Record<Filter, number>;
  const test = FILTERS.find((f) => f.id === filter)!.test;
  const section = (key: string, title: string, owner: string, mine: MapNode[]) => ({
    key,
    title,
    owner,
    items: mine.filter(test).sort(sort),
    total: mine.reduce((s, n) => s + (n.monthly ?? 0), 0),
  });
  // Dedicated servers and Storage Boxes live on the account, outside any Cloud project.
  const loose = [...new Set(resources.filter((n) => !projectOf(n)).map((n) => n.account))].map((acc) =>
    section(`loose:${acc}`, "Outside projects", `${acc} · dedicated servers and Storage Boxes`, resources.filter((n) => !projectOf(n) && n.account === acc)),
  );
  const sections = [
    ...graph.nodes.filter((n) => n.kind === "project" && (!focus || n.id === focus)).map((p) => section(p.id, p.label, String(p.account), resources.filter((n) => projectOf(n) === p.id))),
    ...loose,
  ].filter((s) => s.items.length > 0);

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-3 sm:p-5">
        <div role="toolbar" aria-label="Filter resources" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button key={f.id} size="sm" variant={filter === f.id ? "secondary" : "ghost"} aria-pressed={filter === f.id} className={cn("rounded-lg", filter === f.id && "font-semibold")} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="text-muted-foreground tabular-nums">{counts[f.id]}</span>
            </Button>
          ))}
        </div>

        {sections.length === 0 && (
          <div className="rounded-xl border px-4 py-6 text-center text-[14px] text-muted-foreground">
            {filter === "attention" ? "Nothing needs attention right now." : filter === "save" ? "No savings found right now." : "No resources here yet."}
          </div>
        )}

        {sections.map(({ key, title, owner, items, total }) => (
          <section key={key} aria-label={title} className="flex flex-col gap-1.5">
            <div className="flex items-end justify-between gap-3 px-1">
              <div className="min-w-0">
                <h2 className="truncate text-[16px] font-semibold">{title}</h2>
                <div className="truncate text-[12px] text-muted-foreground">
                  {owner} · {items.length} {items.length === 1 ? "resource" : "resources"}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[15px] font-semibold tabular-nums">{money(total, graph.currency)}</div>
                <div className="text-[12px] text-muted-foreground">per month</div>
              </div>
            </div>
            <ul className="flex flex-col gap-1">
              {items.map((n) => {
                const Icon = KIND_ICON[n.kind];
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(n.id)}
                      aria-current={selected === n.id ? "true" : undefined}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        selected === n.id && "border-primary",
                      )}
                    >
                      <Icon size={18} className="shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[14px] font-medium">{visible(n.label)}</span>
                        <span className="truncate text-[12px] text-muted-foreground">{where(n, byId)}</span>
                        <span className="mt-1 sm:hidden">
                          <Status n={n} currency={graph.currency} />
                        </span>
                      </span>
                      <span className="hidden sm:inline-flex">
                        <Status n={n} currency={graph.currency} />
                      </span>
                      <span className="w-20 shrink-0 text-right text-[14px] tabular-nums">{n.monthly != null && n.monthly > 0 ? money(n.monthly, graph.currency) : "free"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
