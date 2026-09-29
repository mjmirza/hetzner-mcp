/**
 * Hetzner Cloud writes return async actions. Wait for them to finish so a tool never
 * reports success while the work is still running or has failed (issue #84).
 */
import type { HetznerConfig } from "./config.js";
import { hetznerRequest } from "./http.js";

interface HAction {
  id?: number;
  command?: string;
  status?: string;
  progress?: number;
  error?: { code?: string; message?: string } | null;
}

export interface ActionOutcome {
  id: number;
  command: string;
  status: "success" | "error" | "running";
  error?: string;
}

/** Collect every action id from a response: action, actions, next_actions. */
export function collectActions(result: unknown): HAction[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const out: HAction[] = [];
  const push = (v: unknown) => {
    if (v && typeof v === "object" && typeof (v as HAction).id === "number") out.push(v as HAction);
  };
  push(r.action);
  for (const key of ["actions", "next_actions"]) {
    const list = r[key];
    if (Array.isArray(list)) list.forEach(push);
  }
  const seen = new Set<number>();
  return out.filter((a) => (seen.has(a.id!) ? false : (seen.add(a.id!), true)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll each action until it is no longer running or the budget runs out.
 * Budget comes from HETZNER_MCP_ACTION_WAIT_MS (default 120000, 0 disables waiting).
 */
export async function waitForActions(
  cfg: HetznerConfig,
  result: unknown,
  opts: { budgetMs?: number; intervalMs?: number } = {},
): Promise<ActionOutcome[]> {
  const pending = collectActions(result);
  if (pending.length === 0) return [];
  const budget = opts.budgetMs ?? cfg.actionWaitMs;
  const interval = opts.intervalMs ?? 1000;
  const deadline = Date.now() + budget;
  const outcomes = new Map<number, ActionOutcome>();

  for (const a of pending) {
    outcomes.set(a.id!, { id: a.id!, command: a.command ?? "unknown", status: toStatus(a) });
  }
  if (budget <= 0) return [...outcomes.values()];

  while ([...outcomes.values()].some((o) => o.status === "running") && Date.now() < deadline) {
    await sleep(interval);
    // Independent polls, one round per interval.
    await Promise.all(
      [...outcomes.values()]
        .filter((o) => o.status === "running")
        .map(async (o) => {
          try {
            const res = (await hetznerRequest(cfg, { surface: "cloud", path: `/actions/${o.id}` })) as {
              action?: HAction;
            };
            const a = res.action;
            if (!a) return;
            o.status = toStatus(a);
            if (a.command) o.command = a.command;
            if (o.status === "error") o.error = a.error?.message ?? a.error?.code ?? "action failed";
          } catch {
            // A transient poll failure keeps the action running; the deadline bounds it.
          }
        }),
    );
  }
  return [...outcomes.values()];
}

function toStatus(a: HAction): ActionOutcome["status"] {
  if (a.status === "success") return "success";
  if (a.status === "error") return "error";
  return "running";
}

/** One line per action for a tool response. */
export function describeActions(outcomes: ActionOutcome[]): string {
  if (outcomes.length === 0) return "";
  const lines = outcomes.map((o) =>
    o.status === "success"
      ? `  ${o.command} (action ${o.id}) finished`
      : o.status === "error"
        ? `  ${o.command} (action ${o.id}) FAILED. ${o.error}`
        : `  ${o.command} (action ${o.id}) still running. Check it with GET /actions/${o.id}`,
  );
  return `\nActions:\n${lines.join("\n")}`;
}

export const anyActionFailed = (o: ActionOutcome[]) => o.some((x) => x.status === "error");
