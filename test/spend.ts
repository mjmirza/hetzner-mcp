/** Offline tests for spend history: accrual math, invoice checks, reconciliation, parsing, store and endpoints. */
import { request } from "node:http";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accrueMonth, classify, findOverlaps, spendReport, spendText, validateInvoice, MAX_MONTHS, type SpendInvoice } from "../src/map/spend.js";
import { linesFromItems, parseInvoiceText, type TextItem } from "../src/map/invoice-parse.js";
import { addInvoice, checkInvoice, readInvoices, removeInvoice } from "../src/map/spend-store.js";
import { sampleGraph } from "../src/map/sample.js";
import { sampleInvoices } from "../src/map/sample-spend.js";
import { startMapServer } from "../src/map/server.js";
import { loadConfig } from "../src/config.js";
import type { InfraGraph, MapNode } from "../src/map/types.js";

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}
const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) <= eps;
const T = (iso: string) => Date.parse(iso);

// ---- Accrual math ----
{
  const old = T("2025-01-01T00:00:00Z");
  assert("a resource running the whole month costs its monthly price", near(accrueMonth({ monthly: 10, created: old }, "2026-06"), 10));
  assert("created mid-month is prorated by hours", near(accrueMonth({ monthly: 30, created: T("2026-06-16T00:00:00Z") }, "2026-06"), 15));
  assert("a started hour counts as a full hour", near(accrueMonth({ monthly: 720, created: T("2026-06-30T23:59:00Z") }, "2026-06"), 1));
  assert("created after the month costs nothing", accrueMonth({ monthly: 10, created: T("2026-07-01T00:00:00Z") }, "2026-06") === 0);
  assert("hourly price is capped at the monthly price", near(accrueMonth({ monthly: 5, hourly: 0.01, created: old }, "2026-06"), 5));
  assert("hourly price below the cap is used as is", near(accrueMonth({ monthly: 5, hourly: 0.01, created: T("2026-06-30T00:00:00Z") }, "2026-06"), 0.24));
  // March 2026 has the European clock change; in UTC the month still has 31 x 24 hours.
  assert("DST-free: March 2026 counts 744 hours", near(accrueMonth({ monthly: 744, created: T("2026-03-02T00:00:00Z") }, "2026-03"), 720));
  assert("February 2028 counts 29 days", near(accrueMonth({ monthly: 696, created: T("2028-02-28T00:00:00Z") }, "2028-02"), 48));
  assert("so far stops at now", near(accrueMonth({ monthly: 720, created: old }, "2026-06", T("2026-06-11T00:00:00Z")), 240));
  assert("zero or missing price accrues nothing", accrueMonth({ monthly: 0, created: old }, "2026-06") === 0);
}

// ---- A synthetic estate ----
const NOW = T("2026-09-15T12:00:00Z");
const node = (id: string, project: string, monthly: number | null, created: string | null, extra: Partial<MapNode> = {}): MapNode => ({
  id, kind: "server", label: id, project, account: "Acme", monthly, flags: [], details: { created, type: "cx22" }, ...extra,
});
const graph = (nodes: MapNode[], vatRate = 19): InfraGraph =>
  ({ source: "live", generatedAt: "", currency: "EUR", vatNote: "", vatRate, nodes, edges: [], totals: { monthly: 0, byProject: [], byKind: [], topDrivers: [], findings: [] }, caveats: [] }) as InfraGraph;
const inv = (number: string, projects: Array<[string, string, number]>, rate: number | null = 19): SpendInvoice => {
  const ps = projects.map(([name, period, net]) => {
    const tax = Math.round(net * (rate ?? 0)) / 100;
    return { name, period, net, tax, gross: Math.round((net + tax) * 100) / 100, items: [{ pos: 1, product: "CX22 Cloud Server", unit: "Monate", quantity: 1, unitPrice: net, net }] };
  });
  const net = Math.round(ps.reduce((s, p) => s + p.net, 0) * 100) / 100;
  const tax = Math.round(ps.reduce((s, p) => s + p.tax, 0) * 100) / 100;
  return { number, date: "2026-09-02", currency: "EUR", net, tax, gross: Math.round((net + tax) * 100) / 100, taxRate: rate, projects: ps };
};

