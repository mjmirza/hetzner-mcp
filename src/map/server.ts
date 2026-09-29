/**
 * Local web server for the infrastructure map. Loopback only, strict Host and Origin checks,
 * a per-launch secret on every API call, a strict CSP, and no Hetzner token ever sent to the browser.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import type { HetznerConfig } from "../config.js";
import { collectGraph } from "./collect.js";
import { DEFAULT_WORKSPACE, defaultWorkspace, discoverProjects, listWorkspaces, type WorkspaceSummary } from "./projects.js";
import { readStored } from "./store.js";
import { sampleGraph } from "./sample.js";
import { collectStatuses, sampleStatuses } from "./live.js";
import { invalidateGraphs } from "./graph-cache.js";
import type { StatusSnapshot } from "./status.js";
import { ActionError, apply, catalog, connectProject, deleteNode, deletePlan, disconnectProject, meta, plan, projectById, publicCatalog, type ActionEnv } from "./actions.js";
import type { InfraGraph } from "./types.js";

/** 43390 is unassigned in the IANA registry and not a common dev-tool port. */
export const DEFAULT_MAP_PORT = 43390;
const HOST = "127.0.0.1";
const MIN_REFRESH_MS = 10_000;
const MAX_BODY = 16 * 1024;
const MAX_CACHED_WORKSPACES = 12;
/** A request waits this long for a map or status read, then gets a clear error while the read goes on. */
const JOB_DEADLINE_MS = 45_000;
const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
// Running from source (tsx) serves the copy built into dist.
const WEB_FALLBACK = fileURLToPath(new URL("../../dist/web/", import.meta.url));
const ASSET = /^\/assets\/[A-Za-z0-9._-]+\.(js|css|svg|woff2)$/;
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8" };
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface MapServerHandle {
  /** Opens the map. Carries the per-launch key in the fragment, which is never sent to the server. */
  url: string;
  /** The per-launch key every /api call must send as X-Hzmap. */
  token: string;
  port: number;
  close: () => Promise<void>;
}

let running: MapServerHandle | undefined;

