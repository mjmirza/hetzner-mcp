// Turns the text of a Hetzner invoice PDF into totals and line items. Reads only the invoice number,
// date, project summary lines and line items; names, addresses and account numbers are skipped.
import { validateInvoice, type InvoiceItem, type InvoiceProject, type SpendInvoice } from "./spend.js";

/** One positioned text run from a PDF page. y grows upwards, as in PDF coordinates. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

/** Rebuilds lines from positioned text: one baseline per line, wide gaps kept as two spaces. */
export function linesFromItems(items: TextItem[]): string[] {
  const sorted = items.filter((i) => i.str.length > 0).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const tol = Math.max(2, (it.height || 10) * 0.4);
    if (row && row[0]!.page === it.page && Math.abs(row[0]!.y - it.y) <= tol) row.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let out = "";
    let end = -Infinity;
    for (const it of row) {
      const gap = it.x - end;
      const h = it.height || 10;
      if (out) out += gap > h * 0.9 ? "  " : gap > h * 0.12 && !out.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
      out += it.str;
      end = it.x + it.width;
    }
    return out.replace(/\s+$/, "");
  });
}

export type ParseResult = { ok: true; invoice: SpendInvoice } | { ok: false; error: string };

const A = String.raw`(-?\d[\d.,]*)\s*€`;
const CODE = String.raw`(?:\s*[A-Z]{1,2}\d{0,2})?`;
const SUMMARY = new RegExp(String.raw`^(.+?)\s+(\d{2})/(\d{4})\s+${A}\s+${A}${CODE}\s+${A}$`);
const TOTAL = new RegExp(String.raw`^(?:Summe|Total|Sum)\s+${A}\s+${A}${CODE}\s+${A}$`, "i");
const RATE = new RegExp(String.raw`^(?:[A-Z]{1,2}\d{0,2}\s+)?(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s+${A}\s+${A}\s+${A}$`);
const SECTION = /^(?:Projekt|Project)\s+"(.+)"\s*\((\d{2})\/(\d{4})\)$/;
const UNITS = "Monate|Monat|Months?|Stunden|Stunde|Hours?|Tage|Tag|Days?|TB|GB|Stück|Stk\\.?|Pieces?|pcs|x";
const ITEM = new RegExp(String.raw`^(\d+)\s+(\d+(?:[.,]\d+)?)\s+(.+?)\s+(${UNITS})\s+(-?\d[\d.,]*)\s+${A}\s+${A}$`);
const ITEM_WIDE = new RegExp(String.raw`^(\d+)\s+(\d+(?:[.,]\d+)?)\s+(.+?)\s{2,}(\S+)\s+(-?\d[\d.,]*)\s+${A}\s+${A}$`);
const SUBTOTAL = new RegExp(String.raw`^(?:Zwischensumme|Subtotal)\s+${A}$`, "i");
const NUMBER = /(?:Rechnungsnummer|Invoice\s+(?:number|no\.?))\s*:?\s*([A-Za-z0-9-]{3,40})\b/i;
const DATE = /(?:Rechnungsdatum|Invoice\s+date)\s*:?\s*(?:(\d{1,2})[./](\d{1,2})[./](\d{4})|(\d{4})-(\d{2})-(\d{2}))/i;

