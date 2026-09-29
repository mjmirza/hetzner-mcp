// Spend history: estimates what the resources running today cost per month, checks added invoices,
// and reconciles the two. No Node imports, so the browser, the server and the MCP tool share it.
import type { InfraGraph, NodeKind } from "./types.js";
import { oneLine } from "../text.js";

export interface InvoiceItem {
  pos: number;
  product: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  net: number;
}

/** One summary line of an invoice: a project (or another service) for one service month. */
export interface InvoiceProject {
  name: string;
  /** Service month as YYYY-MM. */
  period: string;
  net: number;
  tax: number;
  gross: number;
  items: InvoiceItem[];
}

/** The only fields ever read from an invoice. Names, addresses and account numbers are never kept. */
export interface SpendInvoice {
  number: string;
  /** Invoice date as YYYY-MM-DD. */
  date: string;
  currency: "EUR";
  net: number;
  tax: number;
  gross: number;
  /** Stated tax rate in percent, null when the invoice does not state a single rate. */
  taxRate: number | null;
  projects: InvoiceProject[];
}

export interface StoredInvoice extends SpendInvoice {
  addedAt: string;
  workspace?: string;
}

export type RecStatus = "matches" | "invoice_higher" | "invoice_lower" | "invoice_missing" | "not_on_map";

export const STATUS_LABEL: Record<RecStatus, string> = {
  matches: "Matches",
  invoice_higher: "Invoice higher",
  invoice_lower: "Invoice lower",
  invoice_missing: "Invoice missing",
  not_on_map: "Not on the map",
};

export const STATUS_HINT: Record<RecStatus, string> = {
  matches: "Within 5 % of the estimate.",
  invoice_higher: "Usually resources you already deleted, extra traffic, or a resize during the month.",
  invoice_lower: "Usually credits, or resources that were turned off for part of the month.",
  invoice_missing: "The estimate shows usage but no invoice for this month was added. Download it in the Hetzner Console under Invoices.",
  not_on_map: "This project is on the invoice but not on the map, for example a deleted or renamed project.",
};

export interface ReconRow {
  month: string;
  project: string;
  estimate: number;
  billed: number | null;
  status: RecStatus;
  diff: number | null;
  diffPct: number | null;
}

export interface SpendMonth {
  month: string;
  estimate: number;
  /** Net billed on added invoices for this service month, null when none was added. */
  billed: number | null;
  billedGross: number | null;
  /** Estimate of only the projects that have an invoice this month, the base of the comparison. */
  compared: number | null;
  /** current: the running month, not invoiced yet. none: no usage and no invoice. */
  status: RecStatus | "current" | "none";
  diff: number | null;
  diffPct: number | null;
  missingProjects: string[];
}

export interface SpendReport {
  generatedAt: string;
  currency: "EUR";
  vatRate: number;
  source: InfraGraph["source"];
  workspace?: string;
  thisMonth: { month: string; soFar: number; projected: number };
  estimatedTotal: number;
  months: SpendMonth[];
  byProject: Array<{ project: string; account: string; soFar: number; projected: number; total: number; billed: number | null }>;
  byKind: Array<{ kind: NodeKind; projected: number; count: number }>;
  topDrivers: Array<{ id: string; label: string; kind: NodeKind; project?: string; projected: number }>;
  invoices: Array<{ number: string; date: string; net: number; tax: number; gross: number; taxRate: number | null; items: number; projects: Array<{ name: string; period: string; net: number; gross: number }> }>;
  reconciliation: ReconRow[];
  validation: {
    invoices: number;
    valid: number;
    problems: string[];
    overlaps: string[];
    monthsWithInvoice: number;
    monthsMatching: number;
    missingMonths: string[];
    summary: string;
  };
  notes: string[];
}

const HOUR = 3_600_000;
/** Past months estimated at most, counted back from the current month. */
export const MAX_MONTHS = 24;
/** Allowed rounding difference per line, in euro. */
const CENT = 0.01 + 1e-9;
/** An invoice within this share of the estimate counts as matching. */
const MATCH_SHARE = 0.05;

const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const euro = (n: number) => eur.format(n);

export const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
function monthBounds(key: string): { start: number; end: number } {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) };
}
export const prevMonth = (key: string) => monthKey(monthBounds(key).start - 1);
const nextMonth = (key: string) => monthKey(monthBounds(key).end);

