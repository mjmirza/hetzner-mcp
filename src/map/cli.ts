/** `hetzner-mcp map` starts the local canvas and keeps it running until Ctrl+C. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { loadConfig } from "../config.js";
import { discoverProjects } from "./projects.js";
import { readStored } from "./store.js";
import { startMapServer } from "./server.js";
import { clientTargets, readWiredCredentials, tilde, type ClientTarget } from "../setup/clients.js";

export interface Opener {
  cmd: string;
  args: string[];
}

/** An absolute path to the system opener, so a hostile PATH cannot swap in its own program. */
export function openerFor(url: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): Opener | undefined {
  if (platform === "darwin") return { cmd: "/usr/bin/open", args: [url] };
  if (platform === "win32") return { cmd: win32.join(env.SystemRoot || "C:" + win32.sep + "Windows", "System32", "cmd.exe"), args: ["/c", "start", "", url] };
  return exists("/usr/bin/xdg-open") ? { cmd: "/usr/bin/xdg-open", args: [url] } : undefined;
}

export function openBrowser(url: string, opener: Opener | undefined = openerFor(url)): void {
  if (!opener) return;
  try {
    const child = spawn(opener.cmd, opener.args, { stdio: "ignore", detached: true });
    // A missing opener must not take the map down; the URL is printed either way.
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening is a convenience; the URL is printed either way.
  }
}

/**
 * Setup saves the token inside each app's config, not the shell, so borrow it when the shell has none.
 * Without this, `map` run straight after setup would find nothing.
 */
export function mapEnvironment(env: NodeJS.ProcessEnv = process.env, targets: ClientTarget[] = clientTargets()): { env: NodeJS.ProcessEnv; from?: ClientTarget } {
  const hasOwn = Object.keys(env).some((k) => (k === "HETZNER_CLOUD_TOKEN" || k.startsWith("HETZNER_CLOUD_TOKEN_")) && env[k]?.trim());
  if (hasOwn || (env.HETZNER_ROBOT_USER && env.HETZNER_ROBOT_PASSWORD)) return { env };
  const wired = readWiredCredentials(targets).find((w) => w.token);
  if (!wired) return { env };
  const next: NodeJS.ProcessEnv = { ...env, HETZNER_CLOUD_TOKEN: wired.token };
  if (wired.robotUser && wired.robotPassword) {
    next.HETZNER_ROBOT_USER = wired.robotUser;
    next.HETZNER_ROBOT_PASSWORD = wired.robotPassword;
  }
  return { env: next, from: wired.target };
}

export async function runMap(argv: string[]): Promise<number> {
  const demo = argv.includes("--demo");
  const portArg = argv[argv.indexOf("--port") + 1];
  const port = argv.includes("--port") && /^\d+$/.test(portArg ?? "") ? Number(portArg) : undefined;
  const { env, from } = demo ? { env: process.env, from: undefined } : mapEnvironment();
  const cfg = loadConfig(env);
  const projects = discoverProjects(cfg, env, readStored(env));
  if (!demo && projects.length === 0 && !cfg.robotUser) {
    process.stderr.write(
      "\n  No Hetzner token found, in this terminal or in any connected app.\n" +
        "  Connect your account first:   npx hetzner-mcp setup\n" +
        "  Or look around a sample map:  npx hetzner-mcp map --demo --open\n\n",
    );
    return 1;
  }
  const handle = await startMapServer(cfg, { port, demo, env });
  const mode = demo
    ? "Sample data, nothing can change."
    : cfg.readOnly
      ? "Read-only mode."
      : cfg.allowBilled
        ? "Creates and deletes allowed. Billed ones show their price first."
        : "Free creates and deletes allowed. Billed creates are off (HETZNER_MCP_ALLOW_BILLED=1 turns them on).";
  const source = from ? `\n  Using the token saved in ${from.name} (${tilde(from.configPath)}).` : "";
  const next = demo ? "\n  This is made-up data. To map your own account, run: npx hetzner-mcp setup" : "";
  process.stdout.write(
    `\n  Hetzner infrastructure map ${demo ? "(sample data)" : `for ${projects.length} project(s)`}\n  ${handle.url}${source}\n\n  Local only. ${mode} Press Ctrl+C to stop.${next}\n\n`,
  );
  if (argv.includes("--open")) openBrowser(handle.url);
  await new Promise<void>((resolve) => {
    const stop = () => void handle.close().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
