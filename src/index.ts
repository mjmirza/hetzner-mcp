#!/usr/bin/env node
/**
 * hetzner-mcp. Model Context Protocol server for the full Hetzner platform.
 * Cloud, Storage Box, and Robot dedicated servers, with a cost guard and token-efficient
 * responses. Talks over stdio.
 *
 * With no arguments it runs the MCP server (how clients launch it). The setup, doctor,
 * help, and version subcommands provide a guided onboarding and a status check.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, availableSurfaces } from "./config.js";
import { registerAllTools, isLean } from "./tools/register.js";
import { runMap } from "./map/cli.js";
import { runAudit } from "./map/audit-cli.js";
import { runSetup } from "./setup/wizard.js";
import { runDoctor } from "./setup/doctor.js";
import { VERSION } from "./version.js";

const pkg = { version: VERSION };

function printHelp(): void {
  process.stdout.write(
    [
      "",
      `  hetzner-mcp ${pkg.version}`,
      "  Model Context Protocol server for the full Hetzner platform.",
      "",
      "  Commands:",
      "    (no args)   Run the MCP server over stdio. This is how MCP clients launch it.",
      "    setup       Guided onboarding. Prompts for a token, verifies it, wires your client.",
      "    doctor      Read-only status check. Token health, surfaces, which clients are wired.",
      "    map         Interactive map of every project, resource, and its monthly cost.",
      "                Flags. --port N, --open, --demo. Default http://127.0.0.1:43390",
      "    audit       Security, cost and reliability audit with fix steps.",
      "                Flags. --out report.md, --json, --demo, --fail-on critical|high",
      "    help        Show this help.",
      "    version     Print the version.",
      "",
      "  Quick start:",
      "    npx hetzner-mcp setup",
      "",
    ].join("\n") + "\n",
  );
}

async function runServer(): Promise<void> {
  const cfg = loadConfig();
  const server = new McpServer({ name: "hetzner-mcp", version: pkg.version });

  registerAllTools(server, cfg);

  // Diagnostics go to stderr so they never corrupt the stdio protocol on stdout.
  const surfaces = availableSurfaces(cfg);
  process.stderr.write(
    `hetzner-mcp ${pkg.version} ready. Surfaces available: ` +
      `${surfaces.length ? surfaces.join(", ") : "none. Run: npx hetzner-mcp setup"}.` +
      `${cfg.readOnly ? " Read-only mode." : ""}${isLean() ? " Lean tool set." : ""}\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "setup" || cmd === "init" || cmd === "--setup") {
    process.exit(await runSetup(argv.slice(1)));
  }
  if (cmd === "doctor" || cmd === "--doctor") {
    process.exit(await runDoctor(argv.slice(1)));
  }
  if (cmd === "map" || cmd === "--map") {
    process.exitCode = await runMap(argv.slice(1));
    return;
  }
  if (cmd === "audit") {
    process.exitCode = await runAudit(argv.slice(1));
    return;
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  await runServer();
}

main().catch((err) => {
  process.stderr.write(`hetzner-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