export function mapPortFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.HETZNER_MCP_MAP_PORT);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_MAP_PORT;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) {
      req.resume();
      reject(new ActionError(413, "Request too large."));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY) return reject(new ActionError(413, "Request too large."));
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
      } catch {
        reject(new ActionError(400, "Body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

export async function startMapServer(
  cfg: HetznerConfig,
  opts: { port?: number; demo?: boolean; env?: NodeJS.ProcessEnv; collect?: (workspace: string | undefined) => Promise<InfraGraph>;
    statuses?: (workspace: string | undefined) => Promise<StatusSnapshot>;
    deadlineMs?: number;
  } = {},
): Promise<MapServerHandle> {
  if (running) return running;
  const env = opts.env ?? process.env;
  const actx: ActionEnv = { base: cfg, env, demo: opts.demo === true };
  // One cache slot per workspace, so switching back is instant and 100 clients never load at once.
  const cache = new Map<string, { graph: InfraGraph; at: number }>();
  const inflight = new Map<string, Promise<InfraGraph>>();
  const collect = opts.collect ?? ((workspace: string | undefined) => collectGraph(cfg, env, { workspace }));
  const deadline = opts.deadlineMs ?? JOB_DEADLINE_MS;
  const withinDeadline = <T>(job: Promise<T>, what: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ActionError(504, `Reading ${what} from Hetzner is taking longer than ${Math.round(deadline / 1000)} seconds. It carries on in the background, try again shortly.`)), deadline);
    });
    return Promise.race([job, late]).finally(() => clearTimeout(timer));
  };

  const workspaces = (): WorkspaceSummary[] => {
    if (opts.demo) {
      const g = sampleGraph();
      const count = (k: string) => g.nodes.filter((n) => n.kind === k).length;
      return [{ name: DEFAULT_WORKSPACE, accounts: count("account"), projects: count("project") }];
    }
    return listWorkspaces(discoverProjects(cfg, env, readStored(env)), env, !!(cfg.robotUser && cfg.robotPassword));
  };

  let generation = 0;
  const load = async (workspace: string | undefined, force: boolean): Promise<InfraGraph> => {
    if (opts.demo) return { ...sampleGraph(), workspace };
    const key = workspace ?? "";
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < (force ? MIN_REFRESH_MS : 60_000)) {
      // Most recently used goes last, so eviction drops the workspace unused the longest.
      cache.delete(key);
      cache.set(key, hit);
      return hit.graph;
    }
    let job = inflight.get(key);
    if (!job) {
      const startedAt = generation;
      // Cached when the read ends, even if the request that started it already gave up waiting.
      const mine: Promise<InfraGraph> = collect(workspace)
        .then((graph) => {
          // A change landed while this graph was being read, so it is stale. Serve it once, never cache it.
          if (startedAt === generation) {
            cache.delete(key);
            cache.set(key, { graph, at: Date.now() });
            // Keep only the most recently loaded workspaces in memory.
            while (cache.size > MAX_CACHED_WORKSPACES) cache.delete(cache.keys().next().value!);
          }
          return graph;
        })
        .finally(() => {
          // Only remove our own entry; after a clear, a newer request for this key may own it.
          if (inflight.get(key) === mine) inflight.delete(key);
        });
      job = mine;
      inflight.set(key, job);
    }
    return withinDeadline(job, "the map");
  };

  // A fresh secret each launch, so another local user or a page cannot call the API.
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  const authorized = (v: unknown): boolean => {
    if (typeof v !== "string") return false;
    const got = Buffer.from(v);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  let boundPort = 0;
  // A slow client cannot hold a connection open for long; timeouts are checked every second.
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, connectionsCheckingInterval: 1_000 }, async (req, res) => {
    const origins = [`${HOST}:${boundPort}`, `localhost:${boundPort}`];
    if (!origins.includes(String(req.headers.host ?? ""))) {
      res.writeHead(421, { "Content-Type": "text/plain" }).end("Misdirected request");
      return;
    }
    const common = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { ...common, "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const method = req.method ?? "GET";

    try {
      if (!url.pathname.startsWith("/api/")) {
        if (method !== "GET" && method !== "HEAD") {
          res.writeHead(405, { ...common, Allow: "GET, HEAD" }).end();
          return;
        }
        if (url.pathname === "/healthz") {
          res.writeHead(200, { ...common, "Content-Type": "text/plain" }).end("ok");
          return;
        }
        const file = url.pathname === "/" || url.pathname === "/index.html" ? "index.html" : ASSET.test(url.pathname) ? url.pathname.slice(1) : null;
        if (!file) {
          res.writeHead(404, { ...common, "Content-Type": "text/plain" }).end("Not found");
          return;
        }
        let body: Buffer | undefined;
        for (const dir of [WEB_DIR, WEB_FALLBACK]) {
          body = await readFile(join(dir, file)).catch(() => undefined); // first existing dir wins, order matters
          if (body) break;
        }
        if (!body) {
          res.writeHead(503, { ...common, "Content-Type": "text/plain" }).end("The map app is not built. Run npm run build.");
          return;
        }
        res.writeHead(200, { ...common, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": CSP });
        res.end(method === "HEAD" ? undefined : body);
        return;
      }

      // A cross-site page cannot add this header without a preflight, and cannot know the secret.
      if (!authorized(req.headers["x-hzmap"])) {
        res.writeHead(403, { ...common, "Content-Type": "text/plain" }).end("Forbidden");
        return;
      }
      const origin = req.headers.origin;
      if (origin && !origins.map((o) => `http://${o}`).includes(origin)) {
        res.writeHead(403, { ...common, "Content-Type": "text/plain" }).end("Forbidden origin");
        return;
      }

      if (method === "GET") {
        if (url.pathname === "/api/workspaces") {
          const list = workspaces();
          return json(200, { default: list[0]?.name ?? (opts.demo ? DEFAULT_WORKSPACE : defaultWorkspace(env)), workspaces: list });
        }
        if (url.pathname === "/api/graph") {
          const list = workspaces();
          const asked = url.searchParams.get("workspace");
          if (asked !== null && !list.some((w) => w.name === asked)) throw new ActionError(400, "Unknown workspace. GET /api/workspaces lists the valid names.");
          return json(200, await load(asked ?? list[0]?.name, url.searchParams.get("refresh") === "1"));
        }
        if (url.pathname === "/api/status") {
          const list = workspaces();
          const asked = url.searchParams.get("workspace");
          if (asked !== null && !list.some((w) => w.name === asked)) throw new ActionError(400, "Unknown workspace. GET /api/workspaces lists the valid names.");
          return json(200, await liveStatus(asked ?? list[0]?.name));
        }
        if (url.pathname === "/api/meta") return json(200, meta(actx));
        if (url.pathname === "/api/catalog") {
          if (opts.demo) throw new ActionError(403, "This is sample data. Start the live map to create real resources.");
          return json(200, publicCatalog(await catalog(projectById(actx, url.searchParams.get("project") ?? ""))));
        }
        return json(404, { error: "Not found" });
      }
      if (method !== "POST") {
        res.writeHead(405, { ...common, Allow: "GET, POST" }).end();
        return;
      }
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new ActionError(415, "Send JSON.");
      const body = await readJson(req);
      if (opts.demo && url.pathname !== "/api/projects") throw new ActionError(403, "This is sample data. Start the live map to change real resources.");
      const done = (message: string) => {
        generation++;
        inflight.clear();
        cache.clear();
        statusCache.clear();
        invalidateGraphs();
        json(200, { ok: true, message });
      };
      switch (url.pathname) {
        case "/api/projects":
          return done(await connectProject(actx, body));
        case "/api/projects/remove":
          return done(await disconnectProject(actx, body.id));
        case "/api/plan": {
          if (opts.demo) throw new ActionError(403, "This is sample data. Start the live map to create real resources.");
          const p = await plan(actx, projectById(actx, String(body.project ?? "")), body.kind, (body.params ?? {}) as Record<string, unknown>);
          return json(200, { label: p.label, billed: p.billed, monthly: p.monthly, currency: p.currency, notes: p.notes, blocked: p.blocked });
        }
        case "/api/apply":
          return done(await apply(actx, projectById(actx, String(body.project ?? "")), body.kind, (body.params ?? {}) as Record<string, unknown>, body.confirm));
        case "/api/delete-plan":
          return json(200, await deletePlan(actx, body.nodeId));
        case "/api/delete":
          return done(await deleteNode(actx, body.nodeId, body.typed));
        default:
          return json(404, { error: "Not found" });
      }
    } catch (err) {
      if (err instanceof ActionError) return json(err.status, { error: err.message });
      return json(502, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Several open tabs share one poll, so the rate limit never pays per tab.
  // A running poll is shared until it ends, then its answer is reused for 20 seconds.
  const statusCache = new Map<string, { at: number; job: Promise<StatusSnapshot>; done: boolean }>();
  const liveStatus = (workspace: string | undefined): Promise<StatusSnapshot> => {
    if (opts.demo) return Promise.resolve(sampleStatuses(workspace));
    const key = workspace ?? "";
    const hit = statusCache.get(key);
    if (hit && (!hit.done || Date.now() - hit.at < MIN_REFRESH_MS * 2)) return withinDeadline(hit.job, "live status");
    const job = opts.statuses ? opts.statuses(workspace) : collectStatuses(cfg, env, { workspace });
    const entry = { at: Date.now(), job, done: false };
    job.then(
      () => {
        entry.done = true;
        entry.at = Date.now();
      },
      () => {
        if (statusCache.get(key) === entry) statusCache.delete(key);
      },
    );
    statusCache.set(key, entry);
    return withinDeadline(job, "live status");
  };

  // Try the chosen port, then the next nine, so a busy port never blocks the map.
  const first = opts.port ?? mapPortFromEnv(env);
  let lastErr: unknown;
  for (let p = first; p < first + 10; p++) {
    try {
      boundPort = await listen(server, p); // ports are tried in order, each depends on the previous failing
      running = {
        url: `http://${HOST}:${boundPort}/#k=${token}`,
        token,
        port: boundPort,
        close: () =>
          new Promise<void>((resolve) => {
            running = undefined;
            server.close(() => resolve());
          }),
      };
      return running;
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") break;
    }
  }
  throw new Error(`Could not start the map server near port ${first}. ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
