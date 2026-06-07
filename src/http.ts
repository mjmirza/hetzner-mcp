/**
 * The HTTP client for all three Hetzner surfaces.
 * This module is the only place that touches credentials or the network.
 */
import { SURFACES, type SurfaceName, type HetznerConfig } from "./config.js";
import { HetznerApiError, redactSecrets } from "./errors.js";
import { normalizePath, normalizeMethod } from "./security.js";

export interface RequestOpts {
  surface: SurfaceName;
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  body?: unknown;
}

function authHeader(surface: SurfaceName, cfg: HetznerConfig): string {
  if (SURFACES[surface].auth === "basic") {
    if (!cfg.robotUser || !cfg.robotPassword) {
      throw new HetznerApiError(
        surface,
        0,
        "missing_credentials",
        "Robot credentials missing. Set HETZNER_ROBOT_USER and HETZNER_ROBOT_PASSWORD.",
      );
    }
    const b64 = Buffer.from(`${cfg.robotUser}:${cfg.robotPassword}`).toString("base64");
    return `Basic ${b64}`;
  }
  if (!cfg.cloudToken) {
    throw new HetznerApiError(
      surface,
      0,
      "missing_credentials",
      "Cloud token missing. Set HETZNER_CLOUD_TOKEN.",
    );
  }
  return `Bearer ${cfg.cloudToken}`;
}

function encodeForm(body: unknown): string {
  const params = new URLSearchParams();
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) params.append(k, String(item));
      } else {
        params.append(k, String(v));
      }
    }
  }
  return params.toString();
}

export async function hetznerRequest(cfg: HetznerConfig, opts: RequestOpts): Promise<unknown> {
  const surface = opts.surface;
  const def = SURFACES[surface];
  const method = normalizeMethod(opts.method);
  const path = normalizePath(opts.path);

  const url = new URL(def.base + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: authHeader(surface, cfg),
    Accept: "application/json",
  };

  let payload: string | undefined;
  if (opts.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (def.auth === "basic") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      payload = encodeForm(opts.body);
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
  }

  const init: RequestInit = {
    method,
    headers,
    body: payload,
    redirect: "error", // SSRF safety: never follow a redirect to another host
    signal: AbortSignal.timeout(cfg.timeoutMs), // hard per-request timeout
  };

  let res: Response;
  try {
    res = await fetch(url, init); // BESTPRACTICE_OK: timeout set via init.signal AbortSignal.timeout
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HetznerApiError(surface, 0, "network_error", redactSecrets(msg));
  }

  const text = await res.text();
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }

  if (res.status >= 300) {
    const errObj =
      json && typeof json === "object" && "error" in json
        ? (json as { error: unknown }).error
        : undefined;
    const code =
      errObj && typeof errObj === "object" && "code" in errObj
        ? String((errObj as { code: unknown }).code)
        : `http_${res.status}`;
    const message =
      errObj && typeof errObj === "object" && "message" in errObj
        ? String((errObj as { message: unknown }).message)
        : text || res.statusText;
    throw new HetznerApiError(surface, res.status, code, redactSecrets(message), json);
  }

  return json ?? {};
}

/** Follow Hetzner page pagination up to cfg.maxPages, merging the named array. */
export async function hetznerPaginate(
  cfg: HetznerConfig,
  opts: RequestOpts,
  collectionKey: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let nextPage: number | null = 1;
  let guard = 0;
  while (nextPage !== null && guard < cfg.maxPages) {
    guard++;
    const query = { ...(opts.query ?? {}), page: nextPage, per_page: 50 };
    const res = (await hetznerRequest(cfg, { ...opts, query })) as Record<string, unknown>; // BESTPRACTICE_OK: sequential pagination, page N+1 unknown until page N returns next_page
    const batch = res[collectionKey];
    if (Array.isArray(batch)) items.push(...batch);
    const meta = res.meta as { pagination?: { next_page?: number | null } } | undefined;
    nextPage = meta?.pagination?.next_page ?? null;
  }
  return items;
}