/** One resource in one calendar month, in UTC hours. Each started hour counts, capped at the monthly price. */
export function accrueMonth(r: { monthly: number; hourly?: number | null; created: number }, month: string, until?: number): number {
  const { start, end } = monthBounds(month);
  const from = Math.max(r.created, start);
  const to = Math.min(until ?? end, end);
  if (!(r.monthly > 0) || to <= from) return 0;
  const hours = Math.ceil((to - from) / HOUR);
  const cost = r.hourly && r.hourly > 0 ? hours * r.hourly : (r.monthly * hours) / ((end - start) / HOUR);
  return Math.min(r.monthly, cost);
}

export interface SpendResource {
  id: string;
  label: string;
  kind: NodeKind;
  project?: string;
  account: string;
  monthly: number;
  hourly: number | null;
  created: number;
}

/** VAT rate in percent from the graph, else read from its note, else zero. */
function vatRateOf(g: Pick<InfraGraph, "vatRate" | "vatNote">): number {
  if (typeof g.vatRate === "number" && Number.isFinite(g.vatRate) && g.vatRate >= 0) return g.vatRate;
  const m = /VAT rate ([\d.]+)\s*%/.exec(g.vatNote ?? "");
  return m ? Number(m[1]) : 0;
}

const SKIP = new Set<NodeKind>(["account", "project", "location"]);

/** Every priced resource with its net monthly and hourly price and its start, for the estimate. */
export function spendResources(g: InfraGraph, now: number): { list: SpendResource[]; unpriced: number; undated: number } {
  const net = 1 / (1 + vatRateOf(g) / 100);
  const list: SpendResource[] = [];
  let unpriced = 0;
  let undated = 0;
  const thisMonth = monthBounds(monthKey(now)).start;
  for (const n of g.nodes) {
    if (SKIP.has(n.kind)) continue;
    if (typeof n.monthly !== "number") {
      unpriced++;
      continue;
    }
    if (n.monthly <= 0) continue;
    const created = Date.parse(String(n.details.created ?? ""));
    const dated = Number.isFinite(created) && created <= now;
    if (!dated) undated++;
    const hourly = typeof n.details.hourly === "number" && n.details.hourly > 0 ? n.details.hourly * net : null;
    list.push({ id: n.id, label: n.label, kind: n.kind, project: n.project, account: n.account, monthly: n.monthly * net, hourly, created: dated ? created : thisMonth });
  }
  return { list, unpriced, undated };
}

const norm = (s: string) => s.trim().toLowerCase();

/** Arithmetic checks on one invoice. Returns one plain message per problem, empty when it adds up. */
export function validateInvoice(inv: SpendInvoice): string[] {
  const out: string[] = [];
  const tag = `Invoice ${inv.number}`;
  if (!inv.projects.length) out.push(`${tag} has no project lines.`);
  const off = (a: number, b: number, lines = 1) => Math.abs(a - b) > CENT * lines;
  for (const p of inv.projects) {
    const where = `${tag}, "${p.name}" (${p.period})`;
    if (p.items.length) {
      const sum = p.items.reduce((s, i) => s + i.net, 0);
      if (off(sum, p.net)) out.push(`${where}: the line items add up to ${euro(sum)}, but the subtotal is ${euro(p.net)}.`);
    }
    if (off(p.net + p.tax, p.gross)) out.push(`${where}: net ${euro(p.net)} plus tax ${euro(p.tax)} is ${euro(p.net + p.tax)}, but the gross is ${euro(p.gross)}.`);
    if (inv.taxRate !== null && off((p.net * inv.taxRate) / 100, p.tax)) out.push(`${where}: tax ${euro(p.tax)} is not ${inv.taxRate} % of ${euro(p.net)}, which is ${euro((p.net * inv.taxRate) / 100)}.`);
  }
  const lines = Math.max(1, inv.projects.length);
  const nets = inv.projects.reduce((s, p) => s + p.net, 0);
  const taxes = inv.projects.reduce((s, p) => s + p.tax, 0);
  const grosses = inv.projects.reduce((s, p) => s + p.gross, 0);
  if (off(nets, inv.net, lines)) out.push(`${tag}: the project lines add up to ${euro(nets)} net, but the invoice total is ${euro(inv.net)}.`);
  if (off(taxes, inv.tax, lines)) out.push(`${tag}: the project lines add up to ${euro(taxes)} tax, but the invoice states ${euro(inv.tax)}.`);
  if (off(grosses, inv.gross, lines)) out.push(`${tag}: the project lines add up to ${euro(grosses)} gross, but the invoice states ${euro(inv.gross)}.`);
  if (off(inv.net + inv.tax, inv.gross)) out.push(`${tag}: net ${euro(inv.net)} plus tax ${euro(inv.tax)} is ${euro(inv.net + inv.tax)}, but the total is ${euro(inv.gross)}.`);
  if (inv.taxRate !== null && off((inv.net * inv.taxRate) / 100, inv.tax, lines)) out.push(`${tag}: total tax ${euro(inv.tax)} is not ${inv.taxRate} % of ${euro(inv.net)}, which is ${euro((inv.net * inv.taxRate) / 100)}.`);
  return out;
}

