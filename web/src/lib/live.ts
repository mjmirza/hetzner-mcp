import { useEffect, useMemo, useRef, useState } from "react";
import { liveLookup, type LiveView, type Rollup, type StatusSnapshot } from "../../../src/map/status";
import { api } from "./api";
import type { InfraGraph, MapNode } from "./types";

const POLL_MS = 60_000;

export interface LiveLookup {
  view: (n: MapNode) => LiveView | undefined;
  rollup: (projectId: string) => Rollup | undefined;
  /** When Hetzner last answered, the map load counts as the first answer. */
  checkedAt: string;
  failed: boolean;
}

/** Polls servers and load balancers every minute while the page is visible. Never relayouts. */
export function useLiveStatus(graph: InfraGraph | null): LiveLookup {
  const [snap, setSnap] = useState<StatusSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    setSnap(null);
    setFailed(false);
    if (!graph) return;
    last.current = Date.parse(graph.generatedAt) || Date.now();
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      last.current = Date.now();
      try {
        const s = await api.status(graph.workspace);
        if (!alive) return;
        setSnap(s);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    const timer = setInterval(poll, POLL_MS);
    // Back on the tab after a pause: check at once instead of showing an old Live.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= POLL_MS) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [graph]);

  return useMemo(() => {
    const { views, rollups } = liveLookup(graph?.nodes ?? [], snap, failed);
    return {
      view: (n: MapNode) => views.get(n.id),
      rollup: (id: string) => rollups.get(id),
      checkedAt: snap?.checkedAt ?? graph?.generatedAt ?? "",
      failed,
    };
  }, [graph, snap, failed]);
}
