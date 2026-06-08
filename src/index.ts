#!/usr/bin/env node
/**
 * hetzner-mcp. Model Context Protocol server for the full Hetzner platform.
 * Cloud, Storage Box, and Robot dedicated servers, with a cost guard and token-efficient
 * responses. Talks over stdio.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, availableSurfaces } from "./config.js";
import { registerGenericTools } from "./tools/generic.js";
import { registerReadTools } from "./tools/resources.js";
import { registerWriteTools } from "./tools/write.js";
import { registerContributeTool } from "./tools/contribute.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const server = new McpServer({ name: "hetzner-mcp", version: "0.1.0" });

  registerGenericTools(server, cfg);
  registerReadTools(server, cfg);
  registerWriteTools(server, cfg);
  registerContributeTool(server);

  // Diagnostics go to stderr so they never corrupt the stdio protocol on stdout.
  const surfaces = availableSurfaces(cfg);
  process.stderr.write(
    `hetzner-mcp ready. Surfaces available: ${surfaces.length ? surfaces.join(", ") : "none (set HETZNER_CLOUD_TOKEN)"}.` +
      `${cfg.readOnly ? " Read-only mode." : ""}\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`hetzner-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