/** The same project and service month on more than one invoice, so it may be counted twice. */
export function findOverlaps(invoices: SpendInvoice[]): string[] {
  const seen = new Map<string, { name: string; period: string; numbers: string[] }>();
  for (const inv of invoices) {
    for (const p of inv.projects) {
      const k = `${norm(p.name)}\u0000${p.period}`;
      const e = seen.get(k) ?? { name: p.name, period: p.period, numbers: [] };
      if (!e.numbers.includes(inv.number)) e.numbers.push(inv.number);
      seen.set(k, e);
    }
  }
  return [...seen.values()].filter((e) => e.numbers.length > 1).map((e) => `"${e.name}" ${e.period} appears on invoices ${e.numbers.join(" and ")}.`);
}

/** Compares billed net with the estimate for the same period. Within 5 % counts as matching. */
export function classify(billed: number, estimate: number): { status: RecStatus; diff: number; diffPct: number | null } {
  const diff = r2(billed - estimate);
  const diffPct = estimate > 0 ? Math.round((diff / estimate) * 1000) / 10 : null;
  if (Math.abs(diff) <= Math.max(estimate * MATCH_SHARE, 0.01)) return { status: "matches", diff, diffPct };
  return { status: diff > 0 ? "invoice_higher" : "invoice_lower", diff, diffPct };
}