{
  const g = graph([
    node("web", "web", 11.9, "2025-01-10T00:00:00Z"),
    node("robot", "web", null, null, { kind: "robot_server" }),
    node("undated", "web", 11.9, null),
    node("free", "web", 0, "2025-01-10T00:00:00Z", { kind: "firewall" }),
    node("old", "legacy", 11.9, "2020-01-01T00:00:00Z"),
  ]);
  const r = spendReport(g, [], NOW);
  assert("gross list prices are converted to net with the VAT rate", near(r.months.find((m) => m.month === "2026-06")!.estimate, 20));
  assert("resources older than the window are capped at the month limit", r.months.length === MAX_MONTHS + 1 && r.months[0]!.month === "2024-09");
  assert("the current month is marked running, never missing", r.months.at(-1)!.status === "current" && r.months.at(-1)!.missingProjects.length === 0);
  assert("projected month uses the whole current month", near(r.thisMonth.projected, 30));
  assert("so far is less than projected mid-month", r.thisMonth.soFar < r.thisMonth.projected && r.thisMonth.soFar > 10);
  assert("an undated resource is counted from this month and noted", r.notes.some((n) => /no creation date/.test(n)));
  assert("unpriced resources are left out and noted", r.notes.some((n) => /no known price/.test(n)));
  assert("free resources are not cost drivers", !r.topDrivers.some((d) => d.id === "free"));
  assert("the honest label is always present", r.notes[0]!.startsWith("Estimated from what your account runs today. Resources you already deleted are not included."));
  assert("no invoices yet is stated in the summary", r.validation.summary.startsWith("No invoices added yet"));
  assert("finished months with usage are listed as missing an invoice", r.months.filter((m) => m.status === "invoice_missing").length === MAX_MONTHS);
}

// ---- Invoice integrity checks: one pass and one fail per rule ----
{
  const good = inv("INV-1", [["web", "2026-08", 36.04], ["api", "2026-08", 10]]);
  assert("a consistent invoice passes every check", validateInvoice(good).length === 0);
  const items = structuredClone(good);
  items.projects[0]!.items[0]!.net = 35.04;
  assert("line items not adding up to the project subtotal are named", validateInvoice(items).some((p) => p.includes("€35.04") && p.includes("€36.04") && p.includes("line items")));
  const within = structuredClone(good);
  within.projects[0]!.items[0]!.net = 36.049;
  assert("a rounding difference within one cent passes", validateInvoice(within).length === 0);
  const projects = structuredClone(good);
  projects.net = 50;
  assert("project nets not adding up to the invoice net are named", validateInvoice(projects).some((p) => p.includes("€46.04") && p.includes("€50.00")));
  const lineGross = structuredClone(good);
  lineGross.projects[1]!.gross = 12;
  assert("net plus tax not equal to gross on a line is named", validateInvoice(lineGross).some((p) => p.includes('"api"') && p.includes("gross is €12.00")));
  const totalGross = structuredClone(good);
  totalGross.gross += 1;
  assert("net plus tax not equal to the total gross is named", validateInvoice(totalGross).some((p) => p.includes("but the total is")));
  const rate = structuredClone(good);
  rate.projects[1]!.tax = 2.5;
  rate.projects[1]!.gross = 12.5;
  rate.tax = Math.round((rate.tax - 1.9 + 2.5) * 100) / 100;
  rate.gross = Math.round((rate.net + rate.tax) * 100) / 100;
  assert("a tax that is not the stated rate is named", validateInvoice(rate).some((p) => p.includes("not 19 %") && p.includes("€2.50")));
  const noRate = structuredClone(rate);
  noRate.taxRate = null;
  assert("without a stated rate the rate check is skipped", validateInvoice(noRate).length === 0);
  assert("an invoice with no project lines is refused", validateInvoice({ ...good, projects: [], net: 0, tax: 0, gross: 0 }).some((p) => p.includes("no project lines")));
}

