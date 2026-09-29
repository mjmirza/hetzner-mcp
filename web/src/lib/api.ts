import type { Catalog, InfraGraph, Meta, Plan, WorkspaceSummary } from "./types";

/** Every call carries X-Hzmap, which a cross-site page cannot add without a preflight we never answer. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "X-Hzmap": "1", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
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
