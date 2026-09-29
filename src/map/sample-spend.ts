// Synthetic invoices for the sample estate, built from its own estimate so the Spend tab shows every
// state: months that match, one billed higher, one billed lower, and months with no invoice.
import { accrueMonth, monthKey, prevMonth, spendResources, type InvoiceItem, type InvoiceProject, type SpendInvoice, type SpendResource } from "./spend.js";
import type { InfraGraph } from "./types.js";

const r2 = (n: number) => Math.round(n * 100) / 100;
const RATE = 19;

function product(g: InfraGraph, r: SpendResource): string {
  const d = g.nodes.find((n) => n.id === r.id)?.details ?? {};
  const type = typeof d.type === "string" ? d.type.toUpperCase() : "";
  switch (r.kind) {
    case "server": return `${type} Cloud Server`;
    case "load_balancer": return `${type} Load Balancer`;
    case "volume": return `Volume ${d.size_gb ?? ""} GB`.replace("  ", " ");
    case "primary_ip": return "Primary IPv4";
    case "floating_ip": return "Floating IPv4";
    case "snapshot": return "Snapshot storage";
    case "storage_box": return `Storage Box ${type}`.trim();
    default: return r.kind;
  }
}

function line(g: InfraGraph, list: SpendResource[], project: string, month: string, scale: number, extra: number): InvoiceProject | null {
  const merged = new Map<string, { quantity: number; net: number }>();
  for (const r of list.filter((x) => x.project === project)) {
    const cost = accrueMonth(r, month) * scale;
    if (cost <= 0) continue;
    const name = product(g, r);
    const e = merged.get(name) ?? { quantity: 0, net: 0 };
    e.quantity++;
    e.net += cost;
    merged.set(name, e);
  }
  if (!merged.size) return null;
  const items: InvoiceItem[] = [...merged.entries()].map(([name, e], i) => {
    const net = r2(e.net);
    return { pos: i + 1, product: name, unit: "Month", quantity: e.quantity, unitPrice: r2(net / e.quantity), net };
  });
  if (extra > 0) items.push({ pos: items.length + 1, product: "Traffic above the included allowance", unit: "TB", quantity: r2(extra), unitPrice: 1, net: r2(extra) });
  const net = r2(items.reduce((s, i) => s + i.net, 0));
  const tax = r2((net * RATE) / 100);
  return { name: project, period: month, net, tax, gross: r2(net + tax), items };
}

function invoice(number: string, month: string, projects: InvoiceProject[]): SpendInvoice {
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 2)).toISOString().slice(0, 10);
  const net = r2(projects.reduce((s, p) => s + p.net, 0));
  const tax = r2(projects.reduce((s, p) => s + p.tax, 0));
  return { number, date: next, currency: "EUR", net, tax, gross: r2(net + tax), taxRate: RATE, projects };
}

/** Twelve invoices, one per account for six of the last seven months, so one month has none. */
export function sampleInvoices(g: InfraGraph, now = Date.now()): SpendInvoice[] {
  const { list } = spendResources(g, now);
  const finished: string[] = [];
  for (let m = prevMonth(monthKey(now)); finished.length < 7; m = prevMonth(m)) finished.push(m);
  const out: SpendInvoice[] = [];
  finished.forEach((m, i) => {
    if (i === 2) return;
    // One month billed higher (extra traffic), one lower (a credit), the rest within a few percent.
    const scale = i === 5 ? 0.82 : 1 + ((i % 3) - 1) * 0.015;
    const extra = i === 1 ? 16 : 0;
    const acme = [line(g, list, "production", m, scale, extra), line(g, list, "staging", m, scale, 0)].filter((p): p is InvoiceProject => !!p);
    if (acme.length) out.push(invoice(`SAMPLE-${m.replace("-", "")}-A`, m, acme));
    const blog = line(g, list, "blog", m, 1, 0);
    if (blog) out.push(invoice(`SAMPLE-${m.replace("-", "")}-B`, m, [blog]));
  });
  return out;
}
