/**
 * The HTTP client for all three Hetzner surfaces.
 * This module is the only place that touches credentials or the network.
 */
import { SURFACES, isTokenShape, type SurfaceName, type HetznerConfig } from "./config.js";
import { HetznerApiError, redactSecrets } from "./errors.js";
import { normalizePath, normalizeMethod } from "./security.js";
import { USER_AGENT } from "./version.js";
import { invalidateGraphs } from "./map/graph-cache.js";

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
      cfg.cloudTokenError ?? "Cloud token missing. Set HETZNER_CLOUD_TOKEN.",
    );
  }
  if (!isTokenShape(cfg.cloudToken)) {
    throw new HetznerApiError(surface, 0, "malformed_credentials", "The Cloud token is malformed. It must be letters and digits only, on one line.");
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

/** Requests in flight at once for the whole process, and for one credential. */
export const MAX_IN_FLIGHT = 16;
export const MAX_IN_FLIGHT_PER_TOKEN = 4;
/** Largest response body read. Bigger answers fail with a clear error instead of filling memory. */
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

const active = new Map<string, number>();
let activeTotal = 0;
const waiting: Array<{ key: string; go: () => void }> = [];

function canRun(key: string): boolean {
  return activeTotal < MAX_IN_FLIGHT && (active.get(key) ?? 0) < MAX_IN_FLIGHT_PER_TOKEN;
}

function take(key: string): void {
  activeTotal++;
  active.set(key, (active.get(key) ?? 0) + 1);
}

/** Waits for a free slot. Queued requests start in arrival order once their credential has room. */
function acquire(key: string): Promise<() => void> {
  const release = () => {
    activeTotal--;
    const left = (active.get(key) ?? 1) - 1;
    if (left > 0) active.set(key, left);
    else active.delete(key);
    for (let i = 0; i < waiting.length && activeTotal < MAX_IN_FLIGHT; ) {
      const w = waiting[i]!;
      if (!canRun(w.key)) {
        i++;
        continue;
      }
      waiting.splice(i, 1);
      take(w.key);
      w.go();
    }
  };
  if (canRun(key) && !waiting.some((w) => canRun(w.key))) {
    take(key);
    return Promise.resolve(release);
  }
  return new Promise((resolve) => waiting.push({ key, go: () => resolve(release) }));
}

// Cloud and Storage Box share the Cloud token's rate limit; Robot has its own login.
function limitKey(surface: SurfaceName, cfg: HetznerConfig): string {
  return SURFACES[surface].auth === "basic" ? `robot:${cfg.robotUser ?? ""}` : `cloud:${cfg.cloudToken ?? ""}`;
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers?.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) {
    // Cancel the unread body so the connection closes now instead of staying open.
    await res.body?.cancel().catch(() => undefined);
    throw new Error("too_large");
  }
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("too_large");
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); // chunks arrive in order, each read depends on the last
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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
    "User-Agent": USER_AGENT,
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

  // The timeout starts once a slot is free, so a queued request is never timed out while waiting.
  const release = await acquire(limitKey(surface, cfg));
  let res: Response;
  let text: string;
  try {
    const init: RequestInit = {
      method,
      headers,
      body: payload,
      redirect: "error", // SSRF safety: never follow a redirect to another host
      signal: AbortSignal.timeout(cfg.timeoutMs), // hard per-request timeout
    };
    try {
      res = await fetch(url, init); // timeout set via init.signal AbortSignal.timeout
      text = await readCapped(res);
    } catch (err) {
      if (err instanceof Error && err.message === "too_large") {
        throw new HetznerApiError(surface, 0, "response_too_large", `Hetzner sent more than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB in one answer. Ask for a smaller page.`);
      }
      // Fixed text: fetch's own message can quote a header value, and so a token.
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new HetznerApiError(surface, 0, timedOut ? "timeout" : "network_error", timedOut ? "Hetzner did not answer in time." : "Could not reach Hetzner (network error).");
    }
  } finally {
    release();
    // Any write may change what the map shows, so cached maps are dropped whatever the outcome.
    if (method !== "GET" && method !== "HEAD") invalidateGraphs();
  }
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