// ---- Overlaps, and the 5 % rule ----
{
  const a = inv("A-1", [["web", "2026-07", 10]]);
  const b = inv("B-1", [["Web", "2026-07", 10]]);
  const c = inv("C-1", [["web", "2026-08", 10]]);
  assert("the same project and month on two invoices is flagged", findOverlaps([a, b]).length === 1 && findOverlaps([a, b])[0]!.includes("A-1 and B-1"));
  assert("different months do not overlap", findOverlaps([a, c]).length === 0);
  assert("within 5 % matches", classify(104, 100).status === "matches" && classify(95, 100).status === "matches");
  assert("more than 5 % above is invoice higher", classify(110, 100).status === "invoice_higher" && classify(110, 100).diffPct === 10);
  assert("more than 5 % below is invoice lower", classify(90, 100).status === "invoice_lower" && classify(90, 100).diff === -10);
  assert("billed with no estimate is invoice higher without a percentage", classify(5, 0).status === "invoice_higher" && classify(5, 0).diffPct === null);
}

// ---- Monthly reconciliation ----
{
  const g = graph([node("web", "web", 11.9, "2026-01-01T00:00:00Z")]);
  const invoices = [
    inv("M-08", [["web", "2026-08", 10]]),
    inv("M-07", [["web", "2026-07", 12]]),
    inv("M-06", [["web", "2026-06", 8]]),
    inv("M-GHOST", [["ghost", "2026-04", 3]]),
    inv("M-06B", [["web", "2026-06", 1]]),
  ];
  const broken = inv("M-BAD", [["web", "2026-03", 10]]);
  broken.net = 99;
  const r = spendReport(g, [...invoices, broken], NOW);
  const month = (k: string) => r.months.find((m) => m.month === k)!;
  assert("an invoice within 5 % matches", month("2026-08").status === "matches");
  assert("an invoice 20 % above is invoice higher with euro and percent", month("2026-07").status === "invoice_higher" && month("2026-07").diff === 2 && month("2026-07").diffPct === 20);
  assert("an invoice below is invoice lower", month("2026-06").status === "invoice_lower");
  assert("a month with usage and no invoice is invoice missing", month("2026-05").status === "invoice_missing" && month("2026-05").missingProjects[0] === "web");
  assert("an invoice for a project not on the map is marked", r.reconciliation.some((x) => x.project === "ghost" && x.status === "not_on_map"));
  assert("a failed invoice is left out of the totals", month("2026-03").billed === null && r.validation.valid === r.validation.invoices - 1);
  assert("the failed invoice's problem is listed", r.validation.problems.some((p) => p.includes("M-BAD")));
  assert("overlapping service months are flagged", r.validation.overlaps.some((o) => o.includes("M-06") && o.includes("M-06B")));
  assert("the summary counts invoices, failures and matching months", /^6 invoices, 1 did not add up and is left out\. 1 of 3 months match the estimate\./.test(r.validation.summary));
  assert("the summary names missing months", /months are missing an invoice/.test(r.validation.summary));
  assert("billed per project uses the invoices", r.byProject[0]!.billed === 31);
  const text = spendText(r);
  assert("the tool text includes the validation summary", text.includes(`Validation. ${r.validation.summary}`));
  assert("the tool text states estimates are net of VAT", text.includes("Estimates, net of VAT, EUR"));
  assert("the tool text lists the failed check", text.includes("Check failed.") && text.includes("Overlap."));
}

// ---- Sample data shows every state ----
{
  const g = sampleGraph();
  const invoices = sampleInvoices(g);
  const r = spendReport(g, invoices);
  const states = new Set(r.months.map((m) => m.status));
  assert("the sample has 12 invoices across 3 projects", invoices.length === 12 && new Set(invoices.flatMap((i) => i.projects.map((p) => p.name))).size === 3);
  assert("every sample invoice passes the checks", invoices.every((i) => validateInvoice(i).length === 0) && r.validation.valid === 12);
  assert("the sample shows matches, invoice higher, invoice lower and invoice missing", ["matches", "invoice_higher", "invoice_lower", "invoice_missing"].every((s) => states.has(s as never)));
  assert("the sample spreads creation dates over about 14 months", r.months.length >= 13);
}

