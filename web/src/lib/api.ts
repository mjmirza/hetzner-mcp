import type { StatusSnapshot } from "../../../src/map/status";
import type { SpendInvoice, SpendReport } from "../../../src/map/spend";
import type { Catalog, InfraGraph, Meta, Plan, WorkspaceSummary } from "./types";

const KEY = "hzmap-key";

/** The per-launch key arrives in the URL fragment. It is hidden from the address bar only once
 * saved for reloads; when storage is blocked the fragment stays, so a reload still has the key. */
function launchKey(): string {
  const m = /(?:^#|&)k=([0-9a-f]{64})(?:&|$)/.exec(window.location.hash);
  if (m) {
    let saved = false;
    try {
      sessionStorage.setItem(KEY, m[1]!);
      saved = true;
    } catch {
      // Storage is blocked; keep the fragment instead.
    }
    if (saved) history.replaceState(null, "", window.location.pathname + window.location.search);
    return m[1]!;
  }
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
let key = launchKey();
// Pasting a new link into an open tab only changes the fragment, so pick the new key up here.
window.addEventListener("hashchange", () => {
  if (/(?:^#|&)k=[0-9a-f]{64}(?:&|$)/.test(window.location.hash)) {
    key = launchKey();
    window.location.reload();
  }
});

/** The map refused the key: none was given, or the map restarted since. The page asks for it. */
export class AccessKeyError extends Error {
  constructor(readonly reason: "missing" | "stale", message: string) {
    super(message);
  }
}

/** Accepts the full map link or the key alone. Saves it and returns true when it has the right shape. */
export function setAccessKey(input: string): boolean {
  const m = /(?:#|&|^)k=([0-9a-f]{64})\b/.exec(input.trim()) ?? /^([0-9a-f]{64})$/.exec(input.trim());
  if (!m) return false;
  key = m[1]!;
  try {
    sessionStorage.setItem(KEY, key);
  } catch {
    // Storage is blocked; the key still works until the page reloads.
  }
  return true;
}

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
    const reason = res.headers.get("X-Hzmap-Key");
    if (res.status === 403 && (reason === "missing" || reason === "stale")) throw new AccessKeyError(reason, text);
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
  spend: (workspace?: string) => call<SpendReport>(`/api/spend${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`),
  addInvoice: (invoice: SpendInvoice, workspace?: string) => post<{ ok: true; message: string }>("/api/spend/invoices", { invoice, workspace }),
  removeInvoice: (number: string) => post<{ ok: true; message: string }>("/api/spend/invoices/remove", { number }),
};
