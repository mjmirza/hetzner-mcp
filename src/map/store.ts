/**
 * Projects connected from the map. Saved only on this computer, owner-only (0600 file, 0700 dir).
 * Tokens are read back only by this process and never sent to the browser.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredProject {
  name: string;
  account: string;
  token: string;
  addedAt: string;
  /** Optional group of accounts. Missing means the default workspace. */
  workspace?: string;
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
      (p): p is StoredProject =>
        !!p && typeof p.name === "string" && typeof p.account === "string" && typeof p.token === "string" && p.token.length > 0 && (p.workspace === undefined || typeof p.workspace === "string"),
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

// Read, change, write under a lock directory, so two imports at once cannot drop each other's
// projects. A lock older than 30 s is from a crashed run and is taken over.
function lockPath(env: NodeJS.ProcessEnv): string {
  const dir = storeDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, ".lock");
}

function tryLock(lock: string): boolean {
  try {
    mkdirSync(lock);
    return true;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { recursive: true, force: true });
    } catch {
      // The lock vanished between the two calls; retry.
    }
    return false;
  }
}

const busy = () => new Error("The project store is busy. Try again in a moment.");

// The CLI has nothing else to run, so it may block while it waits.
function locked<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const lock = lockPath(env);
  const until = Date.now() + 5000;
  while (!tryLock(lock)) {
    if (Date.now() > until) throw busy();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// The map server must keep answering requests while another process holds the lock.
async function lockedAsync<T>(env: NodeJS.ProcessEnv, fn: () => T): Promise<T> {
  const lock = lockPath(env);
  const until = Date.now() + 5000;
  while (!tryLock(lock)) {
    if (Date.now() > until) throw busy();
    await new Promise((r) => setTimeout(r, 25)); // BESTPRACTICE_OK: polling a lock, one wait per attempt
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const upsert = (env: NodeJS.ProcessEnv, p: Omit<StoredProject, "addedAt">) => (): void => {
  const rest = readStored(env).filter((x) => !(x.name === p.name && x.account === p.account));
  write(env, [...rest, { ...p, addedAt: new Date().toISOString() }]);
};

/** Adds or replaces (same account and name) a project. */
export function saveStored(env: NodeJS.ProcessEnv, p: Omit<StoredProject, "addedAt">): void {
  locked(env, upsert(env, p));
}

/** saveStored without blocking the event loop, for the map server. */
export function saveStoredAsync(env: NodeJS.ProcessEnv, p: Omit<StoredProject, "addedAt">): Promise<void> {
  return lockedAsync(env, upsert(env, p));
}

/** Adds many projects in one atomic write. Same account and name replaces the old entry. */
export function saveManyStored(env: NodeJS.ProcessEnv, items: Array<Omit<StoredProject, "addedAt">>): void {
  if (items.length === 0) return;
  const key = (x: { account: string; name: string }) => `${x.account}\u0000${x.name}`;
  const incoming = new Set(items.map(key));
  const at = new Date().toISOString();
  locked(env, () => write(env, [...readStored(env).filter((x) => !incoming.has(key(x))), ...items.map((p) => ({ ...p, addedAt: at }))]));
}

const drop = (env: NodeJS.ProcessEnv, account: string, name: string) => (): boolean => {
  const all = readStored(env);
  const rest = all.filter((x) => !(x.name === name && x.account === account));
  if (rest.length === all.length) return false;
  write(env, rest);
  return true;
};

export function removeStored(env: NodeJS.ProcessEnv, account: string, name: string): boolean {
  return locked(env, drop(env, account, name));
}

/** removeStored without blocking the event loop, for the map server. */
export function removeStoredAsync(env: NodeJS.ProcessEnv, account: string, name: string): Promise<boolean> {
  return lockedAsync(env, drop(env, account, name));
}
