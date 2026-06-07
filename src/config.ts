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
  /** Robot webservice user, for the dedicated-server surface only. */
  robotUser: string | undefined;
  robotPassword: string | undefined;
  /** When true, every write (POST/PUT/PATCH/DELETE) is refused. */
  readOnly: boolean;
  /** When false (env set to "0"), billed creates are hard-blocked even with confirm. */
  allowBilled: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Hard cap on auto-pagination to bound cost and memory. */
  maxPages: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HetznerConfig {
  return {
    cloudToken: env.HETZNER_CLOUD_TOKEN?.trim() || undefined,
    robotUser: env.HETZNER_ROBOT_USER?.trim() || undefined,
    robotPassword: env.HETZNER_ROBOT_PASSWORD || undefined,
    readOnly: env.HETZNER_MCP_READONLY === "1",
    allowBilled: env.HETZNER_MCP_ALLOW_BILLED !== "0",
    timeoutMs: positiveInt(env.HETZNER_MCP_TIMEOUT_MS, 30000),
    maxPages: positiveInt(env.HETZNER_MCP_MAX_PAGES, 20),
  };
}

/** Which surfaces are usable given the credentials present. */
export function availableSurfaces(cfg: HetznerConfig): SurfaceName[] {
  const out: SurfaceName[] = [];
  if (cfg.cloudToken) out.push("cloud", "storagebox");
  if (cfg.robotUser && cfg.robotPassword) out.push("robot");
  return out;
}
