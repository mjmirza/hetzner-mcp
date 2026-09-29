/** `hetzner-mcp map` starts the local canvas and keeps it running until Ctrl+C. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { loadConfig } from "../config.js";
import { discoverProjects } from "./projects.js";
import { readStored } from "./store.js";
import { startMapServer } from "./server.js";

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

export async function runMap(argv: string[]): Promise<number> {
  const demo = argv.includes("--demo");
  const portArg = argv[argv.indexOf("--port") + 1];
  const port = argv.includes("--port") && /^\d+$/.test(portArg ?? "") ? Number(portArg) : undefined;
  const cfg = loadConfig();
  const projects = discoverProjects(cfg, process.env, readStored());
  if (!demo && projects.length === 0 && !cfg.robotUser) {
    process.stderr.write("No Hetzner credentials found. Run: npx hetzner-mcp setup, or try: npx hetzner-mcp map --demo\n");
    return 1;
  }
  const handle = await startMapServer(cfg, { port, demo });
  const mode = demo
    ? "Sample data, nothing can change."
    : cfg.readOnly
      ? "Read-only mode."
      : cfg.allowBilled
        ? "Creates and deletes allowed. Billed ones show their price first."
        : "Free creates and deletes allowed. Billed creates are off (HETZNER_MCP_ALLOW_BILLED=1 turns them on).";
  process.stdout.write(
    `\n  Hetzner infrastructure map ${demo ? "(sample data)" : `for ${projects.length} project(s)`}\n  ${handle.url}\n\n  Local only. ${mode} Press Ctrl+C to stop.\n\n`,
  );
  if (argv.includes("--open")) openBrowser(handle.url);
  await new Promise<void>((resolve) => {
    const stop = () => void handle.close().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