// ---- Parsing invoice text (synthetic, shaped like a Hetzner invoice) ----
const de = (over: Partial<Record<"num" | "date" | "sum" | "item2" | "sub", string>> = {}) => [
  "Hetzner Online GmbH",
  over.num ?? "Rechnungsnummer: 900000000042",
  over.date ?? "Rechnungsdatum: 03.08.2026",
  "Gesamtübersicht",
  'Projekt "alpha"                 07/2026        1.234,56 €        234,57 €A1        1.469,13 €',
  'Projekt "beta"                  07/2026           10,00 €          1,90 €A1           11,90 €',
  over.sum ?? "Summe                               1.244,56 €        236,47 €        1.481,03 €",
  "A1",
  "19 %        1.244,56 €        236,47 €        1.481,03 €",
  "Pos   Produkt-anzahl Produkt   Einheit   Menge   Preis   Netto",
  'Projekt "alpha" (07/2026)',
  "1     1 CCX33 Cloud Server                Monate     1    1.200,0000 €    1.200,0000 €",
  over.item2 ?? "2     3 Primary IPv4                      Monate     3       11,5200 €       34,5600 €",
  over.sub ?? "Zwischensumme    1.234,56 €",
  'Projekt "beta" (07/2026)',
  "1     1 Volume 100 GB                     Monate     1       10,0000 €       10,0000 €",
  "Zwischensumme    10,00 €",
];
{
  const r = parseInvoiceText(de());
  assert("a German invoice parses", r.ok);
  if (r.ok) {
    const i = r.invoice;
    assert("number, date and totals are read", i.number === "900000000042" && i.date === "2026-08-03" && i.net === 1244.56 && i.gross === 1481.03);
    assert("thousands separators and decimal commas are read", i.projects[0]!.net === 1234.56 && i.projects[0]!.items[0]!.unitPrice === 1200);
    assert("each project gets its own line items", i.projects[0]!.items.length === 2 && i.projects[1]!.items.length === 1 && i.projects[0]!.period === "2026-07");
    assert("the stated tax rate is read", i.taxRate === 19);
    assert("no name, address or customer number is kept", !JSON.stringify(i).includes("Hetzner Online"));
  }
  const bad = (label: string, over: Parameters<typeof de>[0], want: RegExp) => {
    const x = parseInvoiceText(de(over));
    assert(label, !x.ok && want.test(x.error));
  };
  bad("a missing invoice number is refused", { num: "Kundennummer: K1" }, /invoice number/);
  bad("a missing invoice date is refused", { date: "Datum unbekannt" }, /invoice date/);
  bad("an impossible date is refused", { date: "Rechnungsdatum: 31.13.2026" }, /not a valid date/);
  bad("a missing total is refused", { sum: "Summe fehlt" }, /invoice total/);
  bad("line items that do not add up are refused with both numbers", { item2: "2     3 Primary IPv4    Monate     3       11,5200 €       24,5600 €", sub: "" }, /line items add up to €1,224\.56, but the subtotal is €1,234\.56/);
  bad("a detail subtotal that differs from the overview is refused", { sub: "Zwischensumme    1.230,00 €" }, /detail subtotal/);
  const noItems = de().filter((l) => !l.startsWith("1     1 Volume"));
  const ni = parseInvoiceText(noItems);
  assert("a project with no line items is refused", !ni.ok && /No line items/.test(ni.error));
  const noProjects = parseInvoiceText(["Rechnungsnummer: 900000000042", "Rechnungsdatum: 03.08.2026", "Summe 1,00 € 0,19 € 1,19 €"]);
  assert("an invoice without project lines is refused", !noProjects.ok && /project lines/.test(noProjects.error));
  assert("an empty text is refused", !parseInvoiceText("").ok);
  const en = parseInvoiceText([
    "Invoice number: 900000000043",
    "Invoice date: 2026-08-03",
    'Project "alpha"   07/2026   36.04 €   6.85 €   42.89 €',
    "Total   36.04 €   6.85 €   42.89 €",
    "19 %   36.04 €   6.85 €   42.89 €",
    'Project "alpha" (07/2026)',
    "1   1 CPX21 Cloud Server   Months   1   36.0400 €   36.0400 €",
    "Subtotal   36.04 €",
  ]);
  assert("the English wording with dot decimals parses", en.ok && en.invoice.net === 36.04 && en.invoice.projects[0]!.items.length === 1);
}

