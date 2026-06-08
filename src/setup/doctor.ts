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
  out("  hetzner-mcp doctor");
  out("");

  // Token health. Prefer an explicit flag, else the environment.
  const token = flagToken(argv)?.trim() || cfg.cloudToken;
  if (token) {
    out("  Verifying token against the Hetzner Cloud API...");
    const check = await validateCloudToken(token);
    out(`  ${check.ok ? "OK " : "x  "}Token: ${check.message}`);
  } else {
    out("  -  Token: not set in this terminal. That is expected.");
    out("     The token lives inside each MCP client config, not in your shell.");
    out("     To check a token here, run: npx hetzner-mcp doctor --token <token>");
  }

  // Surfaces available from the current environment.
  const surfaces = availableSurfaces(cfg);
  out("");
  out(`  Surfaces (from this environment): ${surfaces.length ? surfaces.join(", ") : "none"}`);
  out(`  Write mode: ${cfg.readOnly ? "read-only (HETZNER_MCP_READONLY=1)" : "read and write"}`);
  out(`  Billed creates: ${cfg.allowBilled ? "allowed with confirm" : "blocked (HETZNER_MCP_ALLOW_BILLED=0)"}`);

  // Which known clients have hetzner wired.
  out("");
  out("  MCP clients:");
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
    out(`    ${wired ? "OK " : "-  "}${t.name.padEnd(24)} ${wired ? tilde(t.configPath) : "not wired"}`);
  }

  out("");
  if (!wiredCount) {
    out("  No clients are wired yet. Run:  npx hetzner-mcp setup");
  } else {
    out(`  ${wiredCount} client(s) wired. Ask your assistant to list your Hetzner servers.`);
  }
  out("");
  return 0;
}
