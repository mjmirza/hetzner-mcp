/** `hetzner-mcp map` starts the local canvas and keeps it running until Ctrl+C. */
import { spawn } from "node:child_process";
import { loadConfig } from "../config.js";
import { discoverProjects } from "./projects.js";
import { startMapServer } from "./server.js";

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Opening is a convenience; the URL is printed either way.
  }
}

export async function runMap(argv: string[]): Promise<number> {
  const demo = argv.includes("--demo");
  const portArg = argv[argv.indexOf("--port") + 1];
  const port = argv.includes("--port") && /^\d+$/.test(portArg ?? "") ? Number(portArg) : undefined;
  const cfg = loadConfig();
  const projects = discoverProjects(cfg);
  if (!demo && projects.length === 0 && !cfg.robotUser) {
    process.stderr.write("No Hetzner credentials found. Run: npx hetzner-mcp setup, or try: npx hetzner-mcp map --demo\n");
    return 1;
  }
  const handle = await startMapServer(cfg, { port, demo });
  process.stdout.write(
    `\n  Hetzner Infra Map ${demo ? "(sample data)" : `for ${projects.length} project(s)`}\n  ${handle.url}\n\n  Read-only, local only. Press Ctrl+C to stop.\n\n`,
  );
  if (argv.includes("--open")) openBrowser(handle.url);
  await new Promise<void>((resolve) => {
    const stop = () => void handle.close().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