// ---- Rebuilding lines from positioned PDF text ----
{
  const it = (str: string, x: number, y: number, page = 1, width = str.length * 5): TextItem => ({ str, x, y, width, height: 10, page });
  const lines = linesFromItems([it("Summe", 50, 700), it("36,04 €", 300, 700.6), it("Rechnungsnummer:", 50, 720), it("12345", 135, 720), it("next page", 50, 720, 2)]);
  assert("items on one baseline form one line, top to bottom", lines[0] === "Rechnungsnummer: 12345" && lines[1]!.startsWith("Summe"));
  assert("a wide gap is kept as two spaces", lines[1] === "Summe  36,04 €");
  assert("pages never merge into one line", lines[2] === "next page" && lines.length === 3);
  assert("empty text runs are ignored", linesFromItems([it("", 1, 1)]).length === 0);
}

// ---- Store and strict server-side checks ----
const good = inv("STORE-1", [["web", "2026-08", 10]]);
{
  assert("a valid invoice passes the strict check", checkInvoice(good).number === "STORE-1");
  const throws = (label: string, v: unknown, status: number, want?: RegExp) => {
    try {
      checkInvoice(v);
      assert(label, false);
    } catch (err) {
      const e = err as { status?: number; message: string };
      assert(label, e.status === status && (!want || want.test(e.message)));
    }
  };
  throws("unknown fields are rejected", { ...good, customer: "Max" }, 400, /not accepted: customer/);
  throws("unknown fields inside a line are rejected", { ...good, projects: [{ ...good.projects[0], iban: "x" }] }, 400, /iban/);
  throws("negative amounts are rejected", { ...good, net: -1 }, 400, /zero or more/);
  throws("non-finite amounts are rejected", { ...good, tax: Number.NaN }, 400);
  throws("text amounts are rejected", { ...good, gross: "11.90" }, 400);
  throws("a bad invoice number is rejected", { ...good, number: "a/b" }, 400, /format/);
  throws("an overlong project name is rejected", { ...good, projects: [{ ...good.projects[0], name: "x".repeat(129) }] }, 400);
  throws("a control character in a name is rejected", { ...good, projects: [{ ...good.projects[0], name: "a\u0007b" }] }, 400);
  throws("an impossible month is rejected", { ...good, projects: [{ ...good.projects[0], period: "2026-13" }] }, 400, /valid month/);
  throws("another currency is rejected", { ...good, currency: "USD" }, 400, /euro/);
  throws("too many lines are rejected", { ...good, projects: Array.from({ length: 201 }, () => good.projects[0]) }, 413);
  throws("totals that do not add up are rejected server side", { ...good, net: 11 }, 422, /do not add up/);
  throws("a list is not an invoice", [good], 400);
}

const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "hz-spend-")) };
const dir = join(env.XDG_CONFIG_HOME!, "hetzner-mcp");
{
  await addInvoice(env, good);
  const f = join(dir, "invoices.json");
  assert("the invoice file is owner-only", (statSync(f).mode & 0o777) === 0o600);
  assert("stored invoices read back", readInvoices(env).length === 1);
  let dup = 0;
  await addInvoice(env, good).catch((e: { status: number }) => (dup = e.status));
  assert("the same invoice number is refused as a duplicate", dup === 409);
  await addInvoice(env, inv("STORE-2", [["web", "2026-07", 10]]), "Client A");
  assert("invoices are filtered by workspace", readInvoices(env, "Client A", "Personal").length === 1 && readInvoices(env, "Personal", "Personal").length === 1);
  assert("removing an invoice works once", (await removeInvoice(env, "STORE-2")) && !(await removeInvoice(env, "STORE-2")));
  writeFileSync(f, "{not json", { mode: 0o600 });
  assert("a corrupt file is ignored, not trusted", readInvoices(env).length === 0);
  await addInvoice(env, good);
  assert("a corrupt file is kept aside on the next save", readdirSync(dir).some((n) => n.startsWith("invoices.json.corrupt-")) && readInvoices(env).length === 1);
  if (process.platform !== "win32") {
    chmodSync(f, 0o666);
    assert("a file writable by others is ignored", readInvoices(env).length === 0);
    chmodSync(f, 0o600);
  }
}