function amount(raw: string, decimalComma: boolean): number {
  const s = raw.replace(/\s|€/g, "");
  return Number(decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
}

const QUOTED = /^(?:Projekt|Project)\s+"(.+)"$/;
const unquote = (name: string) => QUOTED.exec(name.trim())?.[1] ?? name.trim();
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Parses invoice text lines. Anything missing, or totals that do not add up, is refused with a reason. */
export function parseInvoiceText(input: string | string[]): ParseResult {
  const lines = (Array.isArray(input) ? input : input.split(/\r?\n/)).map((l) => l.replace(/ /g, " ").trim()).filter(Boolean);
  const text = lines.join("\n");
  const decimalComma = /Rechnungsnummer|Rechnungsdatum|Zwischensumme|Leistungszeitraum/.test(text);
  const num = (s: string) => amount(s, decimalComma);

  const nm = NUMBER.exec(text);
  if (!nm) return { ok: false, error: "Could not find the invoice number. Is this a Hetzner invoice PDF?" };
  const dm = DATE.exec(text);
  if (!dm) return { ok: false, error: "Could not find the invoice date." };
  const [y, m, d] = dm[4] ? [dm[4], dm[5]!, dm[6]!] : [dm[3]!, dm[2]!.padStart(2, "0"), dm[1]!.padStart(2, "0")];
  const date = `${y}-${m}-${d}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || Number(m) > 12 || Number(d) > 31) return { ok: false, error: `The invoice date ${dm[0]} is not a valid date.` };

  const projects: InvoiceProject[] = [];
  const itemsOf = new Map<string, InvoiceItem[]>();
  const subtotalOf = new Map<string, number>();
  let total: { net: number; tax: number; gross: number } | null = null;
  const rates = new Set<number>();
  const projectRows = new Set<number>();
  let section: string | null = null;
  for (const line of lines) {
    const sec = SECTION.exec(line);
    if (sec) {
      section = `${sec[1]!.trim().toLowerCase()}\u0000${sec[3]}-${sec[2]}`;
      continue;
    }
    const it = ITEM.exec(line) ?? ITEM_WIDE.exec(line);
    if (it && section) {
      const list = itemsOf.get(section) ?? [];
      list.push({ pos: Number(it[1]), product: it[3]!.trim(), unit: it[4]!, quantity: num(it[5]!), unitPrice: num(it[6]!), net: num(it[7]!) });
      itemsOf.set(section, list);
      continue;
    }
    const sub = SUBTOTAL.exec(line);
    if (sub && section) {
      subtotalOf.set(section, num(sub[1]!));
      continue;
    }
    const tot = TOTAL.exec(line);
    if (tot) {
      total ??= { net: num(tot[1]!), tax: num(tot[2]!), gross: num(tot[3]!) };
      continue;
    }
    const rate = RATE.exec(line);
    if (rate) {
      rates.add(Number(rate[1]!.replace(",", ".")));
      continue;
    }
    const s = SUMMARY.exec(line);
    if (s && !section) {
      if (QUOTED.test(s[1]!.trim())) projectRows.add(projects.length);
      projects.push({ name: unquote(s[1]!), period: `${s[3]}-${s[2]}`, net: num(s[4]!), tax: num(s[5]!), gross: num(s[6]!), items: [] });
    }
  }

  if (!projects.length) return { ok: false, error: "Could not find any project lines with a service period and amounts in euro." };
  if (!total) return { ok: false, error: "Could not find the invoice total (the Summe line)." };
  for (const [key, items] of itemsOf) {
    const p = projects.find((x) => `${x.name.toLowerCase()}\u0000${x.period}` === key);
    if (!p) return { ok: false, error: `Found line items for "${key.split("\u0000")[0]}" that have no line in the overview.` };
    p.items = items;
    const sub = subtotalOf.get(key);
    if (sub !== undefined && Math.abs(sub - p.net) > 0.01 + 1e-9) return { ok: false, error: `"${p.name}" (${p.period}): the detail subtotal is ${sub.toFixed(2)} €, but the overview says ${p.net.toFixed(2)} €.` };
  }
  const missing = projects.find((p, i) => projectRows.has(i) && p.items.length === 0);
  if (missing) return { ok: false, error: `No line items were found for "${missing.name}".` };

  const all = [...projects.flatMap((p) => [p.net, p.tax, p.gross, ...p.items.flatMap((i) => [i.quantity, i.unitPrice, i.net])]), total.net, total.tax, total.gross];
  if (all.some((v) => !Number.isFinite(v) || v < 0)) return { ok: false, error: "The invoice has an amount that could not be read as a number of zero or more." };

  const invoice: SpendInvoice = {
    number: nm[1]!,
    date,
    currency: "EUR",
    net: r2(total.net),
    tax: r2(total.tax),
    gross: r2(total.gross),
    taxRate: rates.size === 1 ? [...rates][0]! : null,
    projects,
  };
  const problems = validateInvoice(invoice);
  if (problems.length) return { ok: false, error: `The totals on this invoice do not add up, so it was not added. ${problems[0]}` };
  return { ok: true, invoice };
}
