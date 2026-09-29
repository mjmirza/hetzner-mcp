/**
 * Configuration and surface definitions.
 * Secrets come only from environment variables and are never logged.
 */

type AuthKind = "bearer" | "basic";

interface SurfaceDef {
  base: string;
  auth: AuthKind;
}

/** The three Hetzner API surfaces this MCP covers (verified live 2026-06-07). */
export const SURFACES = {
  cloud: { base: "https://api.hetzner.cloud/v1", auth: "bearer" },
  storagebox: { base: "https://api.hetzner.com/v1", auth: "bearer" },
  robot: { base: "https://robot-ws.your-server.de", auth: "basic" },
} as const satisfies Record<string, SurfaceDef>;

export type SurfaceName = keyof typeof SURFACES;

export interface HetznerConfig {
  /** Cloud API token. Also authenticates the Storage Box surface. */
  cloudToken: string | undefined;
  /** Why a set token was not used, naming only the variable. */
  cloudTokenError?: string;
  /** Robot webservice user, for the dedicated-server surface only. */
  robotUser: string | undefined;
  robotPassword: string | undefined;
  /** When true, every write (POST/PUT/PATCH/DELETE) is refused. */
  readOnly: boolean;
  /** When true (env set to "1"), billed creates are allowed with per-call confirm. Default off. */
  allowBilled: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Hard cap on auto-pagination to bound cost and memory. */
  maxPages: number;
  /** How long a write waits for its Hetzner actions to finish. 0 disables waiting. */
  actionWaitMs: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Hetzner API tokens are letters and digits. Anything else, such as a pasted newline, is a typo. */
export const isTokenShape = (t: string): boolean => /^[A-Za-z0-9]+$/.test(t);

/** Reads a token variable. A malformed value is dropped and explained by name, never echoed. */
export function readToken(env: NodeJS.ProcessEnv, name: string): { token?: string; error?: string } {
  const raw = env[name]?.trim();
  if (!raw) return {};
  if (isTokenShape(raw)) return { token: raw };
  return { error: `${name} is malformed. A token is letters and digits only, on one line. Copy it again.` };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HetznerConfig {
  const cloud = readToken(env, "HETZNER_CLOUD_TOKEN");
  return {
    cloudToken: cloud.token,
    ...(cloud.error ? { cloudTokenError: cloud.error } : {}),
    robotUser: env.HETZNER_ROBOT_USER?.trim() || undefined,
    robotPassword: env.HETZNER_ROBOT_PASSWORD || undefined,
    readOnly: env.HETZNER_MCP_READONLY === "1",
    // Opt-in. unset / empty / anything other than "1" blocks billed creates even with confirm.
    allowBilled: env.HETZNER_MCP_ALLOW_BILLED === "1",
    timeoutMs: positiveInt(env.HETZNER_MCP_TIMEOUT_MS, 30000),
    maxPages: positiveInt(env.HETZNER_MCP_MAX_PAGES, 20),
    // Capped at 10 minutes so a stuck action can never hang a tool call.
    actionWaitMs: env.HETZNER_MCP_ACTION_WAIT_MS === "0" ? 0 : Math.min(positiveInt(env.HETZNER_MCP_ACTION_WAIT_MS, 120000), 600000),
  };
}

/** Which surfaces are usable given the credentials present. */
export function availableSurfaces(cfg: HetznerConfig): SurfaceName[] {
  const out: SurfaceName[] = [];
  if (cfg.cloudToken) out.push("cloud", "storagebox");
  if (cfg.robotUser && cfg.robotPassword) out.push("robot");
  return out;
}
