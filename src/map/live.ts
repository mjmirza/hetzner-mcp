/** The cheap live-status poll: only servers and load balancers, per project, read-only GETs. */
import type { HetznerConfig } from "../config.js";
import { listAll, PROJECT_CONCURRENCY } from "./collect.js";
import { discoverProjects, type ProjectRef } from "./projects.js";
import { settleWithLimit } from "./limit.js";
import { readStored } from "./store.js";
import { sampleGraph } from "./sample.js";
import { targetHealth, type LiveEntry, type StatusSnapshot } from "./status.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Lister = (cfg: HetznerConfig, path: "/servers" | "/load_balancers", key: "servers" | "load_balancers") => Promise<Json[]>;

export async function collectStatuses(
  base: HetznerConfig,
  env: NodeJS.ProcessEnv = process.env,
  opts: { workspace?: string; list?: Lister; projects?: ProjectRef[] } = {},
): Promise<StatusSnapshot> {
  const list: Lister = opts.list ?? ((cfg, path, key) => listAll(cfg, "cloud", path, key));
  const all = opts.projects ?? discoverProjects(base, env, readStored(env));
  const projects = all.filter((p) => opts.workspace === undefined || p.workspace === opts.workspace);
  const entries: Record<string, LiveEntry> = {};
  const failedProjects: string[] = [];
  const results = await settleWithLimit(projects, PROJECT_CONCURRENCY, (p) => Promise.all([list(p.cfg, "/servers", "servers"), list(p.cfg, "/load_balancers", "load_balancers")]));
  results.forEach((r, i) => {
    const P = `p:${projects[i]!.account}/${projects[i]!.name}`;
    if (r.status === "rejected") return void failedProjects.push(P);
    const [servers, lbs] = r.value;
    for (const s of servers) entries[`${P}/srv:${s.id}`] = { status: typeof s.status === "string" ? s.status : undefined };
    for (const lb of lbs) entries[`${P}/lb:${lb.id}`] = { health: targetHealth(lb.targets) };
  });
  const snap: StatusSnapshot = { checkedAt: new Date().toISOString(), entries, failedProjects };
  if (opts.workspace !== undefined) snap.workspace = opts.workspace;
  return snap;
}

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
