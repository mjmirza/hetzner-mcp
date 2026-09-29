/**
 * Local, read-only web server for the infrastructure map.
 *
 * Security. Binds 127.0.0.1 only, rejects any Host header that is not this loopback
 * address (blocks DNS rebinding), serves GET only, sends a strict CSP with a per-start
 * nonce, never sends a token, and rate-limits live refreshes.
 */
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { HetznerConfig } from "../config.js";
import { collectGraph } from "./collect.js";
import { sampleGraph } from "./sample.js";
import { renderPage } from "./page.js";
import type { InfraGraph } from "./types.js";

/** 43390 is unassigned in the IANA registry and not a common dev-tool port. */
export const DEFAULT_MAP_PORT = 43390;
const HOST = "127.0.0.1";
const MIN_REFRESH_MS = 10_000;

export interface MapServerHandle {
  url: string;
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

export async function startMapServer(
  cfg: HetznerConfig,
  opts: { port?: number; demo?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<MapServerHandle> {
  if (running) return running;
  const env = opts.env ?? process.env;
  const nonce = randomBytes(16).toString("base64");
  let cache: { graph: InfraGraph; at: number } | undefined;
  let inflight: Promise<InfraGraph> | undefined;

  const load = async (force: boolean): Promise<InfraGraph> => {
    if (opts.demo) return sampleGraph();
    const fresh = cache && Date.now() - cache.at < (force ? MIN_REFRESH_MS : 60_000);
    if (fresh) return cache!.graph;
    inflight ??= collectGraph(cfg, env).finally(() => {
      inflight = undefined;
    });
    const graph = await inflight;
    cache = { graph, at: Date.now() };
    return graph;
  };

  let boundPort = 0;
  const server = createServer(async (req, res) => {
    const allowedHosts = new Set([`${HOST}:${boundPort}`, `localhost:${boundPort}`]);
    if (!allowedHosts.has(String(req.headers.host ?? ""))) {
      res.writeHead(421, { "Content-Type": "text/plain" }).end("Misdirected request");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain" }).end("Read-only");
      return;
    }
    const common = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
    };
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    try {
      if (url.pathname === "/") {
        res.writeHead(200, {
          ...common,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
        res.end(renderPage(nonce));
        return;
      }
      if (url.pathname === "/api/graph") {
        const graph = await load(url.searchParams.get("refresh") === "1");
        res.writeHead(200, { ...common, "Content-Type": "application/json" });
        res.end(JSON.stringify(graph));
        return;
      }
      if (url.pathname === "/healthz") {
        res.writeHead(200, { ...common, "Content-Type": "text/plain" }).end("ok");
        return;
      }
      res.writeHead(404, { ...common, "Content-Type": "text/plain" }).end("Not found");
    } catch (err) {
      res.writeHead(502, { ...common, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  // Try the chosen port, then the next nine, so a busy port never blocks the map.
  const first = opts.port ?? mapPortFromEnv(env);
  let lastErr: unknown;
  for (let p = first; p < first + 10; p++) {
    try {
      boundPort = await listen(server, p);
      const url = `http://${HOST}:${boundPort}/`;
      running = {
        url,
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
