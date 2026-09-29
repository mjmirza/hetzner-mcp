import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert02Icon, ArrowDown02Icon, CheckmarkCircle02Icon, Coins02Icon, Delete02Icon, DocumentValidationIcon, Upload03Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { KIND_LABEL, money, visible } from "@/lib/format";
import { api } from "@/lib/api";
import { STATUS_HINT, STATUS_LABEL, type RecStatus, type SpendMonth, type SpendReport } from "../../../src/map/spend";

// Spend history: what the resources running today cost per month, and, once invoices are added,
// what was actually billed. Estimates are always labelled as estimates, never as billed amounts.
type MonthStatus = SpendMonth["status"];
const DOT: Record<MonthStatus, string> = {
  matches: "bg-ok",
  invoice_higher: "bg-warn",
  invoice_lower: "bg-edge",
  invoice_missing: "bg-risk",
  not_on_map: "bg-muted-foreground",
  current: "bg-foreground/40",
  none: "bg-muted-foreground/40",
};
const statusText = (s: MonthStatus) => (s === "current" ? "Running" : s === "none" ? "No usage" : STATUS_LABEL[s]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (key: string, long = false) => {
  const [y, m] = key.split("-");
  return long ? `${MONTHS[Number(m) - 1]} ${y}` : MONTHS[Number(m) - 1]!;
};
const pct = (n: number | null) => (n === null ? "" : `${n > 0 ? "+" : ""}${n.toLocaleString("en-IE")} %`);

function StatusBadge({ status }: { status: MonthStatus }) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-[12px] font-medium whitespace-nowrap">
      <span aria-hidden className={cn("size-2 rounded-full", DOT[status])} />
      {statusText(status)}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-xl p-3 sm:p-5" aria-busy="true" aria-label="Loading spend history">
      {[112, 180, 220].map((h) => (
        <div key={h} className="w-full rounded-xl bg-secondary motion-safe:animate-pulse" style={{ height: h }} />
      ))}
    </div>
  );
}

