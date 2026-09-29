/**
 * One shared, short-lived copy of each mapped estate, so infra_map, infra_audit and its pages
 * do not re-read every project on each call. Concurrent callers share one read.
 */
import type { InfraGraph } from "./types.js";

const GRAPH_TTL_MS = 60_000;
const MAX_CACHED_GRAPHS = 8;

type Slot = { at: number; graph: InfraGraph };
const cache = new Map<string, Slot>();
const inflight = new Map<string, Promise<InfraGraph>>();
let generation = 0;

/** Returns a fresh-enough graph for key, reading it with load at most once at a time. */
export async function cachedGraph(key: string, load: () => Promise<InfraGraph>, opts: { refresh?: boolean; now?: () => number } = {}): Promise<InfraGraph> {
  const now = opts.now ?? Date.now;
  const hit = cache.get(key);
  if (hit && !opts.refresh && now() - hit.at < GRAPH_TTL_MS) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.graph;
  }
  const running = inflight.get(key);
  if (running && !opts.refresh) return running;
  const startedAt = generation;
  const job: Promise<InfraGraph> = load().then((graph) => {
    // A change landed during the read, so this copy may already be out of date.
    if (startedAt === generation) {
      cache.delete(key);
      cache.set(key, { at: now(), graph });
      while (cache.size > MAX_CACHED_GRAPHS) cache.delete(cache.keys().next().value!);
    }
    return graph;
  });
  const settled = job.finally(() => {
    if (inflight.get(key) === settled) inflight.delete(key);
  });
  inflight.set(key, settled);
  return settled;
}

/** Drops every cached graph. Call after anything that changes infrastructure or projects. */
export function invalidateGraphs(): void {
  generation++;
  cache.clear();
  inflight.clear();
}
