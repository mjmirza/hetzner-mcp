/**
 * Live status of servers and load balancers, mapped only from values Hetzner returns.
 * Pure, so the web app and the tests share one mapping. Absent or unrecognised values never read as live.
 */
import type { MapNode, TargetHealth } from "./types.js";

export type LiveState = "live" | "changing" | "off" | "interrupted" | "unknown" | "stale";

export const STATE_LABEL: Record<LiveState, string> = {
  live: "Live",
  changing: "Changing",
  off: "Off",
  interrupted: "Interrupted",
  unknown: "Unknown",
  stale: "Stale",
};

/** One polled value: a Cloud server status, or a load balancer's target health counts. */
export interface LiveEntry {
  status?: string;
  health?: TargetHealth;
}

export interface StatusSnapshot {
  checkedAt: string;
  workspace?: string;
  /** Keyed by graph node id. */
  entries: Record<string, LiveEntry>;
  /** Project node ids Hetzner could not be read for on this check. */
  failedProjects: string[];
}

const CHANGING = new Set(["initializing", "starting", "stopping", "migrating", "rebuilding"]);

/** Hetzner Cloud server status to a state. deleting reads as interrupted, anything else unknown. */
export function serverState(status: string | undefined): LiveState {
  if (status === "running") return "live";
  if (status && CHANGING.has(status)) return "changing";
  if (status === "off") return "off";
  if (status === "deleting") return "interrupted";
  return "unknown";
}

/** Robot dedicated server status. Only "ready" is live. */
export function robotState(status: string | undefined): LiveState {
  if (status === "ready") return "live";
  if (status === "in process") return "changing";
  return "unknown";
}

/** Live only when every target check is healthy, interrupted as soon as one is unhealthy. */
export function healthState(h: TargetHealth | undefined): LiveState {
  if (!h) return "unknown";
  if (h.unhealthy > 0) return "interrupted";
  return h.healthy > 0 && h.unknown === 0 ? "live" : "unknown";
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Counts targets[].health_status[].status, including label selector sub-targets. */
export function targetHealth(targets: Json[] | undefined): TargetHealth {
  const h: TargetHealth = { healthy: 0, unhealthy: 0, unknown: 0 };
  const walk = (list: Json[] | undefined) => {
    for (const t of list ?? []) {
      for (const s of (t.health_status ?? []) as Json[]) {
        if (s.status === "healthy") h.healthy++;
        else if (s.status === "unhealthy") h.unhealthy++;
        else h.unknown++;
      }
      walk(t.targets as Json[] | undefined);
    }
  };
  walk(targets);
  return h;
}

export interface LiveView {
  /** What the dot shows. stale when the last check failed. */
  state: LiveState;
  /** The state from the last value Hetzner returned. */
  known: LiveState;
  /** The exact Hetzner value, for tooltips and screen readers. */
  raw: string;
  stale: boolean;
}

const LIVE_KINDS = new Set(["server", "load_balancer", "robot_server"]);
const projectOf = (n: MapNode) => (n.project ? `p:${n.account}/${n.project}` : "");

function describe(kind: string, e: LiveEntry): { known: LiveState; raw: string } {
  if (kind === "load_balancer") {
    const h = e.health;
    const raw = h ? `targets ${h.healthy} healthy, ${h.unhealthy} unhealthy, ${h.unknown} unknown` : "no target health";
    return { known: healthState(h), raw };
  }
  return { known: kind === "robot_server" ? robotState(e.status) : serverState(e.status), raw: e.status ? `status ${e.status}` : "no status" };
}

/** Merges the latest poll over the graph. A failed poll keeps the last known value but marks it stale. */
export function liveOf(n: MapNode, snap: StatusSnapshot | null, failed: boolean): LiveView | null {
  if (!LIVE_KINDS.has(n.kind)) return null;
  const own: LiveEntry = { status: n.status, health: n.health };
  // Robot servers are not polled, so they keep the value from the last map refresh.
  if (n.kind === "robot_server") return { ...describe(n.kind, own), state: robotState(n.status), stale: false };
  const projectFailed = !!snap?.failedProjects.includes(projectOf(n));
  let entry = own;
  if (snap && !projectFailed) entry = snap.entries[n.id] ?? {};
  const d = describe(n.kind, entry);
  const stale = failed || projectFailed;
  if (snap && !projectFailed && !snap.entries[n.id]) d.raw = "not returned by Hetzner on the last check";
  return { ...d, state: stale ? "stale" : d.known, stale };
}

export interface Rollup {
  tone: LiveState;
  text: string;
  title: string;
}

/** One line for a project card, from its servers only. null when the project has no servers. */
export function rollup(views: LiveView[]): Rollup | null {
  if (!views.length) return null;
  const total = views.length;
  const count = (...s: LiveState[]) => views.filter((v) => s.includes(v.known)).length;
  const live = count("live");
  const bad = count("interrupted", "unknown");
  const changing = count("changing");
  const off = count("off");
  const parts = live === total ? ["Live"] : [bad ? `${bad} of ${total} interrupted` : `${live} of ${total} live`];
  if (changing) parts.push(`${changing} changing`);
  if (off) parts.push(`${off} off`);
  const tone: LiveState = bad ? "interrupted" : changing ? "changing" : live ? "live" : "off";
  const tally = new Map<string, number>();
  for (const v of views) tally.set(v.raw, (tally.get(v.raw) ?? 0) + 1);
  const title = `Servers by Hetzner status: ${[...tally].map(([k, c]) => `${c} ${k.replace(/^status /, "")}`).join(", ")}`;
  const text = parts.join(" · ");
  return views.some((v) => v.stale) ? { tone: "stale", text: `Last known: ${text}`, title: `Last check failed. ${title}` } : { tone, text, title };
}

/** Every card's live view plus a roll-up per project node id. */
export function liveLookup(nodes: MapNode[], snap: StatusSnapshot | null, failed: boolean) {
  const views = new Map<string, LiveView>();
  const byProject = new Map<string, LiveView[]>();
  for (const n of nodes) {
    const v = liveOf(n, snap, failed);
    if (!v) continue;
    views.set(n.id, v);
    if (n.kind === "server") byProject.set(projectOf(n), [...(byProject.get(projectOf(n)) ?? []), v]);
  }
  const rollups = new Map<string, Rollup>();
  for (const [p, vs] of byProject) {
    const r = rollup(vs);
    if (r) rollups.set(p, r);
  }
  return { views, rollups };
}
