// Invoices added on the Spend tab. Saved only on this computer, next to the project store, owner-only
// (0600 file, 0700 dir). Holds totals and line items only, never names, addresses or account numbers.
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, lockedAsync, storeDir } from "./store.js";
import { validateInvoice, type InvoiceItem, type InvoiceProject, type SpendInvoice, type StoredInvoice } from "./spend.js";

const MAX_INVOICES = 1000;
const MAX_PROJECTS = 200;
const MAX_ITEMS = 2000;
const MAX_AMOUNT = 1e8;

/** A rejected import. status is the HTTP status the map answers with. */
export class InvoiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const bad = (msg: string) => new InvoiceError(400, msg);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;

function obj(v: unknown, what: string, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad(`${what} must be an object.`);
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  if (extra.length) throw bad(`${what} has fields that are not accepted: ${extra.slice(0, 3).join(", ")}.`);
  return v as Record<string, unknown>;
}
function str(v: unknown, what: string, max: number, re?: RegExp): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || CONTROL.test(v)) throw bad(`${what} must be text of at most ${max} characters.`);
  if (re && !re.test(v)) throw bad(`${what} has an unexpected format.`);
  return v;
}
function amount(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_AMOUNT) throw bad(`${what} must be a number of zero or more.`);
  return v;
}
function list(v: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw bad(`${what} must be a list.`);
  if (v.length > max) throw new InvoiceError(413, `${what} has more than ${max} entries.`);
  return v;
}
const validDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d ?? 1));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && (d === undefined || t.getUTCDate() === d) && y! >= 2000 && y! <= 2100;
};

/** Strict check of an invoice sent by the browser. Never trusts the client: shape first, then the sums. */
export function checkInvoice(input: unknown): SpendInvoice {
  const v = obj(input, "The invoice", ["number", "date", "currency", "net", "tax", "gross", "taxRate", "projects"]);
  const date = str(v.date, "The invoice date", 10, /^\d{4}-\d{2}-\d{2}$/);
  if (!validDate(date)) throw bad("The invoice date is not a valid date.");
  if (v.currency !== "EUR") throw bad("Only invoices in euro are supported.");
  const taxRate = v.taxRate === null ? null : amount(v.taxRate, "The tax rate");
  if (taxRate !== null && taxRate > 100) throw bad("The tax rate must be between 0 and 100.");
  const projects = list(v.projects, "The project lines", MAX_PROJECTS).map((raw, i): InvoiceProject => {
    const p = obj(raw, `Project line ${i + 1}`, ["name", "period", "net", "tax", "gross", "items"]);
    const period = str(p.period, `The service period of line ${i + 1}`, 7, /^\d{4}-\d{2}$/);
    if (!validDate(period)) throw bad(`The service period of line ${i + 1} is not a valid month.`);
    const items = list(p.items, `The line items of line ${i + 1}`, MAX_ITEMS).map((rawItem, j): InvoiceItem => {
      const it = obj(rawItem, `Item ${j + 1} of line ${i + 1}`, ["pos", "product", "unit", "quantity", "unitPrice", "net"]);
      const pos = amount(it.pos, `The position of item ${j + 1}`);
      if (!Number.isInteger(pos)) throw bad(`The position of item ${j + 1} must be a whole number.`);
      return { pos, product: str(it.product, `The product of item ${j + 1}`, 200), unit: str(it.unit, `The unit of item ${j + 1}`, 32), quantity: amount(it.quantity, `The quantity of item ${j + 1}`), unitPrice: amount(it.unitPrice, `The price of item ${j + 1}`), net: amount(it.net, `The amount of item ${j + 1}`) };
    });
    return { name: str(p.name, `The project name of line ${i + 1}`, 128), period, net: amount(p.net, `The net of line ${i + 1}`), tax: amount(p.tax, `The tax of line ${i + 1}`), gross: amount(p.gross, `The gross of line ${i + 1}`), items };
  });
  if (projects.reduce((s, p) => s + p.items.length, 0) > MAX_ITEMS) throw new InvoiceError(413, `The invoice has more than ${MAX_ITEMS} line items.`);
  const inv: SpendInvoice = {
    number: str(v.number, "The invoice number", 40, /^[A-Za-z0-9-]{3,40}$/),
    date,
    currency: "EUR",
    net: amount(v.net, "The net total"),
    tax: amount(v.tax, "The tax total"),
    gross: amount(v.gross, "The gross total"),
    taxRate,
    projects,
  };
  const problems = validateInvoice(inv);
  if (problems.length) throw new InvoiceError(422, `The totals on this invoice do not add up, so it was not added. ${problems[0]}`);
  return inv;
}

