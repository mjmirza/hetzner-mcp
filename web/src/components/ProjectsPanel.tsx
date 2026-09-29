import { Alert02Icon, FolderAddIcon, GridViewIcon, SecurityCheckIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import type { InfraGraph } from "@/lib/types";

const SEV_WORD = { critical: "Critical", high: "High", medium: "Medium", low: "Low" } as const;

export function ProjectsPanel({ graph, focus, onFocus, onAddProject, onOpenAudit, updated }: {
  graph: InfraGraph;
  focus: string | null;
  onFocus: (projectNodeId: string | null) => void;
  onAddProject: () => void;
  /** Opens the Audit tab with this finding (0-based) expanded. */
  onOpenAudit: (finding: number) => void;
  updated: string;
}) {
  const currency = graph.currency;
  const accounts = graph.nodes.filter((n) => n.kind === "account");
  const projects = graph.nodes.filter((n) => n.kind === "project");
  const resources = graph.nodes.filter((n) => !["account", "project", "location"].includes(n.kind)).length;
  const byName = new Map(graph.totals.byProject.map((p) => [`${p.account}/${p.project}`, p]));
  const audit = graph.audit;

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
          <div className="mt-0.5 text-[12px] text-muted-foreground">Updated {updated}</div>
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

        {audit && (
          <section aria-label="Top things to fix" className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 px-2">
              <h3 className="text-[12px] font-medium">Top things to fix</h3>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                Score {audit.score} · {audit.grade}
              </span>
            </div>
            {audit.findings.length === 0 && <p className="px-2 py-2 text-[13px] text-muted-foreground">Nothing to fix right now.</p>}
            <ul className="flex flex-col gap-0.5">
              {audit.findings.slice(0, 3).map((x, i) => (
                <li key={`${x.code}-${x.resource.id}`}>
                  <Button variant="ghost" size="sm" className="h-auto w-full flex-col items-start gap-0.5 rounded-lg py-2 text-left font-normal whitespace-normal" onClick={() => onOpenAudit(i)}>
                    <span className="text-[13px] leading-snug">{x.title}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {SEV_WORD[x.severity]} · {x.resource.label}
                      {x.monthlySaving ? ` · saves ${money(x.monthlySaving, currency)}/mo` : ""}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
            {audit.findings.length > 0 && (
              <Button variant="secondary" size="sm" className="mx-2 rounded-lg" onClick={() => onOpenAudit(0)}>
                <SecurityCheckIcon size={15} /> See all {audit.findings.length} in Audit
              </Button>
            )}
          </section>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">{graph.vatNote}</p>
      </div>
    </ScrollArea>
  );
}
