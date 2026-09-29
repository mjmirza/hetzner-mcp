import { runDagre, type LayoutPlan } from "./dagre-run";

// Lays out large maps off the page thread, so the canvas stays responsive while it works.
self.onmessage = (e: MessageEvent<{ seq: number; plan: LayoutPlan }>) => {
  const centres = runDagre(e.data.plan);
  self.postMessage({ seq: e.data.seq, centres: [...centres] });
};