export function spendReport(g: InfraGraph, stored: SpendInvoice[], now = Date.now()): SpendReport {
  const { list, unpriced, undated } = spendResources(g, now);
  const current = monthKey(now);
  const checked = stored.map((inv) => ({ inv, problems: validateInvoice(inv) }));
  const invoices = checked.filter((c) => c.problems.length === 0).map((c) => c.inv);

  let first = current;
  for (const r of list) if (monthKey(r.created) < first) first = monthKey(r.created);
  for (const inv of invoices) for (const p of inv.projects) if (p.period < first) first = p.period;
  let oldest = current;
  for (let i = 0; i < MAX_MONTHS; i++) oldest = prevMonth(oldest);
  if (first < oldest) first = oldest;
  const monthKeys: string[] = [];
  for (let k = first; k <= current; k = nextMonth(k)) monthKeys.push(k);

  const projects = new Map<string, { project: string; account: string; soFar: number; projected: number; total: number; billed: number | null }>();
  const byMonthProject = new Map<string, number>();
  const monthEstimate = new Map<string, number>();
  const kinds = new Map<NodeKind, { projected: number; count: number }>();
  const drivers: SpendReport["topDrivers"] = [];
  let soFar = 0;
  let projected = 0;
  for (const r of list) {
    const pname = r.project ?? "Outside projects";
    const pk = `${r.account}\u0000${pname}`;
    const p = projects.get(pk) ?? { project: pname, account: r.account, soFar: 0, projected: 0, total: 0, billed: null };
    const running = accrueMonth(r, current, now);
    const full = accrueMonth(r, current);
    p.soFar += running;
    p.projected += full;
    soFar += running;
    projected += full;
    for (const m of monthKeys) {
      const cost = m === current ? running : accrueMonth(r, m);
      if (!cost) continue;
      p.total += cost;
      monthEstimate.set(m, (monthEstimate.get(m) ?? 0) + cost);
      const k = `${m}\u0000${norm(pname)}`;
      byMonthProject.set(k, (byMonthProject.get(k) ?? 0) + cost);
    }
    projects.set(pk, p);
    const kd = kinds.get(r.kind) ?? { projected: 0, count: 0 };
    kd.projected += full;
    kd.count++;
    kinds.set(r.kind, kd);
    drivers.push({ id: r.id, label: r.label, kind: r.kind, project: r.project, projected: r2(full) });
  }

  const onMap = new Set([...projects.values()].map((p) => norm(p.project)));
  const billedPM = new Map<string, number>();
  const billedMonth = new Map<string, { net: number; gross: number }>();
  const billedByProject = new Map<string, number>();
  for (const inv of invoices) {
    for (const p of inv.projects) {
      const k = `${p.period}\u0000${norm(p.name)}`;
      billedPM.set(k, (billedPM.get(k) ?? 0) + p.net);
      const bm = billedMonth.get(p.period) ?? { net: 0, gross: 0 };
      bm.net += p.net;
      bm.gross += p.gross;
      billedMonth.set(p.period, bm);
      billedByProject.set(norm(p.name), (billedByProject.get(norm(p.name)) ?? 0) + p.net);
    }
  }

  // One row per project and finished month that has an estimate, an invoice, or both.
  const rows: ReconRow[] = [];
  const names = new Map<string, string>();
  for (const p of projects.values()) names.set(norm(p.project), p.project);
  for (const inv of invoices) for (const p of inv.projects) if (!names.has(norm(p.name))) names.set(norm(p.name), p.name);
  for (const m of monthKeys) {
    if (m >= current) continue;
    for (const [key, name] of names) {
      const est = r2(byMonthProject.get(`${m}\u0000${key}`) ?? 0);
      const billed = billedPM.get(`${m}\u0000${key}`);
      if (billed === undefined) {
        if (est > 0) rows.push({ month: m, project: name, estimate: est, billed: null, status: "invoice_missing", diff: null, diffPct: null });
        continue;
      }
      if (!onMap.has(key)) {
        rows.push({ month: m, project: name, estimate: 0, billed: r2(billed), status: "not_on_map", diff: null, diffPct: null });
        continue;
      }
      rows.push({ month: m, project: name, estimate: est, billed: r2(billed), ...classify(billed, est) });
    }
  }

  const months: SpendMonth[] = monthKeys.map((m) => {
    const estimate = r2(monthEstimate.get(m) ?? 0);
    const bm = billedMonth.get(m);
    const base = { month: m, estimate, billed: bm ? r2(bm.net) : null, billedGross: bm ? r2(bm.gross) : null, compared: null, diff: null, diffPct: null };
    if (m === current) return { ...base, status: "current" as const, missingProjects: [] };
    const mine = rows.filter((r) => r.month === m);
    const missingProjects = mine.filter((r) => r.status === "invoice_missing").map((r) => r.project);
    const compared = mine.filter((r) => r.billed !== null && r.status !== "not_on_map");
    if (compared.length) {
      const est = r2(compared.reduce((s, r) => s + (byMonthProject.get(`${m}\u0000${norm(r.project)}`) ?? 0), 0));
      return { ...base, ...classify(compared.reduce((s, r) => s + (r.billed ?? 0), 0), est), compared: est, missingProjects };
    }
    if (missingProjects.length) return { ...base, status: "invoice_missing" as const, missingProjects };
    return { ...base, status: mine.length ? ("not_on_map" as const) : ("none" as const), missingProjects };
  });

  for (const p of projects.values()) {
    const b = billedByProject.get(norm(p.project));
    p.billed = b === undefined ? null : r2(b);
  }

  const problems = checked.flatMap((c) => c.problems);
  const overlaps = findOverlaps(invoices);
  const judged = months.filter((m) => m.status === "matches" || m.status === "invoice_higher" || m.status === "invoice_lower");
  const matching = judged.filter((m) => m.status === "matches").length;
  const missingMonths = months.filter((m) => m.missingProjects.length > 0).map((m) => m.month);
  const bad = checked.length - invoices.length;
  const parts: string[] = [];
  if (!checked.length) parts.push("No invoices added yet");
  else parts.push(`${checked.length} ${checked.length === 1 ? "invoice" : "invoices"}, ${bad ? `${bad} did not add up and ${bad === 1 ? "is" : "are"} left out` : "all totals check out"}`);
  if (judged.length) parts.push(`${matching} of ${judged.length} ${judged.length === 1 ? "month matches" : "months match"} the estimate`);
  if (missingMonths.length) parts.push(`${missingMonths.length} ${missingMonths.length === 1 ? "month is" : "months are"} missing an invoice`);
  if (overlaps.length) parts.push(`${overlaps.length} service ${overlaps.length === 1 ? "month is" : "months are"} on more than one invoice`);

  const notes = [
    "Estimated from what your account runs today. Resources you already deleted are not included. Add your invoices for exact amounts.",
    "Past months assume each resource always had its current size and price. Amounts are in euro, net of VAT.",
  ];
  if (undated) notes.push(`${undated} ${undated === 1 ? "resource has" : "resources have"} no creation date and ${undated === 1 ? "is" : "are"} counted from the start of this month.`);
  if (unpriced) notes.push(`${unpriced} ${unpriced === 1 ? "resource has" : "resources have"} no known price and ${unpriced === 1 ? "is" : "are"} left out, for example dedicated servers.`);

  const byProject = [...projects.values()]
    .map((p) => ({ ...p, soFar: r2(p.soFar), projected: r2(p.projected), total: r2(p.total) }))
    .sort((a, b) => b.projected - a.projected);
  return {
    generatedAt: new Date(now).toISOString(),
    currency: "EUR",
    vatRate: vatRateOf(g),
    source: g.source,
    ...(g.workspace !== undefined ? { workspace: g.workspace } : {}),
    thisMonth: { month: current, soFar: r2(soFar), projected: r2(projected) },
    estimatedTotal: r2(months.reduce((s, m) => s + m.estimate, 0)),
    months,
    byProject,
    byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, projected: r2(v.projected), count: v.count })).sort((a, b) => b.projected - a.projected),
    topDrivers: drivers.sort((a, b) => b.projected - a.projected).slice(0, 8),
    invoices: invoices
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .map((inv) => ({
        number: inv.number,
        date: inv.date,
        net: inv.net,
        tax: inv.tax,
        gross: inv.gross,
        taxRate: inv.taxRate,
        items: inv.projects.reduce((s, p) => s + p.items.length, 0),
        projects: inv.projects.map((p) => ({ name: p.name, period: p.period, net: p.net, gross: p.gross })),
      })),
    reconciliation: rows,
    validation: { invoices: checked.length, valid: invoices.length, problems, overlaps, monthsWithInvoice: judged.length, monthsMatching: matching, missingMonths, summary: `${parts.join(". ")}.` },
    notes,
  };
}

