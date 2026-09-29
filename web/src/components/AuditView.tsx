import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown02Icon, Copy02Icon, Download04Icon, SecurityCheckIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { cityName } from "@/lib/glossary";
import { auditMarkdown, type AuditFinding, type Severity } from "../../../src/map/audit";
import type { InfraGraph } from "@/lib/types";

// The audit the map builds on every refresh. Most serious first, one finding open at a time,
// and every fix spelled out as numbered steps plus the exact thing to ask the AI.
const SEV: Record<Severity, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-risk text-primary-foreground" },
  high: { label: "High", cls: "bg-risk-soft text-risk" },
  medium: { label: "Medium", cls: "bg-secondary text-foreground" },
  low: { label: "Low", cls: "bg-secondary text-muted-foreground" },
};
type Filter = "all" | Severity | "cost";

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Could not copy. Select the text instead."),
  );
}

function Finding({ f, n, open, onToggle, currency, onShow }: { f: AuditFinding; n: number; open: boolean; onToggle: () => void; currency: string; onShow: (id: string) => void }) {
  const where = [f.resource.project, cityName(f.resource.location)].filter(Boolean).join(" · ");
  return (
    <li>
      <Card className="gap-0 py-0 shadow-none">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <span className="w-6 shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">{n}</span>
          <span className={cn("w-16 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold", SEV[f.severity].cls)}>{SEV[f.severity].label}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="line-clamp-2 text-[14px] font-medium sm:truncate">{f.title}</span>
            <span className="truncate text-[12px] text-muted-foreground">
              {f.resource.label}
              {where ? ` · ${where}` : ""}
            </span>
          </span>
          {f.monthlySaving ? <span className="hidden shrink-0 text-[13px] font-medium tabular-nums sm:inline">Save {money(f.monthlySaving, currency)}</span> : null}
          <ArrowDown02Icon size={16} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <CardContent className="flex flex-col gap-3 px-4 pt-1 pb-4 text-[13px] leading-5 sm:pl-[6.25rem]">
            {f.monthlySaving ? <div className="font-medium sm:hidden">Saves {money(f.monthlySaving, currency)} a month</div> : null}
            <p>
              <span className="font-semibold">What. </span>
              {f.what}
            </p>
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">Why it matters. </span>
              {f.why}
            </p>
            <div>
              <div className="mb-1 font-semibold">Fix it in the Hetzner Console</div>
              <ol className="flex list-decimal flex-col gap-1 pl-5">
                {f.console.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
            <div>
              <div className="mb-1 font-semibold">Or ask your AI</div>
              <ul className="flex flex-col gap-1.5">
                {f.mcp.map((s) => (
                  <li key={s} className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2">
                    <span className="min-w-0 flex-1 break-words">{s}</span>
                    <Button variant="ghost" size="icon-xs" className="shrink-0 rounded-md" aria-label="Copy this instruction" onClick={() => copy(s)}>
                      <Copy02Icon size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <Button variant="secondary" size="sm" className="rounded-lg" onClick={() => onShow(f.resource.id)}>
                Show on the map
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </li>
  );
}

export function AuditView({ graph, onShow, initialOpen = 0 }: { graph: InfraGraph; onShow: (id: string) => void; initialOpen?: number }) {
  const report = graph.audit;
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(initialOpen);
  const list = useMemo(() => {
    if (!report) return [];
    return report.findings
      .map((f, i) => ({ f, n: i + 1 }))
      .filter(({ f }) => (filter === "all" ? true : filter === "cost" ? (f.monthlySaving ?? 0) > 0 : f.severity === filter));
  }, [report, filter]);

  if (!report) return <p className="rounded-xl p-6 text-[14px] text-muted-foreground">The audit is not available for this map.</p>;

  const download = () => {
    const url = URL.createObjectURL(new Blob([auditMarkdown(report, graph.currency)], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hetzner-audit-${report.generatedAt.slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const chips: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: "All", count: report.findings.length },
    { id: "critical", label: "Critical", count: report.counts.critical },
    { id: "high", label: "High", count: report.counts.high },
    { id: "medium", label: "Medium", count: report.counts.medium },
    { id: "low", label: "Low", count: report.counts.low },
    { id: "cost", label: "Saves money", count: report.findings.filter((f) => (f.monthlySaving ?? 0) > 0).length },
  ];

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-3 sm:p-5">
        <Card aria-label="Audit summary" className="rounded-xl py-4 shadow-none">
          <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-xl bg-secondary">
              <span className="text-[22px] leading-6 font-semibold tabular-nums">{report.score}</span>
              <span className="text-[11px] text-muted-foreground">of 100</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[16px] font-semibold">
                <SecurityCheckIcon size={18} /> Grade {report.grade}
              </div>
              <p className="text-[13px] text-muted-foreground">
                {report.findings.length ? `${report.findings.length} things to look at, most serious first.` : "Nothing to fix right now."}
                {report.monthlySaving > 0 ? ` Fixing the cost ones saves about ${money(report.monthlySaving, graph.currency)} a month.` : ""}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">Each project starts at 100 and loses 25 per critical, 12 per high, 6 per medium and 2 per low finding.</p>
            </div>
            <Button variant="secondary" size="sm" className="self-start rounded-lg sm:self-auto" onClick={download}>
              <Download04Icon size={16} /> Download report
            </Button>
          </CardContent>
        </Card>

        {report.scopes.length > 1 && (
          <section aria-label="Score by project" className="flex flex-col gap-1">
            <h2 className="px-1 text-[13px] font-semibold">By project</h2>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {report.scopes.map((s) => (
                <li key={`${s.account}|${s.project ?? ""}`}>
                  <Card className="flex-row items-center justify-between gap-3 px-3 py-2 shadow-none">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{s.project ?? "Outside projects"}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {s.account} · {s.findings} {s.findings === 1 ? "finding" : "findings"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[15px] font-semibold tabular-nums">{s.score}</span>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div role="toolbar" aria-label="Filter findings" className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Button key={c.id} size="sm" variant={filter === c.id ? "secondary" : "ghost"} aria-pressed={filter === c.id} className={cn("rounded-lg", filter === c.id && "font-semibold")} onClick={() => setFilter(c.id)} disabled={c.count === 0 && c.id !== "all"}>
              {c.label}
              <span className="text-muted-foreground tabular-nums">{c.count}</span>
            </Button>
          ))}
        </div>

        {list.length === 0 ? (
          <p className="rounded-xl bg-secondary px-4 py-6 text-center text-[14px] text-muted-foreground">Nothing in this group.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map(({ f, n }) => (
              <Finding key={`${f.code}-${f.resource.id}`} f={f} n={n} open={open === n - 1} onToggle={() => setOpen((o) => (o === n - 1 ? null : n - 1))} currency={graph.currency} onShow={onShow} />
            ))}
          </ul>
        )}

        <Card aria-label="What this audit cannot see" className="gap-1 px-4 py-3 text-[12px] leading-5 text-muted-foreground shadow-none">
          <div className="font-semibold text-foreground">What this audit cannot see</div>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {report.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
