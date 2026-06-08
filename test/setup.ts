/**
 * Offline unit checks for the setup and doctor commands. No network, no real files.
 * fetch is stubbed so token verification is tested without touching Hetzner.
 */
import {
  clientTargets,
  buildServerEntry,
  mergeServerIntoConfig,
  hasHetznerServer,
  tilde,
} from "../src/setup/clients.js";
import { parseSetupFlags } from "../src/setup/wizard.js";
import { validateCloudToken } from "../src/setup/validate.js";

let passed = 0;
let total = 0;

function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

function stubFetch(status: number): typeof fetch {
  return (async () => ({ status }) as Response) as unknown as typeof fetch;
}

function stubFetchThrow(name: string): typeof fetch {
  return (async () => {
    const e = new Error("boom");
    e.name = name;
    throw e;
  }) as unknown as typeof fetch;
}

async function main(): Promise<void> {
  // mergeServerIntoConfig preserves everything else.
  const existing = {
    other: { keep: true },
    mcpServers: { keep: { command: "x", args: [], env: {} }, hetzner: { command: "old", args: [], env: {} } },
  };
  const entry = buildServerEntry({ HETZNER_CLOUD_TOKEN: "tok" });
  const merged = mergeServerIntoConfig(existing, entry, "mcpServers");
  assert("merge keeps unrelated top-level keys", (merged.other as { keep: boolean }).keep === true);
  const mServers = merged.mcpServers as Record<string, unknown>;
  assert("merge keeps other servers", "keep" in mServers);
  assert("merge replaces hetzner entry", (mServers.hetzner as { command: string }).command === "npx");
  assert("merge does not mutate input", (existing.mcpServers.hetzner as { command: string }).command === "old");

  // merge into garbage / empty.
  const fromEmpty = mergeServerIntoConfig(undefined, entry, "mcpServers");
  assert("merge builds structure from undefined", "hetzner" in (fromEmpty.mcpServers as Record<string, unknown>));
  const fromGarbage = mergeServerIntoConfig("not-json" as unknown, entry, "servers");
  assert("merge uses servers key for vscode", "hetzner" in (fromGarbage.servers as Record<string, unknown>));

  // buildServerEntry shape.
  const e1 = buildServerEntry({ HETZNER_CLOUD_TOKEN: "t" });
  assert("entry command is npx", e1.command === "npx");
  assert("entry args use -y package", e1.args.join(" ") === "-y hetzner-mcp");
  assert("entry omits empty robot creds", !("HETZNER_ROBOT_USER" in e1.env));
  assert("entry omits type by default", e1.type === undefined);
  const e2 = buildServerEntry({ HETZNER_CLOUD_TOKEN: "t", HETZNER_ROBOT_USER: "u", HETZNER_ROBOT_PASSWORD: "p" }, true);
  assert("entry includes robot creds when present", e2.env.HETZNER_ROBOT_USER === "u" && e2.env.HETZNER_ROBOT_PASSWORD === "p");
  assert("entry adds stdio type when needed", e2.type === "stdio");

  // clientTargets per platform.
  const darwin = clientTargets("darwin", "/Users/x", "/proj", {});
  assert("five client targets", darwin.length === 5);
  const ids = darwin.map((t) => t.id).join(",");
  assert("target ids present", ids === "claude-desktop,claude-code,cursor,windsurf,vscode");
  const desktop = darwin.find((t) => t.id === "claude-desktop");
  assert("darwin desktop path", desktop?.configPath === "/Users/x/Library/Application Support/Claude/claude_desktop_config.json");
  const code = darwin.find((t) => t.id === "claude-code");
  assert("claude code path", code?.configPath === "/Users/x/.claude.json");
  const vscode = darwin.find((t) => t.id === "vscode");
  assert("vscode uses project cwd", vscode?.configPath === "/proj/.vscode/mcp.json");
  assert("vscode uses servers key", vscode?.configKey === "servers" && vscode?.needsType === true);
  const win = clientTargets("win32", "C:\\Users\\x", "C:\\proj", { APPDATA: "C:\\Users\\x\\AppData\\Roaming" });
  const winDesktop = win.find((t) => t.id === "claude-desktop");
  assert("win32 desktop uses APPDATA", (winDesktop?.configPath ?? "").includes("AppData\\Roaming"));
  const linux = clientTargets("linux", "/home/x", "/proj", {});
  const linDesktop = linux.find((t) => t.id === "claude-desktop");
  assert("linux desktop under .config", linDesktop?.configPath === "/home/x/.config/Claude/claude_desktop_config.json");

  // tilde collapse.
  assert("tilde collapses home", tilde("/Users/x/.claude.json", "/Users/x") === "~/.claude.json");
  assert("tilde leaves other paths", tilde("/etc/hosts", "/Users/x") === "/etc/hosts");

  // hasHetznerServer.
  assert("detects wired hetzner", hasHetznerServer({ mcpServers: { hetzner: {} } }, "mcpServers") === true);
  assert("detects not wired", hasHetznerServer({ mcpServers: { other: {} } }, "mcpServers") === false);
  assert("detects vscode servers key", hasHetznerServer({ servers: { hetzner: {} } }, "servers") === true);
  assert("garbage is not wired", hasHetznerServer("nope" as unknown, "mcpServers") === false);

  // parseSetupFlags.
  const f = parseSetupFlags(["--token", "abc", "--yes", "--client", "cursor", "--client=vscode", "--no-verify", "--print"]);
  assert("flag token parsed", f.token === "abc");
  assert("flag yes parsed", f.yes === true);
  assert("flag clients repeatable", f.clients.join(",") === "cursor,vscode");
  assert("flag no-verify parsed", f.noVerify === true);
  assert("flag print parsed", f.print === true);
  const f2 = parseSetupFlags(["--token=xyz"]);
  assert("flag token equals form", f2.token === "xyz");

  // validateCloudToken with stubbed fetch (no network).
  const ok = await validateCloudToken("tok", stubFetch(200));
  assert("token 200 is ok", ok.ok === true && ok.status === 200);
  const unauthorized = await validateCloudToken("bad", stubFetch(401));
  assert("token 401 not ok", unauthorized.ok === false && unauthorized.status === 401);
  const forbidden = await validateCloudToken("bad", stubFetch(403));
  assert("token 403 not ok", forbidden.ok === false && forbidden.status === 403);
  const five = await validateCloudToken("tok", stubFetch(500));
  assert("token 500 not ok", five.ok === false && five.status === 500);
  const empty = await validateCloudToken("   ", stubFetch(200));
  assert("empty token not ok", empty.ok === false);
  const timedOut = await validateCloudToken("tok", stubFetchThrow("AbortError"));
  assert("timeout not ok and explained", timedOut.ok === false && timedOut.message.includes("timed out"));
  const netErr = await validateCloudToken("tok", stubFetchThrow("TypeError"));
  assert("network error not ok", netErr.ok === false && netErr.message.includes("Could not reach"));

  process.stdout.write(`\n${passed}/${total} checks passed\n`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`setup test failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
