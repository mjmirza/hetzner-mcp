/**
 * Offline unit checks for the setup and doctor commands. No network, no real files.
 * fetch is stubbed so token verification is tested without touching Hetzner.
 */
import {
  clientTargets,
  buildServerEntry,
  mergeServerIntoConfig,
  hasHetznerServer,
  ignoresVscodeMcp,
  launcherFor,
  tilde,
} from "../src/setup/clients.js";
import { parseSetupFlags, projectLocalWarning, writeClientConfig } from "../src/setup/wizard.js";
import { createPrompter } from "../src/setup/prompt.js";
import { VERSION } from "../src/version.js";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { PassThrough, Writable } from "node:stream";
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
  assert("from source the entry falls back to npx", e1.command === "npx");
  assert("the npx fallback pins this exact version", e1.args.join(" ") === `-y hetzner-mcp@${VERSION}`);

  // An installed copy is launched by absolute path, so a project's node_modules is never run.
  const installed = launcherFor("/usr/local/lib/node_modules/hetzner-mcp/dist/index.js", "/usr/local/bin/node", "1.2.3");
  assert("an installed copy is launched by absolute node and entry paths", installed.command === "/usr/local/bin/node" && installed.args.join() === "/usr/local/lib/node_modules/hetzner-mcp/dist/index.js");
  const cached = launcherFor("/Users/x/.npm/_npx/abc/node_modules/hetzner-mcp/dist/index.js", "/usr/local/bin/node", "1.2.3");
  assert("a copy in the npx cache pins the exact version instead", cached.command === "npx" && cached.args.join(" ") === "-y hetzner-mcp@1.2.3");
  const winEntry = win32.join("C:", "Users", "x", "AppData", "Local", "npm-cache", "_npx", "abc", "node_modules", "hetzner-mcp", "dist", "index.js");
  assert("the npx cache is recognised on Windows paths too", launcherFor(winEntry, "node.exe", "1.2.3").command === "npx");
  const e3 = buildServerEntry({ HETZNER_CLOUD_TOKEN: "t" }, false, installed);
  assert("the entry uses the given launcher and never a bare package name", e3.command === "/usr/local/bin/node" && !e3.args.includes("hetzner-mcp"));

  // A VS Code config lives inside the project, so the wizard checks .gitignore before warning.
  assert(".vscode/ in .gitignore is recognised", ignoresVscodeMcp("node_modules\n.vscode/\n"));
  assert("the exact file in .gitignore is recognised", ignoresVscodeMcp("/.vscode/mcp.json"));
  assert("an empty .gitignore does not ignore it", !ignoresVscodeMcp(""));
  assert("a later negation re-includes it", !ignoresVscodeMcp(".vscode/\n!.vscode/mcp.json\n"));
  const vsTarget = clientTargets("darwin", "/Users/x", mkdtempSync(join(tmpdir(), "hz-vs-")), {}).find((t) => t.id === "vscode")!;
  const vsWarn = projectLocalWarning(vsTarget, dirname(dirname(vsTarget.configPath))) ?? "";
  assert("writing the VS Code config warns and names the file", vsWarn.includes(vsTarget.configPath) && /committed/.test(vsWarn) && /does not ignore/.test(vsWarn));
  assert("user-level clients get no project warning", projectLocalWarning(clientTargets()[0]!) === undefined);

  // Config writes never follow links, and the backup never overwrites anything.
  const dir = mkdtempSync(join(tmpdir(), "hz-cfg-"));
  const victim = join(dir, "victim.json");
  writeFileSync(victim, '{"secret":"keep"}');
  const target = (configPath: string) => ({ ...clientTargets()[2]!, configPath });
  const linked = join(dir, "linked.json");
  symlinkSync(victim, linked);
  let refused = "";
  try {
    writeClientConfig(target(linked), { HETZNER_CLOUD_TOKEN: "t" });
  } catch (e) {
    refused = String(e);
  }
  assert("a symlinked client config is refused", /symbolic link/.test(refused) && !existsSync(`${linked}.bak`) && readFileSync(victim, "utf8") === '{"secret":"keep"}');
  const real = join(dir, "real.json");
  writeFileSync(real, '{"mcpServers":{}}');
  symlinkSync(victim, `${real}.bak`);
  refused = "";
  try {
    writeClientConfig(target(real), { HETZNER_CLOUD_TOKEN: "t" });
  } catch (e) {
    refused = String(e);
  }
  assert("a symlinked backup path is refused and its target is untouched", /symbolic link/.test(refused) && readFileSync(victim, "utf8") === '{"secret":"keep"}' && readFileSync(real, "utf8") === '{"mcpServers":{}}');
  // A linked config folder, such as a .vscode link in a cloned project, is refused.
  const project = mkdtempSync(join(tmpdir(), "hz-proj-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "hz-elsewhere-"));
  symlinkSync(elsewhere, join(project, ".vscode"));
  const vsLinked = clientTargets(process.platform, project, project).find((t) => t.id === "vscode")!;
  refused = "";
  try {
    writeClientConfig(vsLinked, { HETZNER_CLOUD_TOKEN: "t" });
  } catch (e) {
    refused = String(e);
  }
  assert("a symlinked .vscode folder is refused and nothing is written through it", /symbolic link/.test(refused) && readdirSync(elsewhere).length === 0);
  // A home-level app folder kept as a link by a dotfile manager still gets its config.
  const home = mkdtempSync(join(tmpdir(), "hz-home-"));
  const dotfiles = mkdtempSync(join(tmpdir(), "hz-dotfiles-"));
  symlinkSync(dotfiles, join(home, ".cursor"));
  const cursorLinked = clientTargets(process.platform, home, project).find((t) => t.id === "cursor")!;
  writeClientConfig(cursorLinked, { HETZNER_CLOUD_TOKEN: "t" });
  assert("a symlinked home app folder still gets its config", readdirSync(dotfiles).includes("mcp.json"));
  rmSync(`${real}.bak`);
  writeFileSync(`${real}.bak`, "older backup");
  const res = writeClientConfig(target(real), { HETZNER_CLOUD_TOKEN: "t" });
  const kept = readdirSync(dir).filter((f) => f.startsWith("real.json.bak."));
  assert("an existing backup is kept under a timestamped name", kept.length === 1 && readFileSync(join(dir, kept[0]!), "utf8") === "older backup");
  assert("the new backup holds the original and is owner-only", readFileSync(res.backup!, "utf8") === '{"mcpServers":{}}' && (statSync(res.backup!).mode & 0o777) === 0o600);
  assert("no temp file is left behind", !readdirSync(dir).some((f) => f.includes(".tmp-")));

  // A hidden prompt returns the answer without ever echoing it.
  const input = new PassThrough();
  let shown = "";
  const output = new Writable({ write(c, _e, done) { shown += String(c); done(); } });
  const pr = createPrompter(input, output, true);
  const answer = pr.askHidden("Token: ");
  input.write("s3cretTOKENvalue\r");
  const got = await answer;
  pr.close();
  assert("a hidden prompt returns what was typed", got === "s3cretTOKENvalue");
  assert("a hidden prompt never echoes the secret", shown.includes("Token: ") && !shown.includes("s3cret"));

  const fs1 = parseSetupFlags(["--token-stdin", "--print-secrets"]);
  assert("--token-stdin and --print-secrets are parsed", fs1.tokenStdin && fs1.printSecrets && fs1.print && fs1.secretsInArgv.length === 0);
  assert("secrets given as arguments are noted for a warning", parseSetupFlags(["--token", "abc"]).secretsInArgv.join() === "--token");
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
  const fb = parseSetupFlags(["--allow-billed"]);
assert("--allow-billed sets allowBilled", fb.allowBilled === true);
assert("--no-billed clears allowBilled", parseSetupFlags(["--no-billed"]).allowBilled === false);
assert("no billed flag leaves it undecided", parseSetupFlags([]).allowBilled === undefined);
assert("entry carries ALLOW_BILLED=1 when allowed", buildServerEntry({ HETZNER_CLOUD_TOKEN: "t", HETZNER_MCP_ALLOW_BILLED: "1" }).env.HETZNER_MCP_ALLOW_BILLED === "1");
assert("entry omits ALLOW_BILLED when not allowed", !("HETZNER_MCP_ALLOW_BILLED" in buildServerEntry({ HETZNER_CLOUD_TOKEN: "t" }).env));
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
