/**
 * MCP client detection and config shaping. Pure, no IO, so it is fully unit-testable.
 * The wizard and doctor commands consume these to write or inspect a client's config.
 */
import os from "node:os";
import path from "node:path";

/** Where a known MCP client stores its server config, and how that config is shaped. */
export interface ClientTarget {
  /** Stable id used on the command line, for example claude-desktop. */
  id: string;
  /** Human label shown in prompts and summaries. */
  name: string;
  /** Absolute path to the client's JSON config file. */
  configPath: string;
  /** Top-level key the client reads servers from. Most use mcpServers, VS Code uses servers. */
  configKey: "mcpServers" | "servers";
  /** VS Code requires an explicit transport type on each entry. */
  needsType: boolean;
  /** One-line instruction to apply the change in that client. */
  restartHint: string;
}

/** The credentials a server entry may carry. Empty values are omitted, never written blank. */
export interface ServerEntryEnv {
  HETZNER_CLOUD_TOKEN?: string;
  HETZNER_ROBOT_USER?: string;
  HETZNER_ROBOT_PASSWORD?: string;
}

/** A single mcpServers entry pointing at the published package via npx. */
export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  type?: "stdio";
}

const HOME_TOKEN = "~";

/** Render an absolute path with the home directory collapsed to ~, for readable output. */
export function tilde(p: string, home: string = os.homedir()): string {
  return p.startsWith(home) ? HOME_TOKEN + p.slice(home.length) : p;
}

/**
 * The well-known MCP clients this wizard can wire, with their per-OS config paths.
 * cwd is passed in so the VS Code project target can be resolved against the project root.
 */
export function clientTargets(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ClientTarget[] {
  const desktop =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : platform === "win32"
        ? path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
        : path.join(home, ".config", "Claude", "claude_desktop_config.json");

  return [
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      configPath: desktop,
      configKey: "mcpServers",
      needsType: false,
      restartHint: "Quit Claude Desktop fully and reopen it.",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      configPath: path.join(home, ".claude.json"),
      configKey: "mcpServers",
      needsType: false,
      restartHint: "Run /mcp in Claude Code, then reconnect hetzner.",
    },
    {
      id: "cursor",
      name: "Cursor",
      configPath: path.join(home, ".cursor", "mcp.json"),
      configKey: "mcpServers",
      needsType: false,
      restartHint: "Restart Cursor.",
    },
    {
      id: "windsurf",
      name: "Windsurf",
      configPath: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
      configKey: "mcpServers",
      needsType: false,
      restartHint: "Restart Windsurf.",
    },
    {
      id: "vscode",
      name: "VS Code (this project)",
      configPath: path.join(cwd, ".vscode", "mcp.json"),
      configKey: "servers",
      needsType: true,
      restartHint: "Reload the VS Code window.",
    },
  ];
}

/** Build the server entry for a target, shaped to that client's convention. */
export function buildServerEntry(creds: ServerEntryEnv, needsType = false): ServerEntry {
  const env: Record<string, string> = {};
  if (creds.HETZNER_CLOUD_TOKEN) env.HETZNER_CLOUD_TOKEN = creds.HETZNER_CLOUD_TOKEN;
  if (creds.HETZNER_ROBOT_USER) env.HETZNER_ROBOT_USER = creds.HETZNER_ROBOT_USER;
  if (creds.HETZNER_ROBOT_PASSWORD) env.HETZNER_ROBOT_PASSWORD = creds.HETZNER_ROBOT_PASSWORD;
  const entry: ServerEntry = { command: "npx", args: ["-y", "hetzner-mcp"], env };
  if (needsType) entry.type = "stdio";
  return entry;
}

/**
 * Merge a server entry into an existing config object without losing anything else.
 * Every other top-level key and every other server is preserved. Only the hetzner
 * entry under the client's server key is replaced. Returns a new object, never mutates.
 */
export function mergeServerIntoConfig(
  existing: unknown,
  entry: ServerEntry,
  configKey: "mcpServers" | "servers" = "mcpServers",
  serverName = "hetzner",
): Record<string, unknown> {
  const root: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const current = root[configKey];
  const servers: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  servers[serverName] = entry;
  root[configKey] = servers;
  return root;
}

/** True if a parsed config already has a hetzner server under the client's key. */
export function hasHetznerServer(
  existing: unknown,
  configKey: "mcpServers" | "servers" = "mcpServers",
  serverName = "hetzner",
): boolean {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const servers = (existing as Record<string, unknown>)[configKey];
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return false;
  return serverName in (servers as Record<string, unknown>);
}