const label = (s: RecStatus | "current" | "none") => (s === "current" ? "Running" : s === "none" ? "No usage" : STATUS_LABEL[s]);

/** Compact text for an MCP client, most useful lines first. */
export function spendText(r: SpendReport, maxMonths = 14): string {
  const lines: string[] = [];
  if (r.source === "sample") lines.push("SAMPLE DATA, not your account.");
  lines.push(`This month (${r.thisMonth.month}) so far ${euro(r.thisMonth.soFar)}, projected ${euro(r.thisMonth.projected)}. Estimates, net of VAT, EUR.`);
  lines.push(`Validation. ${r.validation.summary}`);
  lines.push("", "Month  estimate  billed  status");
  for (const m of r.months.slice(-maxMonths).reverse()) {
    const diff = m.diffPct !== null ? ` (${m.diffPct > 0 ? "+" : ""}${m.diffPct} %)` : "";
    const gap = m.missingProjects.length && m.status !== "invoice_missing" ? `, no invoice for ${m.missingProjects.map((p) => oneLine(p, 60)).join(", ")}` : "";
    lines.push(`${m.month}  ${euro(m.estimate)}  ${m.billed === null ? "-" : euro(m.billed)}  ${label(m.status)}${diff}${gap}`);
  }
  if (r.byProject.length) {
    lines.push("", "By project. month so far, projected, estimated total, billed on invoices");
    for (const p of r.byProject.slice(0, 15)) lines.push(`  ${oneLine(p.project, 60)} (${oneLine(p.account, 60)}). ${euro(p.soFar)}, ${euro(p.projected)}, ${euro(p.total)}, ${p.billed === null ? "no invoices" : euro(p.billed)}`);
    if (r.byProject.length > 15) lines.push(`  and ${r.byProject.length - 15} more`);
  }
  if (r.invoices.length) {
    const net = r.invoices.reduce((s, i) => s + i.net, 0);
    const gross = r.invoices.reduce((s, i) => s + i.gross, 0);
    lines.push("", `Invoices added. ${r.invoices.length}, ${euro(net)} net, ${euro(gross)} gross.`);
  }
  for (const p of r.validation.problems.slice(0, 5)) lines.push(`Check failed. ${oneLine(p, 300)}`);
  for (const o of r.validation.overlaps.slice(0, 5)) lines.push(`Overlap. ${oneLine(o, 300)}`);
  lines.push("", ...r.notes);
  return lines.join("\n");
}
