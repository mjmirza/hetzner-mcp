import { Alert02Icon, CoinsEuroIcon, FolderAddIcon, GridViewIcon, InformationCircleIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import type { Finding, InfraGraph } from "@/lib/types";

function FindingList({ items, currency, onSelect, empty }: { items: Finding[]; currency: string; onSelect: (id: string) => void; empty: string }) {
  if (!items.length) return <p className="px-2 py-3 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((f) => (
        <li key={f.nodeId + f.title}>
          <Button variant="ghost" size="sm" className="h-auto w-full flex-col items-start gap-0.5 rounded-lg py-2 text-left font-normal whitespace-normal" onClick={() => onSelect(f.nodeId)}>
            <span className="text-[13px] leading-snug">{f.title}</span>
            <span className="text-[11px] text-muted-foreground">
              {f.project ?? "Account"}
              {f.monthly ? ` · ${money(f.monthly, currency)}/mo` : ""}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ProjectsPanel({ graph, focus, onFocus, onSelect, onAddProject }: {
  graph: InfraGraph;
  focus: string | null;
  onFocus: (projectNodeId: string | null) => void;
  onSelect: (id: string) => void;
  onAddProject: () => void;
}) {
  const currency = graph.currency;
  const accounts = graph.nodes.filter((n) => n.kind === "account");
  const projects = graph.nodes.filter((n) => n.kind === "project");
  const resources = graph.nodes.filter((n) => !["account", "project", "location"].includes(n.kind)).length;
  const byName = new Map(graph.totals.byProject.map((p) => [`${p.account}/${p.project}`, p]));
  const f = graph.totals.findings;
  const risks = f.filter((x) => x.kind === "risk");
  const waste = f.filter((x) => x.kind === "waste");
  const notes = f.filter((x) => x.kind === "info");

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        <div>
          <div className="text-[12px] text-muted-foreground">Estimated monthly, gross</div>
          <div className="text-[28px] leading-9 font-semibold tabular-nums">{money(graph.totals.monthly, currency)}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
            <span>{accounts.length} account{accounts.length === 1 ? "" : "s"}</span>
            <span>{projects.length} project{projects.length === 1 ? "" : "s"}</span>
            <span>{resources} resources</span>
          </div>
        </div>

        <Separator />

        <nav aria-label="Projects" className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-medium text-muted-foreground">Projects</h2>
            <Button variant="ghost" size="xs" className="rounded-md text-primary" onClick={onAddProject}>
              <FolderAddIcon size={14} /> Add
            </Button>
          </div>
          <Button variant="ghost" size="sm" aria-pressed={focus === null} className={cn("justify-start rounded-lg", focus === null && "bg-secondary")} onClick={() => onFocus(null)}>
            <GridViewIcon size={15} /> Everything
          </Button>
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-col gap-0.5">
              <div className="mt-2 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{a.label}</div>
              {projects
                .filter((p) => p.parent === a.id)
                .map((p) => {
                  const t = byName.get(`${p.account}/${p.label}`);
                  const flagged = p.flags.some((x) => x.kind === "risk");
                  return (
                    <Button
                      key={p.id}
                      variant="ghost"
                      size="sm"
                      aria-pressed={focus === p.id}
                      className={cn("h-auto justify-between gap-2 rounded-lg py-2", focus === p.id && "bg-secondary")}
                      onClick={() => onFocus(focus === p.id ? null : p.id)}
                    >
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                          {p.label}
                          {flagged && <Alert02Icon size={13} className="text-risk" aria-label="Could not be read" />}
                        </span>
                        <span className="text-[11px] font-normal text-muted-foreground">{t ? `${t.resources} resources` : "not read"}</span>
                      </span>
                      <span className="shrink-0 text-[13px] tabular-nums">{t ? money(t.monthly, currency) : ""}</span>
                    </Button>
                  );
                })}
            </div>
          ))}
        </nav>

        <Separator />

        <Tabs defaultValue={risks.length ? "risk" : "waste"}>
          <TabsList className="w-full rounded-lg">
            <TabsTrigger value="risk" className="rounded-md">
              <Alert02Icon size={14} /> {risks.length}
              <span className="sr-only"> risks</span>
            </TabsTrigger>
            <TabsTrigger value="waste" className="rounded-md">
              <CoinsEuroIcon size={14} /> {waste.length}
              <span className="sr-only"> savings</span>
            </TabsTrigger>
            <TabsTrigger value="info" className="rounded-md">
              <InformationCircleIcon size={14} /> {notes.length}
              <span className="sr-only"> notes</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="risk">
            <h3 className="px-2 pt-2 text-[12px] font-medium">Risks</h3>
            <FindingList items={risks} currency={currency} onSelect={onSelect} empty="Nothing risky found." />
          </TabsContent>
          <TabsContent value="waste">
            <h3 className="px-2 pt-2 text-[12px] font-medium">Money you could save</h3>
            <FindingList items={waste} currency={currency} onSelect={onSelect} empty="No obvious waste." />
          </TabsContent>
          <TabsContent value="info">
            <h3 className="px-2 pt-2 text-[12px] font-medium">Worth knowing</h3>
            <FindingList items={notes} currency={currency} onSelect={onSelect} empty="Nothing to note." />
          </TabsContent>
        </Tabs>

        <p className="text-[11px] leading-relaxed text-muted-foreground">{graph.vatNote}</p>
      </div>
    </ScrollArea>
  );
}
