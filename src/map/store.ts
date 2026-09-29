/**
 * Projects connected from the map. Saved only on this computer, owner-only (0600 file, 0700 dir).
 * Tokens are read back only by this process and never sent to the browser.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { isAbsolute, join } from "node:path";

export interface StoredProject {
  name: string;
  account: string;
  token: string;
  addedAt: string;
  /** Optional group of accounts. Missing means the default workspace. */
  workspace?: string;
}

export function storeDir(env: NodeJS.ProcessEnv = process.env): string {
  // A relative XDG_CONFIG_HOME would put the tokens in whatever directory we run from.
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  return join(base, "hetzner-mcp");
}

const file = (env: NodeJS.ProcessEnv) => join(storeDir(env), "projects.json");
const posix = process.platform !== "win32";
const myUid = (): number | undefined => (posix && typeof process.getuid === "function" ? process.getuid() : undefined);

/** Creates the store directory owner-only, tightens a loose one we own, refuses one we do not. */
function ensureDir(env: NodeJS.ProcessEnv): string {
  const dir = storeDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const uid = myUid();
  if (uid === undefined) return dir;
  const st = statSync(dir);
  if (st.uid !== uid) throw new Error(`${dir} belongs to another user. Refusing to store tokens there.`);
  if (st.mode & 0o077) chmodSync(dir, 0o700);
  return dir;
}

type Inspected = { state: "missing" | "ok" | "corrupt" | "untrusted"; projects: StoredProject[]; caveat?: string };

function inspect(env: NodeJS.ProcessEnv): Inspected {
  const target = file(env);
  let raw: string;
  let notice: string | undefined;
  try {
    const uid = myUid();
    const st = statSync(target);
    if (uid !== undefined && (st.uid !== uid || st.mode & 0o022)) {
      return { state: "untrusted", projects: [], caveat: `${target} is not owned by you or is writable by others, so it was ignored.` };
    }
    // Readable by others but ours: it holds tokens, so make it owner-only before using it.
    if (uid !== undefined && st.mode & 0o077) {
      chmodSync(target, 0o600);
      notice = `${target} was readable by other users. It is now owner-only (0600).`;
    }
    raw = readFileSync(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing", projects: [] };
    return { state: "corrupt", projects: [], caveat: `${target} could not be read, so it was ignored.` };
  }
  try {
    const parsed = JSON.parse(raw) as { projects?: unknown };
    if (!Array.isArray(parsed.projects)) throw new Error("no projects array");
    const projects = parsed.projects.filter(
      (p): p is StoredProject =>
        !!p && typeof p.name === "string" && typeof p.account === "string" && typeof p.token === "string" && p.token.length > 0 && (p.workspace === undefined || typeof p.workspace === "string"),
    );
    return notice ? { state: "ok", projects, caveat: notice } : { state: "ok", projects };
  } catch {
    return { state: "corrupt", projects: [], caveat: [notice, `${target} is not valid JSON, so it was ignored. It is kept aside on the next save.`].filter(Boolean).join(" ") };
  }
}

const warned = new Set<string>();

export function readStored(env: NodeJS.ProcessEnv = process.env): StoredProject[] {
  const r = inspect(env);
  if (r.caveat && !warned.has(r.caveat)) {
    warned.add(r.caveat);
    process.stderr.write(`hetzner-mcp: ${r.caveat}\n`);
  }
  return r.projects;
}

function write(env: NodeJS.ProcessEnv, projects: StoredProject[]): void {
  ensureDir(env);
  const target = file(env);
  // Never overwrite a file we could not trust or parse: move it aside so no token is lost.
  const now = inspect(env);
  if (now.state === "corrupt" || now.state === "untrusted") renameSync(target, `${target}.${now.state}-${Date.now()}`);
  const tmp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify({ projects }, null, 2), { mode: 0o600, flag: "wx" });
  renameSync(tmp, target);
  chmodSync(target, 0o600);
}

// Read, change, write under a lock directory, so two imports at once cannot drop each other's
// projects. A lock is taken over only when its owner is gone: a dead process on this computer,
// or a lock from another computer that is older than 30 s. A live owner here is always waited for.
function lockPath(env: NodeJS.ProcessEnv): string {
  return join(ensureDir(env), ".lock");
}

const OWNER = "owner.json";
const thisHost = hostname();
const STALE_MS = 30_000;

type Owner = { pid?: unknown; hostname?: unknown; id?: unknown };

function readOwner(lock: string): Owner | undefined {
  try {
    return JSON.parse(readFileSync(join(lock, OWNER), "utf8")) as Owner;
  } catch {
    return undefined;
  }
}

function ownerGone(lock: string, seenOwnerless: Map<string, number>): boolean {
  const owner = readOwner(lock);
  if (!owner) {
    // No owner yet: allow one second for it to appear, measured by us, not by the lock's mtime.
    const first = seenOwnerless.get(lock) ?? Date.now();
    seenOwnerless.set(lock, first);
    return Date.now() - first > 1000;
  }
  // Another computer's process cannot be checked, so only age counts there.
  if (owner.hostname !== thisHost || typeof owner.pid !== "number") return Date.now() - statSync(lock).mtimeMs > STALE_MS;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Returns this holder's random id when the lock was taken, undefined when it is busy. */
function tryLock(lock: string, seenOwnerless: Map<string, number>): string | undefined {
  const id = randomBytes(16).toString("hex");
  try {
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(join(lock, OWNER), JSON.stringify({ pid: process.pid, hostname: thisHost, id, created: new Date().toISOString() }), { mode: 0o600, flag: "wx" });
    return id;
  } catch {
    try {
      if (ownerGone(lock, seenOwnerless)) {
        rmSync(lock, { recursive: true, force: true });
        seenOwnerless.delete(lock);
      }
    } catch {
      // The lock vanished between the two calls; retry.
    }
    return undefined;
  }
}

/** Removes the lock only while it is still ours, so a later holder's lock is never deleted. */
export function releaseLock(lock: string, id: string): void {
  if (readOwner(lock)?.id === id) rmSync(lock, { recursive: true, force: true });
}

const busy = () => new Error("The project store is busy. Try again in a moment.");

// The CLI has nothing else to run, so it may block while it waits.
function locked<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const lock = lockPath(env);
  const until = Date.now() + 5000;
  const seen = new Map<string, number>();
  let id: string | undefined;
  while (!(id = tryLock(lock, seen))) {
    if (Date.now() > until) throw busy();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  try {
    return fn();
  } finally {
    releaseLock(lock, id);
  }
}

// The map server must keep answering requests while another process holds the lock.
async function lockedAsync<T>(env: NodeJS.ProcessEnv, fn: () => T): Promise<T> {
  const lock = lockPath(env);
  const until = Date.now() + 5000;
  const seen = new Map<string, number>();
  let id: string | undefined;
  while (!(id = tryLock(lock, seen))) {
    if (Date.now() > until) throw busy();
    await new Promise((r) => setTimeout(r, 25)); // polling a lock, one wait per attempt
  }
  try {
    return fn();
  } finally {
    releaseLock(lock, id);
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
