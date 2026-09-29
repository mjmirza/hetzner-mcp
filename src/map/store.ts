/**
 * Projects connected from the map. Saved only on this computer, owner-only (0600 file, 0700 dir).
 * Tokens are read back only by this process and never sent to the browser.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredProject {
  name: string;
  account: string;
  token: string;
  addedAt: string;
}

export function storeDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "hetzner-mcp");
}

const file = (env: NodeJS.ProcessEnv) => join(storeDir(env), "projects.json");

export function readStored(env: NodeJS.ProcessEnv = process.env): StoredProject[] {
  try {
    const raw = JSON.parse(readFileSync(file(env), "utf8")) as { projects?: unknown };
    if (!Array.isArray(raw.projects)) return [];
    return raw.projects.filter(
      (p): p is StoredProject => !!p && typeof p.name === "string" && typeof p.account === "string" && typeof p.token === "string" && p.token.length > 0,
    );
  } catch {
    return [];
  }
}

function write(env: NodeJS.ProcessEnv, projects: StoredProject[]): void {
  const dir = storeDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = file(env);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ projects }, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
  chmodSync(target, 0o600);
}

/** Adds or replaces (same account and name) a project. */
export function saveStored(env: NodeJS.ProcessEnv, p: Omit<StoredProject, "addedAt">): void {
  const rest = readStored(env).filter((x) => !(x.name === p.name && x.account === p.account));
  write(env, [...rest, { ...p, addedAt: new Date().toISOString() }]);
}

export function removeStored(env: NodeJS.ProcessEnv, account: string, name: string): boolean {
  const all = readStored(env);
  const rest = all.filter((x) => !(x.name === name && x.account === account));
  if (rest.length === all.length) return false;
  write(env, rest);
  return true;
}
