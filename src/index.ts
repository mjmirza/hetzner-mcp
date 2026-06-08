#!/usr/bin/env node
/**
 * hetzner-mcp. Model Context Protocol server for the full Hetzner platform.
 * Cloud, Storage Box, and Robot dedicated servers, with a cost guard and token-efficient
 * responses. Talks over stdio.
 *
 * With no arguments it runs the MCP server (how clients launch it). The setup, doctor,
 * help, and version subcommands provide a guided onboarding and a status check.
 */
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, availableSurfaces } from "./config.js";
import { registerGenericTools } from "./tools/generic.js";
import { registerReadTools } from "./tools/resources.js";
import { registerWriteTools } from "./tools/write.js";
import { registerContributeTool } from "./tools/contribute.js";
import { runSetup } from "./setup/wizard.js";
import { runDoctor } from "./setup/doctor.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

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

  registerGenericTools(server, cfg);
  registerReadTools(server, cfg);
  registerWriteTools(server, cfg);
  registerContributeTool(server);

  // Diagnostics go to stderr so they never corrupt the stdio protocol on stdout.
  const surfaces = availableSurfaces(cfg);
  process.stderr.write(
    `hetzner-mcp ${pkg.version} ready. Surfaces available: ` +
      `${surfaces.length ? surfaces.join(", ") : "none. Run: npx hetzner-mcp setup"}.` +
      `${cfg.readOnly ? " Read-only mode." : ""}\n`,
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
