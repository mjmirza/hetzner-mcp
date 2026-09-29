/**
 * `hetzner-mcp projects import|list|remove`. Bulk-manages saved project tokens for many accounts.
 * Tokens are written only through store.ts (0600, atomic) and never printed, only their last 4 chars.
 */
import { readFileSync, statSync } from "node:fs";
import { loadConfig, type HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";
import { ACCOUNT, PROJECT_NAME, TOKEN } from "./actions.js";
import { settleWithLimit } from "./limit.js";
import { discoverProjects } from "./projects.js";
import { readStored, removeStored, saveManyStored } from "./store.js";

const MAX_FILE = 5 * 1024 * 1024;
const WORKSPACE = ACCOUNT;

export interface ImportRow {
  row: number;
  workspace: string;
  account: string;
  project: string;
  token: string;
}

// A short value would be printed almost whole, so it is hidden completely.
export const maskToken = (t: string): string => (t.length < 16 ? "****" : `****${t.slice(-4)}`);

/** Minimal RFC 4180 reader. Quoted fields may hold commas, quotes ("") and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        const next = text[i + 1];
        if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") throw new Error(`Row ${rows.length + 1}: text after a closing quote.`);
      } else field += c;
    } else if (c === '"') {
      if (field !== "") throw new Error(`Row ${rows.length + 1}: a quote in the middle of a field.`);
      quoted = true;
    }
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Reads CSV (workspace,account,project,token) or a JSON array. Bad rows come back with numbers. */
export function parseImport(text: string, filename = ""): { rows: ImportRow[]; invalid: Array<{ row: number; reason: string }> } {
  const body = text.replace(/^﻿/, "");
  const invalid: Array<{ row: number; reason: string }> = [];
  const rows: ImportRow[] = [];
  let raw: Array<{ row: number; fields: unknown[] }> = [];
  const isJson = filename.toLowerCase().endsWith(".json") || /^\s*[[{]/.test(body);
  if (isJson) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return { rows, invalid: [{ row: 0, reason: "File is not valid JSON." }] };
    }
    if (!Array.isArray(data)) return { rows, invalid: [{ row: 0, reason: "JSON must be an array of { workspace, account, project, token }." }] };
    raw = data.map((o, i) => {
      const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
      return { row: i + 1, fields: [r.workspace, r.account, r.project ?? r.name, r.token] };
    });
  } else {
    let parsed: string[][];
    try {
      parsed = parseCsv(body);
    } catch (err) {
      return { rows, invalid: [{ row: 0, reason: err instanceof Error ? err.message : String(err) }] };
    }
    parsed.forEach((fields, i) => {
      const line = fields.join(",").trim();
      if (!line || line.startsWith("#")) return;
      const head = fields.map((f) => f.trim().toLowerCase());
      if (i === 0 && head[0] === "workspace" && head[3] === "token") return;
      raw.push({ row: i + 1, fields });
    });
  }
  for (const { row, fields } of raw) {
    if (fields.length !== 4) {
      invalid.push({ row, reason: `Expected 4 fields (workspace,account,project,token), got ${fields.length}.` });
      continue;
    }
    const [workspace, account, project, token] = fields.map((f) => (typeof f === "string" ? f.trim() : ""));
    const bad = [
      !WORKSPACE.test(workspace!) && "workspace",
      !ACCOUNT.test(account!) && "account",
      !PROJECT_NAME.test(project!) && "project",
      !TOKEN.test(token!) && "token",
    ].filter(Boolean);
    if (bad.length) invalid.push({ row, reason: `Invalid ${bad.join(", ")}.` });
    else rows.push({ row, workspace: workspace!, account: account!, project: project!, token: token! });
  }
  return { rows, invalid };
}

export interface ImportReport {
  added: ImportRow[];
  duplicates: Array<{ row: number; reason: string }>;
  invalid: Array<{ row: number; reason: string }>;
  failed: Array<{ row: number; reason: string }>;
}

type Verifier = (base: HetznerConfig, token: string) => Promise<void>;

const liveVerify: Verifier = async (base, token) => {
  await hetznerRequest({ ...base, cloudToken: token, readOnly: true }, { surface: "cloud", path: "/servers", query: { per_page: 1 } });
};

/** Validates, dedupes, optionally verifies, then saves every good row in one atomic write. */
export async function importProjects(env: NodeJS.ProcessEnv, text: string, filename: string, opts: { verify?: boolean; verifier?: Verifier } = {}): Promise<ImportReport> {
  const base = loadConfig(env);
  const { rows, invalid } = parseImport(text, filename);
  const existing = discoverProjects(base, env, readStored(env));
  const tokens = new Set(existing.map((p) => p.cfg.cloudToken));
  const where = new Map(existing.map((p) => [`${p.account}\u0000${p.name}`, p.workspace]));
  const duplicates: ImportReport["duplicates"] = [];
  const fresh: ImportRow[] = [];
  for (const r of rows) {
    const key = `${r.account}\u0000${r.project}`;
    if (tokens.has(r.token)) duplicates.push({ row: r.row, reason: "This token is already connected." });
    else if (where.has(key)) {
      const ws = where.get(key);
      duplicates.push({ row: r.row, reason: ws === r.workspace ? "This project is already connected." : `Account and project already exist in workspace "${ws}". Account labels must be unique.` });
    } else {
      tokens.add(r.token);
      where.set(key, r.workspace);
      fresh.push(r);
    }
  }
  const failed: ImportReport["failed"] = [];
  let added = fresh;
  if (opts.verify && fresh.length) {
    const verify = opts.verifier ?? liveVerify;
    const checks = await settleWithLimit(fresh, 4, (r) => verify(base, r.token));
    added = [];
    checks.forEach((c, i) => {
      const r = fresh[i]!;
      if (c.status === "fulfilled") added.push(r);
      else {
        const status = (c.reason as { status?: number })?.status;
        failed.push({ row: r.row, reason: status === 401 || status === 403 ? "Hetzner rejected this token." : "Could not reach Hetzner to check this token." });
      }
    });
  }
  saveManyStored(
    env,
    added.map((r) => ({ name: r.project, account: r.account, workspace: r.workspace, token: r.token })),
  );
  return { added, duplicates, invalid, failed };
}

const USAGE = [
  "",
  "  hetzner-mcp projects import <file.csv|file.json> [--verify]",
  "      CSV columns: workspace,account,project,token. JSON: an array of those objects.",
  "      --verify checks each token with one read call before saving it.",
  "  hetzner-mcp projects list [--json]",
  "  hetzner-mcp projects remove <workspace>/<account>/<project>",
  "",
].join("\n");

export async function runProjects(argv: string[], env: NodeJS.ProcessEnv = process.env, out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "import") {
    const file = rest.find((a) => !a.startsWith("--"));
    if (!file) {
      out(`Missing file.${USAGE}\n`);
      return 2;
    }
    let text: string;
    try {
      if (statSync(file).size > MAX_FILE) {
        out(`File is larger than 5 MB.\n`);
        return 2;
      }
      text = readFileSync(file, "utf8");
    } catch (err) {
      out(`Could not read ${file}. ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    const rep = await importProjects(env, text, file, { verify: rest.includes("--verify") });
    out(`Added ${rep.added.length}, duplicates ${rep.duplicates.length}, invalid ${rep.invalid.length}${rest.includes("--verify") ? `, failed check ${rep.failed.length}` : " (not verified, pass --verify to check tokens)"}.\n`);
    for (const r of rep.added) out(`  added     row ${r.row}  ${r.workspace}/${r.account}/${r.project}  ${maskToken(r.token)}\n`);
    for (const d of [...rep.duplicates.map((x) => ["duplicate", x] as const), ...rep.invalid.map((x) => ["invalid", x] as const), ...rep.failed.map((x) => ["failed", x] as const)])
      out(`  ${d[0].padEnd(9)} row ${d[1].row}  ${d[1].reason}\n`);
    return rep.invalid.length || rep.failed.length ? 1 : 0;
  }
  if (sub === "list") {
    const all = discoverProjects(loadConfig(env), env, readStored(env))
      .map((p) => ({ workspace: p.workspace, account: p.account, project: p.name, source: p.source, token: maskToken(p.cfg.cloudToken ?? "") }))
      .sort((a, b) => a.workspace.localeCompare(b.workspace) || a.account.localeCompare(b.account) || a.project.localeCompare(b.project));
    if (rest.includes("--json")) {
      out(JSON.stringify(all, null, 2) + "\n");
      return 0;
    }
    if (!all.length) {
      out("No projects. Add one with: hetzner-mcp projects import <file>\n");
      return 0;
    }
    for (const p of all) out(`${p.workspace}/${p.account}/${p.project}  ${p.token}  ${p.source}\n`);
    out(`\n${all.length} project(s) in ${new Set(all.map((p) => p.workspace)).size} workspace(s).\n`);
    return 0;
  }
  if (sub === "remove") {
    const parts = (rest[0] ?? "").split("/").map((s) => s.trim());
    if (parts.length !== 3 || !parts.every(Boolean)) {
      out(`Give the project as <workspace>/<account>/<project>.${USAGE}\n`);
      return 2;
    }
    const [workspace, account, project] = parts as [string, string, string];
    const ref = discoverProjects(loadConfig(env), env, readStored(env)).find((p) => p.workspace === workspace && p.account === account && p.name === project);
    if (!ref) {
      out(`No project ${workspace}/${account}/${project}. See: hetzner-mcp projects list\n`);
      return 1;
    }
    if (ref.source !== "local") {
      out("This project comes from your environment settings. Remove it there.\n");
      return 1;
    }
    removeStored(env, account, project);
    out(`Removed ${workspace}/${account}/${project}. Nothing at Hetzner changed.\n`);
    return 0;
  }
  out(`${sub ? `Unknown projects command "${sub}".` : "Missing projects command."}${USAGE}\n`);
  return sub ? 2 : 0;
}
