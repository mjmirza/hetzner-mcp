/** The cheap live-status poll: only servers and load balancers, per project, read-only GETs. */
import type { HetznerConfig } from "../config.js";
import { listAll, listInfo, PROJECT_CONCURRENCY, truncatedNote } from "./collect.js";
import { discoverProjects, type ProjectRef } from "./projects.js";
import { settleWithLimit } from "./limit.js";
import { readStored } from "./store.js";
import { sampleGraph } from "./sample.js";
import { targetHealth, type LiveEntry, type StatusSnapshot } from "./status.js";
import { onInvalidate } from "./graph-cache.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Lister = (cfg: HetznerConfig, path: "/servers" | "/load_balancers", key: "servers" | "load_balancers") => Promise<Json[]>;

/** A project needing more pages is polled less often: once per this many ms per page, up to the cap. */
export const POLL_MS_PER_PAGE = 60_000;
const MAX_POLL_GAP_MS = 15 * 60_000;
type Remembered = { at: number; pages: number; entries: Record<string, LiveEntry>; incomplete: boolean };
const remembered = new Map<string, Remembered>();

export async function collectStatuses(
  base: HetznerConfig,
  env: NodeJS.ProcessEnv = process.env,
  opts: { workspace?: string; list?: Lister; projects?: ProjectRef[]; now?: number } = {},
): Promise<StatusSnapshot> {
  const list: Lister = opts.list ?? ((cfg, path, key) => listAll(cfg, "cloud", path, key));
  const all = opts.projects ?? discoverProjects(base, env, readStored(env));
  const projects = all.filter((p) => opts.workspace === undefined || p.workspace === opts.workspace);
  const now = opts.now ?? Date.now();
  const entries: Record<string, LiveEntry> = {};
  const failedProjects: string[] = [];
  const deferred: string[] = [];
  const incomplete: string[] = [];
  const idOf = (p: ProjectRef) => `p:${p.account}/${p.name}`;
  // Big projects cost several requests per poll, so they keep their last values between polls.
  const due = projects.filter((p) => {
    const r = remembered.get(`${idOf(p)}\u0000${p.cfg.cloudToken ?? ""}`);
    if (!r || r.pages <= 1 || now - r.at >= Math.min(MAX_POLL_GAP_MS, r.pages * POLL_MS_PER_PAGE)) return true;
    Object.assign(entries, r.entries);
    deferred.push(idOf(p));
    if (r.incomplete) incomplete.push(idOf(p));
    return false;
  });
  const results = await settleWithLimit(due, PROJECT_CONCURRENCY, (p) => Promise.all([list(p.cfg, "/servers", "servers"), list(p.cfg, "/load_balancers", "load_balancers")]));
  results.forEach((r, i) => {
    const p = due[i]!;
    const P = idOf(p);
    if (r.status === "rejected") return void failedProjects.push(P);
    const [servers, lbs] = r.value;
    const mine: Record<string, LiveEntry> = {};
    for (const s of servers) mine[`${P}/srv:${s.id}`] = { status: typeof s.status === "string" ? s.status : undefined };
    for (const lb of lbs) mine[`${P}/lb:${lb.id}`] = { health: targetHealth(lb.targets) };
    Object.assign(entries, mine);
    const cut = !!(listInfo(servers)?.truncated || listInfo(lbs)?.truncated);
    if (cut) incomplete.push(P);
    const pages = (listInfo(servers)?.pages ?? 1) + (listInfo(lbs)?.pages ?? 1) - 1;
    remembered.set(`${P}\u0000${p.cfg.cloudToken ?? ""}`, { at: now, pages, entries: mine, incomplete: cut });
  });
  // Bounded, so a changing set of projects cannot grow this without end.
  while (remembered.size > 2000) remembered.delete(remembered.keys().next().value!);
  const snap: StatusSnapshot = { checkedAt: new Date(now).toISOString(), entries, failedProjects };
  if (deferred.length) snap.deferredProjects = deferred;
  if (incomplete.length) {
    snap.incompleteProjects = incomplete;
    snap.note = truncatedNote(base, "servers or load balancers in some projects");
  }
  if (opts.workspace !== undefined) snap.workspace = opts.workspace;
  return snap;
}

/** Forgets what earlier polls read, so the next poll reads every project again. */
export function resetStatusMemory(): void {
  remembered.clear();
}

// A change can alter any server or load balancer, so the next poll reads every project again.
onInvalidate(resetStatusMemory);

/** The sample estate's statuses, with no network call. */
export function sampleStatuses(workspace?: string): StatusSnapshot {
  const entries: Record<string, LiveEntry> = {};
  for (const n of sampleGraph().nodes) {
    if (n.kind === "server") entries[n.id] = { status: n.status };
    if (n.kind === "load_balancer") entries[n.id] = { health: n.health };
  }
  const snap: StatusSnapshot = { checkedAt: new Date().toISOString(), entries, failedProjects: [] };
  if (workspace !== undefined) snap.workspace = workspace;
  return snap;
}
