/**
 * The doctor command. A read-only console companion that answers, at a glance,
 * is my token good, what can I do, and which clients are wired. It writes nothing.
 * This is the verify step that backs every claim the setup wizard makes.
 */
import { stdout } from "node:process";
import fs from "node:fs";
import { loadConfig, availableSurfaces } from "../config.js";
import { clientTargets, hasHetznerServer, tilde } from "./clients.js";
import { validateCloudToken } from "./validate.js";
import { bold, dim, green, red, cyan } from "./style.js";

function out(s: string): void {
  stdout.write(s + "\n");
}

function flagToken(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--token") return argv[i + 1];
    if (argv[i].startsWith("--token=")) return argv[i].slice("--token=".length);
  }
  return undefined;
}

export async function runDoctor(argv: string[]): Promise<number> {
  const cfg = loadConfig();
  out("");
  out("  " + bold(cyan("hetzner-mcp doctor")));
  out("  " + dim("A read-only health check. It looks, and changes nothing."));
  out("");

  // Token health. Prefer an explicit flag, else the environment.
  const token = flagToken(argv)?.trim() || cfg.cloudToken;
  if (token) {
    out(dim("  Checking your token with Hetzner..."));
    const check = await validateCloudToken(token);
    out(`  ${check.ok ? green("OK ") : red("x  ")}${bold("Token")}. ${check.message}`);
  } else {
    out(`  ${dim("-")}  ${bold("Token")}. Not set in this terminal, which is normal.`);
    out(dim("     It lives inside each app's config, not in your shell."));
    out(dim("     To check one here, run. npx hetzner-mcp doctor --token <token>"));
  }

  // Surfaces available from the current environment.
  const surfaces = availableSurfaces(cfg);
  out("");
  out(`  ${dim("Surfaces in this shell.")} ${surfaces.length ? surfaces.join(", ") : "none"}`);
  out(`  ${dim("Write mode.")} ${cfg.readOnly ? "read-only (HETZNER_MCP_READONLY=1)" : "read and write"}`);
  out(`  ${dim("Billed creates.")} ${cfg.allowBilled ? "allowed with confirm" : "blocked (HETZNER_MCP_ALLOW_BILLED=0)"}`);

  // Which known clients have hetzner wired.
  out("");
  out("  " + bold("Your apps:"));
  let wiredCount = 0;
  for (const t of clientTargets()) {
    let wired = false;
    if (fs.existsSync(t.configPath)) {
      try {
        const raw = fs.readFileSync(t.configPath, "utf8");
        wired = raw.trim() ? hasHetznerServer(JSON.parse(raw), t.configKey) : false;
      } catch {
        wired = false;
      }
    }
    if (wired) wiredCount++;
    const marker = wired ? green("OK ") : dim("-  ");
    const tail = wired ? dim(tilde(t.configPath)) : dim("not connected yet");
    out(`    ${marker}${t.name.padEnd(24)} ${tail}`);
  }

  out("");
  if (!wiredCount) {
    out("  " + bold("No app is connected yet.") + " Set one up in one command.");
    out("       " + cyan("npx hetzner-mcp setup"));
  } else {
    out("  " + green(bold(`All good. ${wiredCount} app${wiredCount === 1 ? "" : "s"} connected.`)));
    out("  Open a chat and ask, in plain words.");
    out("       " + cyan('"List my Hetzner servers and show this month cost."'));
  }
  out("");
  return 0;
}