function Chart({ months }: { months: SpendMonth[] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.estimate, m.billed ?? 0)));
  return (
    <section aria-label="Spend by month" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-[13px] font-semibold">By month</h2>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-edge/70" />
            Estimate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-foreground/80" />
            Billed
          </span>
        </div>
      </div>
      <Card className="gap-0 px-3 py-3 shadow-none">
        <ol className="flex h-40 items-end gap-1">
          {months.map((m) => (
            <li key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="sr-only">
                {monthName(m.month, true)}. Estimate {money(m.estimate)}. {m.billed === null ? "No invoice." : `Billed ${money(m.billed)}.`} {statusText(m.status)}.
              </span>
              <span aria-hidden className="flex h-full w-full items-end justify-center gap-px">
                <span className="w-1/2 max-w-3 rounded-t-sm bg-edge/70" style={{ height: `${(m.estimate / max) * 100}%` }} />
                <span className={cn("w-1/2 max-w-3 rounded-t-sm", m.billed === null ? "bg-transparent" : "bg-foreground/80")} style={{ height: `${((m.billed ?? 0) / max) * 100}%` }} />
              </span>
              <span aria-hidden className="text-[10px] leading-3 text-muted-foreground">{monthName(m.month)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function MonthRow({ m, report, open, onToggle }: { m: SpendMonth; report: SpendReport; open: boolean; onToggle: () => void }) {
  const rows = report.reconciliation.filter((r) => r.month === m.month);
  const hint = m.status === "current" ? "This month is still running and is invoiced early next month." : m.status === "none" ? "Nothing that runs today existed yet." : STATUS_HINT[m.status as RecStatus];
  return (
    <li>
      <Card className="gap-0 py-0 shadow-none">
        <button type="button" aria-expanded={open} onClick={onToggle} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5 text-left text-[13px] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[5.5rem_1fr_1fr_4.5rem_8.5rem_1rem]">
          <span className="order-1 font-medium">{monthName(m.month, true)}</span>
          <span className="order-2 justify-self-end sm:order-5 sm:justify-self-start">
            <StatusBadge status={m.status} />
          </span>
          <span className="order-3 min-w-0 truncate tabular-nums sm:order-2 sm:text-right">
            <span className="text-muted-foreground sm:hidden">Estimate </span>
            {money(m.estimate)}
          </span>
          <span className="order-4 min-w-0 truncate text-right tabular-nums sm:order-3">
            <span className="text-muted-foreground sm:hidden">Billed </span>
            {m.billed === null ? "none" : money(m.billed)}
          </span>
          <span className="order-5 hidden text-right text-muted-foreground tabular-nums sm:order-4 sm:inline">{pct(m.diffPct)}</span>
          <ArrowDown02Icon size={14} aria-hidden className={cn("order-6 hidden shrink-0 text-muted-foreground transition-transform sm:inline", open && "rotate-180")} />
        </button>
        {open && (
          <CardContent className="flex flex-col gap-2 px-3 pt-1 pb-3 text-[13px] leading-5">
            <p className="text-muted-foreground">{hint}</p>
            {m.compared !== null && m.diff !== null && (
              <p>
                Billed {money(m.billed)} net{m.billedGross !== null ? ` (${money(m.billedGross)} gross)` : ""}. Estimate for the same projects {money(m.compared)}. Difference {money(m.diff)}
                {m.diffPct !== null ? ` (${pct(m.diffPct)})` : ""}.
              </p>
            )}
            {rows.length > 0 && (
              <ul className="flex flex-col gap-1" aria-label={`Projects in ${monthName(m.month, true)}`}>
                {rows.map((r) => (
                  <li key={r.project} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-secondary px-3 py-1.5">
                    <span className="min-w-0 truncate font-medium">{visible(r.project)}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                      <span className="text-muted-foreground">est. {money(r.estimate)}</span>
                      <span>{r.billed === null ? "no invoice" : `billed ${money(r.billed)}`}</span>
                      <StatusBadge status={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        )}
      </Card>
    </li>
  );
}

type ImportResult = { ok: boolean; text: string };
type Reader = (f: File) => ReturnType<typeof import("@/lib/pdf").readInvoicePdf>;

function Invoices({ report, demo, workspace, onChanged }: { report: SpendReport; demo: boolean; workspace?: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const addOne = async (f: File, read: Reader): Promise<ImportResult> => {
    const parsed = await read(f);
    if (!parsed.ok) return { ok: false, text: `${visible(f.name)}: ${parsed.error}` };
    try {
      return { ok: true, text: (await api.addInvoice(parsed.invoice, workspace)).message };
    } catch (err) {
      return { ok: false, text: `${visible(f.name)}: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  const addFiles = async (files: File[]) => {
    if (demo || busy || !files.length) return;
    setBusy(true);
    const { readInvoicePdf } = await import("@/lib/pdf");
    const out: ImportResult[] = [];
    // One file after the other, so the same invoice twice in one drop is caught as a duplicate.
    await files.slice(0, 50).reduce((chain, f) => chain.then(() => addOne(f, readInvoicePdf).then((r) => void out.push(r))), Promise.resolve());
    setResults(out);
    setBusy(false);
    if (input.current) input.current.value = "";
    if (out.some((r) => r.ok)) onChanged();
  };

  const remove = async (number: string) => {
    try {
      await api.removeInvoice(number);
      toast.success(`Invoice ${number} removed`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section aria-label="Invoices" className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold">Invoices</h2>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!demo) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void addFiles([...e.dataTransfer.files]);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center text-[13px] focus-within:ring-2 focus-within:ring-ring",
          demo ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer hover:bg-secondary",
          drag && "bg-secondary",
        )}
      >
        <Upload03Icon size={20} aria-hidden />
        <span className="font-medium">{busy ? "Reading invoices…" : "Add Hetzner invoice PDFs"}</span>
        <span className="max-w-md text-muted-foreground">
          {demo
            ? "This is sample data. Start the live map to add your own invoices."
            : "Drop them here or choose files. Download them in the Hetzner Console under Invoices, or at accounts.hetzner.com. The PDF is read in this browser and only totals and line items are saved on this computer."}
        </span>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple disabled={demo || busy} className="sr-only rounded-md" aria-label="Choose invoice PDFs" onChange={(e) => void addFiles([...(e.target.files ?? [])])} />
      </label>
      {results.length > 0 && (
        <ul role="status" aria-live="polite" className="flex flex-col gap-1 text-[13px]">
          {results.map((r, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2">
              {r.ok ? <CheckmarkCircle02Icon size={16} className="mt-0.5 shrink-0 text-ok" aria-label="Added" /> : <Alert02Icon size={16} className="mt-0.5 shrink-0 text-risk" aria-label="Not added" />}
              <span className="min-w-0 break-words">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      {report.invoices.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Added invoices">
          {report.invoices.map((inv) => (
            <li key={inv.number}>
              <Card className="flex-row items-center gap-3 px-3 py-2 shadow-none">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-medium">Invoice {inv.number}</span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {inv.date} · {inv.projects.map((p) => `${visible(p.name)} ${p.period}`).join(", ")}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-[13px] tabular-nums">
                  <span className="font-medium">{money(inv.net)}</span>
                  <span className="text-[12px] text-muted-foreground">{money(inv.gross)} gross</span>
                </span>
                {!demo && (
                  <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-lg" aria-label={`Remove invoice ${inv.number}`} onClick={() => void remove(inv.number)}>
                    <Delete02Icon size={16} />
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SpendView({ workspace, generatedAt, demo }: { workspace?: string; generatedAt: string; demo: boolean }) {
  const [report, setReport] = useState<SpendReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const r = await api.spend(workspace);
      if (mine === seq.current) setReport(r);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspace]);
  useEffect(() => {
    void load();
  }, [load, generatedAt]);

  if (error && !report)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl p-6 text-center" role="alert">
        <p className="max-w-md text-[14px] text-muted-foreground">The spend history could not be loaded. {error}</p>
        <Button className="rounded-lg" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  if (!report) return <Skeleton />;

  const v = report.validation;
  const listed = report.months.slice().reverse();
  const allGood = v.invoices > 0 && v.valid === v.invoices && !v.overlaps.length;
  return (
    <div className="h-full overflow-x-hidden overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-3 sm:p-5">
        <Card aria-label="Spend summary" className="gap-3 rounded-xl px-4 py-4 shadow-none">
          <div className="flex items-center gap-2 text-[16px] font-semibold">
            <Coins02Icon size={18} aria-hidden /> Spend history
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary px-3 py-2">
              <dt className="text-[12px] text-muted-foreground">This month so far</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{money(report.thisMonth.soFar)}</dd>
            </div>
            <div className="rounded-lg bg-secondary px-3 py-2">
              <dt className="text-[12px] text-muted-foreground">Projected for {monthName(report.thisMonth.month, true)}</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{money(report.thisMonth.projected)}</dd>
            </div>
            <div className="rounded-lg bg-secondary px-3 py-2">
              <dt className="text-[12px] text-muted-foreground">Estimated since {monthName(report.months[0]!.month, true)}</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{money(report.estimatedTotal)}</dd>
            </div>
          </dl>
          <p className="text-[12px] leading-5 text-muted-foreground">{report.notes[0]} Amounts are in euro, net of VAT.</p>
          <p className="flex items-start gap-2 text-[13px]" aria-label="Validation summary">
            {allGood ? <CheckmarkCircle02Icon size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden /> : <DocumentValidationIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}
            <span>{v.summary}</span>
          </p>
        </Card>

        <Chart months={report.months} />

        <section aria-label="Months" className="flex flex-col gap-1.5">
          <h2 className="px-1 text-[13px] font-semibold">Month by month</h2>
          <div aria-hidden className="hidden grid-cols-[5.5rem_1fr_1fr_4.5rem_8.5rem_1rem] gap-x-3 rounded-xl px-3 text-[12px] text-muted-foreground sm:grid">
            <span>Month</span>
            <span className="text-right">Estimate</span>
            <span className="text-right">Billed, net</span>
            <span className="text-right">Difference</span>
            <span>Status</span>
            <span />
          </div>
          <ul className="flex flex-col gap-1.5">
            {listed.map((m) => (
              <MonthRow key={m.month} m={m} report={report} open={open === m.month} onToggle={() => setOpen((o) => (o === m.month ? null : m.month))} />
            ))}
          </ul>
        </section>

        {(v.problems.length > 0 || v.overlaps.length > 0) && (
          <Card aria-label="Invoice checks" className="gap-1 px-4 py-3 text-[13px] leading-5 shadow-none">
            <div className="flex items-center gap-2 font-semibold">
              <Alert02Icon size={16} className="text-risk" aria-hidden /> Invoice checks
            </div>
            <ul className="flex list-disc flex-col gap-0.5 pl-5">
              {[...v.problems, ...v.overlaps].map((p) => (
                <li key={p}>{visible(p)}</li>
              ))}
            </ul>
          </Card>
        )}

        <section aria-label="By project" className="flex flex-col gap-1.5">
          <h2 className="px-1 text-[13px] font-semibold">By project</h2>
          {report.byProject.length === 0 ? (
            <p className="rounded-xl bg-secondary px-4 py-6 text-center text-[14px] text-muted-foreground">No priced resources are running in this workspace.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {report.byProject.map((p) => (
                <li key={`${p.account}|${p.project}`}>
                  <Card className="gap-1 px-3 py-2 text-[13px] shadow-none">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{visible(p.project)}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{visible(p.account)}</span>
                    </span>
                    <span className="flex justify-between gap-2 tabular-nums">
                      <span className="text-muted-foreground">This month</span>
                      <span>
                        {money(p.soFar)} of {money(p.projected)}
                      </span>
                    </span>
                    <span className="flex justify-between gap-2 tabular-nums">
                      <span className="text-muted-foreground">Estimated in total</span>
                      <span>{money(p.total)}</span>
                    </span>
                    <span className="flex justify-between gap-2 tabular-nums">
                      <span className="text-muted-foreground">Billed on invoices</span>
                      <span>{p.billed === null ? "none added" : money(p.billed)}</span>
                    </span>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {report.topDrivers.length > 0 && (
          <section aria-label="Top cost drivers" className="flex flex-col gap-1.5">
            <h2 className="px-1 text-[13px] font-semibold">Top cost drivers this month</h2>
            <Card className="gap-0 px-3 py-1 shadow-none">
              <ul className="flex flex-col divide-y text-[13px]">
                {report.topDrivers.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{visible(d.label)}</span>
                      <span className="truncate text-[12px] text-muted-foreground">
                        {KIND_LABEL[d.kind]}
                        {d.project ? ` · ${visible(d.project)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(d.projected)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        <Invoices report={report} demo={demo} workspace={workspace} onChanged={() => void load()} />

        <Card aria-label="How these numbers are made" className="gap-1 px-4 py-3 text-[12px] leading-5 text-muted-foreground shadow-none">
          <div className="font-semibold text-foreground">How these numbers are made</div>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>Each resource counts from its creation date, per started hour, capped at its monthly price.</li>
            <li>A month matches when the invoice is within 5 % of the estimate for the same projects.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