// ---- Endpoints ----
type Res = { status: number; body: string };
const call = (port: number, key: string, method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
  new Promise<Res>((resolve, reject) => {
    const h: Record<string, string> = { Host: `127.0.0.1:${port}`, ...(key ? { "X-Hzmap": key } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers };
    const r = request({ host: "127.0.0.1", port, path, method, headers: h }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    r.on("error", reject);
    r.end(body);
  });
{
  const senv: NodeJS.ProcessEnv = { HETZNER_CLOUD_TOKEN: "t".repeat(64), XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "hz-spend-srv-")) };
  const h = await startMapServer(loadConfig(senv), { env: senv, port: 0, collect: async (ws) => ({ ...sampleGraph(), workspace: ws }) });
  const p = h.port;
  const send = (body: unknown, path = "/api/spend/invoices") => call(p, h.token, "POST", path, JSON.stringify(body));
  assert("GET /api/spend needs the access key", (await call(p, "", "GET", "/api/spend")).status === 403);
  const first = await call(p, h.token, "GET", "/api/spend");
  const rep = JSON.parse(first.body);
  assert("GET /api/spend returns the report", first.status === 200 && rep.thisMonth.projected > 0 && Array.isArray(rep.months));
  assert("an unknown workspace is refused", (await call(p, h.token, "GET", "/api/spend?workspace=nope")).status === 400);
  assert("adding an invoice needs the access key", (await call(p, "", "POST", "/api/spend/invoices", JSON.stringify({ invoice: good }))).status === 403);
  const added = await send({ invoice: good });
  assert("a valid invoice is added", added.status === 200 && JSON.parse(added.body).message.includes("STORE-1"));
  assert("a duplicate is refused", (await send({ invoice: good })).status === 409);
  assert("a bad shape is refused", (await send({ invoice: { ...good, extra: 1 } })).status === 400);
  assert("totals that do not add up are refused", (await send({ invoice: { ...good, gross: 1 } })).status === 422);
  assert("an unknown workspace on import is refused", (await send({ invoice: good, workspace: "nope" })).status === 400);
  assert("a body over 1 MB is refused", (await send({ invoice: good, pad: "x".repeat(1_100_000) })).status === 413);
  assert("a non-JSON body is refused", (await call(p, h.token, "POST", "/api/spend/invoices", "x", { "Content-Type": "text/plain" })).status === 415);
  const after = JSON.parse((await call(p, h.token, "GET", "/api/spend")).body);
  assert("the added invoice shows in the report", after.invoices.some((i: { number: string }) => i.number === "STORE-1") && after.validation.invoices === 1);
  assert("removing an invoice works", (await send({ number: "STORE-1" }, "/api/spend/invoices/remove")).status === 200);
  assert("removing it again is not found", (await send({ number: "STORE-1" }, "/api/spend/invoices/remove")).status === 404);
  const stored = join(senv.XDG_CONFIG_HOME!, "hetzner-mcp", "invoices.json");
  assert("only totals and line items are written", existsSync(stored) && !readFileSync(stored, "utf8").includes("customer"));
  await h.close();

  const d = await startMapServer(loadConfig({}), { demo: true, port: 0 });
  const demoRep = JSON.parse((await call(d.port, d.token, "GET", "/api/spend")).body);
  assert("the sample map shows 12 sample invoices", demoRep.invoices.length === 12);
  const refused = await call(d.port, d.token, "POST", "/api/spend/invoices", JSON.stringify({ invoice: good }));
  assert("the sample map refuses imports with a clear message", refused.status === 403 && /sample data/.test(JSON.parse(refused.body).error));
  await d.close();
}

process.stdout.write(`\n${passed}/${total} spend checks passed\n`);
if (passed !== total) process.exitCode = 1;