const file = (env: NodeJS.ProcessEnv) => join(storeDir(env), "invoices.json");
const posix = process.platform !== "win32";
const myUid = (): number | undefined => (posix && typeof process.getuid === "function" ? process.getuid() : undefined);

type Inspected = { state: "missing" | "ok" | "corrupt" | "untrusted"; invoices: StoredInvoice[] };

function inspect(env: NodeJS.ProcessEnv): Inspected {
  const target = file(env);
  let raw: string;
  try {
    const uid = myUid();
    const st = statSync(target);
    if (uid !== undefined && (st.uid !== uid || st.mode & 0o022)) return { state: "untrusted", invoices: [] };
    if (uid !== undefined && st.mode & 0o077) chmodSync(target, 0o600);
    raw = readFileSync(target, "utf8");
  } catch (err) {
    return { state: (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "corrupt", invoices: [] };
  }
  try {
    const parsed = JSON.parse(raw) as { invoices?: unknown };
    if (!Array.isArray(parsed.invoices)) throw new Error("no invoices array");
    const invoices: StoredInvoice[] = [];
    // An entry edited by hand into a wrong shape is skipped, the others still load.
    for (const e of parsed.invoices.slice(0, MAX_INVOICES)) {
      try {
        const { addedAt, workspace, ...rest } = (e ?? {}) as Record<string, unknown>;
        const inv = checkInvoice(rest);
        invoices.push({ ...inv, addedAt: typeof addedAt === "string" ? addedAt.slice(0, 40) : "", ...(typeof workspace === "string" && workspace.length <= 200 ? { workspace } : {}) });
      } catch {
        // skipped
      }
    }
    return { state: "ok", invoices };
  } catch {
    return { state: "corrupt", invoices: [] };
  }
}

const warned = new Set<string>();

/** Invoices of one workspace. Undefined workspace on an entry means the default workspace. */
export function readInvoices(env: NodeJS.ProcessEnv, workspace?: string, defaultWorkspace?: string): StoredInvoice[] {
  const r = inspect(env);
  if ((r.state === "corrupt" || r.state === "untrusted") && !warned.has(r.state)) {
    warned.add(r.state);
    process.stderr.write(`hetzner-mcp: ${file(env)} ${r.state === "untrusted" ? "is not owned by you or is writable by others" : "could not be read"}, so it was ignored.\n`);
  }
  if (workspace === undefined) return r.invoices;
  return r.invoices.filter((i) => (i.workspace ?? defaultWorkspace) === workspace);
}

function write(env: NodeJS.ProcessEnv, invoices: StoredInvoice[]): void {
  ensureDir(env);
  const target = file(env);
  const now = inspect(env);
  // Never overwrite a file we could not trust or parse: move it aside so nothing is lost.
  if (now.state === "corrupt" || now.state === "untrusted") renameSync(target, `${target}.${now.state}-${Date.now()}`);
  const tmp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify({ invoices }, null, 2), { mode: 0o600, flag: "wx" });
  renameSync(tmp, target);
  chmodSync(target, 0o600);
}

/** Adds one checked invoice. An invoice number already stored is refused, so nothing counts twice. */
export function addInvoice(env: NodeJS.ProcessEnv, input: unknown, workspace?: string): Promise<SpendInvoice> {
  const inv = checkInvoice(input);
  return lockedAsync(env, () => {
    const all = inspect(env).invoices;
    if (all.some((x) => x.number === inv.number)) throw new InvoiceError(409, `Invoice ${inv.number} was already added.`);
    if (all.length >= MAX_INVOICES) throw new InvoiceError(413, `At most ${MAX_INVOICES} invoices can be stored. Remove old ones first.`);
    write(env, [...all, { ...inv, addedAt: new Date().toISOString(), ...(workspace ? { workspace } : {}) }]);
    return inv;
  });
}

export function removeInvoice(env: NodeJS.ProcessEnv, number: unknown): Promise<boolean> {
  const n = str(number, "The invoice number", 40, /^[A-Za-z0-9-]{3,40}$/);
  return lockedAsync(env, () => {
    const all = inspect(env).invoices;
    const rest = all.filter((x) => x.number !== n);
    if (rest.length === all.length) return false;
    write(env, rest);
    return true;
  });
}
