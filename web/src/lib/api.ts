import type { StatusSnapshot } from "../../../src/map/status";
import type { Catalog, InfraGraph, Meta, Plan, WorkspaceSummary } from "./types";

const KEY = "hzmap-key";

/** The per-launch key arrives in the URL fragment. Keep it for reloads, then hide it from the address bar. */
function launchKey(): string {
  const m = /(?:^#|&)k=([0-9a-f]{64})(?:&|$)/.exec(window.location.hash);
  if (m) {
    try {
      sessionStorage.setItem(KEY, m[1]!);
    } catch {
      // Storage can be blocked; the key still works for this page load.
    }
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return m[1]!;
  }
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
const key = launchKey();

/** Every call carries the key as X-Hzmap, which a cross-site page cannot add or know. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "X-Hzmap": key, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

const post = <T>(path: string, data: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(data) });

export const api = {
  graph: (refresh = false, workspace?: string) => {
    const q = new URLSearchParams();
    if (workspace) q.set("workspace", workspace);
    if (refresh) q.set("refresh", "1");
    const s = q.toString();
    return call<InfraGraph>(`/api/graph${s ? `?${s}` : ""}`);
  },
  status: (workspace?: string, signal?: AbortSignal) => call<StatusSnapshot>(`/api/status${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`, { signal }),
  workspaces: () => call<{ default: string; workspaces: WorkspaceSummary[] }>("/api/workspaces"),
  meta: () => call<Meta>("/api/meta"),
  catalog: (project: string) => call<Catalog>(`/api/catalog?project=${encodeURIComponent(project)}`),
  addProject: (d: { name: string; account: string; token: string; workspace?: string }) => post<{ ok: true; message: string }>("/api/projects", d),
  removeProject: (id: string) => post<{ ok: true }>("/api/projects/remove", { id }),
  plan: (d: { project: string; kind: string; params: Record<string, unknown> }) => post<Plan>("/api/plan", d),
  apply: (d: { project: string; kind: string; params: Record<string, unknown>; confirm: true }) => post<{ ok: true; message: string }>("/api/apply", d),
  deletePlan: (nodeId: string) => post<{ name: string; label: string; notes: string[]; blocked?: string }>("/api/delete-plan", { nodeId }),
  remove: (nodeId: string, typed: string) => post<{ ok: true; message: string }>("/api/delete", { nodeId, typed }),
};
