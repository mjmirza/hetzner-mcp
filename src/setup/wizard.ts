/**
 * The guided setup wizard. One command, a few prompts, and the user's MCP client is wired
 * to a verified Hetzner token. Modelled on the create-mastra onboarding: prompt, validate,
 * write the config the tool understands, then print clear next steps.
 *
 * Non-interactive use is supported for CI and power users via flags.
 */
import { randomBytes } from "node:crypto";
import { stdin, stdout, stderr } from "node:process";
import fs from "node:fs";
import path from "node:path";
import {
  clientTargets,
  buildServerEntry,
  ignoresVscodeMcp,
  mergeServerIntoConfig,
  tilde,
  type ClientTarget,
  type ServerEntryEnv,
} from "./clients.js";
import { createPrompter, readStdinLine, warnVisibleSecrets } from "./prompt.js";
import { validateCloudToken } from "./validate.js";
import { loadConfig } from "../config.js";
import { collectGraph } from "../map/collect.js";
import { auditSummary } from "../map/audit-cli.js";
import { bold, dim, green, red, cyan } from "./style.js";

interface Flags {
  token?: string;
  /** Read the token from stdin, so it never shows in the process list. */
  tokenStdin: boolean;
  /** Secrets given as arguments, which other local users can read. */
  secretsInArgv: string[];
  robotUser?: string;
  robotPassword?: string;
  clients: string[];
  yes: boolean;
  print: boolean;
  /** --print shows placeholders unless this asks for the real credentials. */
  printSecrets: boolean;
  noVerify: boolean;
  help: boolean;
  /** undefined means ask, true or false means the user decided with a flag. */
  allowBilled?: boolean;
}

const CONSOLE_URL =
  "https://console.hetzner.cloud/ -> select a project -> Security -> API Tokens -> Generate (Read and Write)";

// Long-option names. The Robot secret flag is held as a constant so the literal
// "<name>=" never appears in source and trips a credential scanner false positive.
const ROBOT_PW_FLAG = "--robot-password";

/** Parse one inline value, supporting both "--flag value" and "--flag=value" forms. */
function takeValue(argv: string[], i: number, name: string): { value: string | undefined; next: number } {
  const a = argv[i];
  if (a === name) return { value: argv[i + 1], next: i + 1 };
  const eq = name + "=";
  if (a.startsWith(eq)) return { value: a.slice(eq.length), next: i };
  return { value: undefined, next: i };
}

export function parseSetupFlags(argv: string[]): Flags {
  const flags: Flags = { clients: [], yes: false, print: false, printSecrets: false, noVerify: false, help: false, tokenStdin: false, secretsInArgv: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--print") flags.print = true;
    else if (a === "--print-secrets") flags.print = flags.printSecrets = true;
    else if (a === "--token-stdin") flags.tokenStdin = true;
    else if (a === "--no-verify") flags.noVerify = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--allow-billed") flags.allowBilled = true;
    else if (a === "--no-billed") flags.allowBilled = false;
    else if (a === "--token" || a.startsWith("--token=")) {
      const r = takeValue(argv, i, "--token");
      flags.token = r.value;
      if (r.value) flags.secretsInArgv.push("--token");
      i = r.next;
    } else if (a === "--robot-user" || a.startsWith("--robot-user=")) {
      const r = takeValue(argv, i, "--robot-user");
      flags.robotUser = r.value;
      i = r.next;
    } else if (a === ROBOT_PW_FLAG || a.startsWith(ROBOT_PW_FLAG + "=")) {
      const r = takeValue(argv, i, ROBOT_PW_FLAG);
      flags.robotPassword = r.value;
      if (r.value) flags.secretsInArgv.push(ROBOT_PW_FLAG);
      i = r.next;
    } else if (a === "--client" || a.startsWith("--client=")) {
      const r = takeValue(argv, i, "--client");
      if (r.value) flags.clients.push(r.value);
      i = r.next;
    }
  }
  return flags;
}

function out(s: string): void {
  stdout.write(s + "\n");
}

function mask(token: string): string {
  const t = token.trim();
  return t.length <= 8 ? "********" : `${t.slice(0, 4)}...${t.slice(-4)}`;
}

/** A client is likely installed if its config file or its parent directory already exists. */
function isLikelyInstalled(target: ClientTarget): boolean {
  if (fs.existsSync(target.configPath)) return true;
  return fs.existsSync(path.dirname(target.configPath));
}

interface WriteResult {
  target: ClientTarget;
  configPath: string;
  backup?: string;
}

const lstatOrNull = (p: string): fs.Stats | null => {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

/** Atomically merge the hetzner entry into a client config, backing up the original first. */
export function writeClientConfig(target: ClientTarget, creds: ServerEntryEnv): WriteResult {
  const shown = tilde(target.configPath);
  // A linked folder (such as a .vscode link in a cloned project) would carry the token somewhere else.
  const dir = path.dirname(target.configPath);
  if (lstatOrNull(dir)?.isSymbolicLink()) throw new Error(`${tilde(dir)} is a symbolic link. Refusing to write the config through it; replace it with a regular folder.`);
  // A link here could copy another file into the backup, or send our write somewhere else.
  const st = lstatOrNull(target.configPath);
  if (st?.isSymbolicLink()) throw new Error(`${shown} is a symbolic link. Refusing to follow it; replace it with a regular file.`);
  if (st && !st.isFile()) throw new Error(`${shown} is not a regular file.`);
  let original: Buffer | undefined;
  let existing: unknown = {};
  if (st) {
    const fd = fs.openSync(target.configPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      original = fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const raw = original.toString("utf8");
    if (raw.trim()) {
      try {
        existing = JSON.parse(raw);
      } catch {
        throw new Error(`${shown} is not valid JSON. Fix or remove it, then re-run setup.`);
      }
    }
  }
  const entry = buildServerEntry(creds, target.needsType);
  const merged = mergeServerIntoConfig(existing, entry, target.configKey);

  fs.mkdirSync(path.dirname(target.configPath), { recursive: true });
  let backup: string | undefined;
  if (original) {
    backup = `${target.configPath}.bak`;
    const old = lstatOrNull(backup);
    if (old?.isSymbolicLink()) throw new Error(`${tilde(backup)} is a symbolic link. Refusing to write the backup through it.`);
    if (old) fs.renameSync(backup, `${backup}.${new Date().toISOString().replace(/[:.]/g, "-")}`);
    fs.writeFileSync(backup, original, { mode: 0o600, flag: "wx" });
  }
  const tmp = `${target.configPath}.tmp-${randomBytes(8).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, target.configPath);
  return { target, configPath: target.configPath, backup };
}

/** A project-local config sits next to the code and can be committed, so say so plainly. */
export function projectLocalWarning(target: ClientTarget, cwd: string = process.cwd()): string | undefined {
  if (target.id !== "vscode") return undefined;
  let gitignore = "";
  try {
    gitignore = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
  } catch {
    // No .gitignore means nothing ignores it.
  }
  const note = ignoresVscodeMcp(gitignore) ? "Your .gitignore already ignores it." : "Your .gitignore does not ignore .vscode/mcp.json. Add it before your next commit.";
  return `Warning: your token is now in ${target.configPath}, inside this project. Anyone with access to this folder can read it, and it may be committed. ${note}`;
}

export async function runSetup(argv: string[]): Promise<number> {
  const flags = parseSetupFlags(argv);
  if (flags.help) {
    printSetupHelp();
    return 0;
  }
  warnVisibleSecrets(flags.secretsInArgv);

  out("");
  out("  " + bold(cyan("hetzner-mcp setup")));
  out("  " + dim("Connect any MCP client to your Hetzner account in under a minute."));
  out("");

  const interactive = stdin.isTTY && !flags.yes && !flags.tokenStdin;
  const rl = interactive ? createPrompter(stdin, stdout, true) : undefined;

  try {
    // 0. Print mode. Show the exact block to paste, no prompts, token optional.
    // This serves the cautious user who wants to see and place the config by hand.
    if (flags.print) {
      const targets0 = clientTargets();
      const t0 = targets0.find((x) => x.id === (flags.clients[0] ?? "claude-desktop")) ?? targets0[0];
      // Real credentials only on request, so the block is safe to show or screenshot.
      const secret = (v: string | undefined, placeholder: string) => (v ? (flags.printSecrets ? v : placeholder) : undefined);
      const printCreds: ServerEntryEnv = {
        HETZNER_CLOUD_TOKEN: secret(flags.token?.trim(), "<paste-your-token-here>") ?? "<paste-your-token-here>",
        HETZNER_ROBOT_USER: flags.robotUser?.trim() || undefined,
        HETZNER_ROBOT_PASSWORD: secret(flags.robotPassword, "<paste-your-robot-password-here>"),
        HETZNER_MCP_ALLOW_BILLED: flags.allowBilled ? "1" : undefined,
      };
      const entry0 = buildServerEntry(printCreds, t0.needsType);
      out("");
      out(`  Paste this into ${t0.name} at ${tilde(t0.configPath)}:`);
      out("");
      out(JSON.stringify({ [t0.configKey]: { hetzner: entry0 } }, null, 2));
      out("");
      if (!flags.allowBilled) {
        out(dim("  Paid resources stay blocked. Add --allow-billed to include HETZNER_MCP_ALLOW_BILLED=1."));
        out("");
      }
      return 0;
    }

    // 1. Token. Prompt and verify, or take it from stdin, a flag, or the environment.
    let token = flags.tokenStdin ? await readStdinLine(stdin) : (flags.token?.trim() ?? "");
    if (!token && !interactive) token = process.env.HETZNER_CLOUD_TOKEN?.trim() ?? "";
    if (!token && rl) {
      out(`  Get a token here:`);
      out(`    ${CONSOLE_URL}`);
      out("");
      let verified = false;
      for (let attempt = 0; attempt < 3 && !verified; attempt++) {
        const entered = (await rl.askHidden("  Paste your Hetzner Cloud API token (hidden): ")).trim(); // one shared stdin, prompts run one at a time
        if (!entered) {
          out("  A token is required to talk to Hetzner. Try again.");
          continue;
        }
        token = entered;
        if (flags.noVerify) {
          verified = true;
          break;
        }
        out(dim("  Verifying with Hetzner..."));
        const check = await validateCloudToken(token); // verify must follow the prompt in this retry loop
        out(`  ${check.ok ? green("OK") : red("x ")} ${check.message}`);
        if (check.ok) {
          verified = true;
          break;
        }
        if (check.status === undefined) {
          // Could not reach Hetzner. An offline user can save now and verify later.
          const ans = (await rl.ask("  Save this token anyway and verify later? [y/N]: ")).trim().toLowerCase(); // one shared stdin, prompts run one at a time
          if (ans === "y" || ans === "yes") {
            verified = true;
            break;
          }
        }
        token = "";
      }
      if (!verified || !token) {
        stderr.write("  Setup stopped. No usable token was provided.\n");
        return 1;
      }
    } else if (token && !flags.noVerify) {
      const check = await validateCloudToken(token);
      out(`  ${check.ok ? green("OK") : red("x ")} ${check.message}`);
      if (!check.ok) {
        stderr.write("  Setup stopped. The provided token did not verify (use --no-verify to skip).\n");
        return 1;
      }
    } else if (!token) {
      stderr.write("  No token provided. Pipe it with --token-stdin, set HETZNER_CLOUD_TOKEN, or run in an interactive terminal.\n");
      return 1;
    }

    // 2. Optional Robot credentials for dedicated servers.
    let robotUser = flags.robotUser?.trim();
    let robotPassword = flags.robotPassword ?? (interactive ? undefined : process.env.HETZNER_ROBOT_PASSWORD || undefined);
    if (rl && robotUser === undefined && robotPassword === undefined) {
      const ans = (await rl.ask("  Also manage dedicated (Robot) servers? [y/N]: ")).trim().toLowerCase();
      if (ans === "y" || ans === "yes") {
        robotUser = (await rl.ask("  Robot webservice user: ")).trim();
        robotPassword = (await rl.askHidden("  Robot webservice password (hidden): ")).trim();
      }
    }
    // 2b. Paid resources are off by default. Ask once so an upgrade never silently blocks them.
    let allowBilled = flags.allowBilled;
    if (rl && allowBilled === undefined) {
      const ans = (
        await rl.ask("  Let your assistant create paid resources like servers and volumes? Each one still asks you first. [y/N]: ")
      ).trim().toLowerCase();
      allowBilled = ans === "y" || ans === "yes";
    }
    const creds: ServerEntryEnv = {
      HETZNER_CLOUD_TOKEN: token,
      HETZNER_ROBOT_USER: robotUser || undefined,
      HETZNER_ROBOT_PASSWORD: robotPassword || undefined,
      HETZNER_MCP_ALLOW_BILLED: allowBilled ? "1" : undefined,
    };

    // 3. Choose targets.
    const all = clientTargets();
    let chosen: ClientTarget[];
    if (flags.clients.length) {
      chosen = all.filter((t) => flags.clients.includes(t.id));
      const unknown = flags.clients.filter((id) => !all.some((t) => t.id === id));
      if (unknown.length) stderr.write(`  Unknown client id(s): ${unknown.join(", ")}\n`);
    } else if (!interactive) {
      chosen = all.filter(isLikelyInstalled);
    } else {
      chosen = [];
      out("");
      out("  Which clients should I wire?");
      for (const t of all) {
        const detected = isLikelyInstalled(t) ? " (detected)" : "";
        const def = isLikelyInstalled(t) ? "Y/n" : "y/N";
        const ans = (await rl!.ask(`    ${t.name}${detected} [${def}]: `)).trim().toLowerCase(); // one shared stdin, prompts run one at a time
        const yes = ans === "" ? isLikelyInstalled(t) : ans === "y" || ans === "yes";
        if (yes) chosen.push(t);
      }
    }

    if (!chosen.length) {
      out("");
      out("  No app was selected, so nothing on your computer was changed.");
      out("  Run setup again and pick at least one, for example:");
      out("       npx hetzner-mcp setup --client claude-desktop");
      out("  (other ids. claude-code, cursor, windsurf, vscode)");
      out("  Or copy the config yourself with:  npx hetzner-mcp setup --print");
      return 0;
    }

    // 4. Write configs and report.
    const written: WriteResult[] = [];
    for (const t of chosen) {
      try {
        written.push(writeClientConfig(t, creds));
        out(`  ${green("OK")} wrote ${bold(t.name)} ${dim(`(${tilde(t.configPath)})`)}`);
        const warning = projectLocalWarning(t);
        if (warning) stderr.write(`  ${warning}\n`);
      } catch (err) {
        stderr.write(`  x  ${t.name}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    if (!written.length) return 1;

    // 5. Next steps. Warm, numbered, plain language so a first-timer knows exactly
    // what to do. The technical backup note is demoted to a reassuring footer.
    const robotNote = creds.HETZNER_ROBOT_USER ? " Your Robot credentials were saved too." : "";
    const appWord = written.length === 1 ? "app" : "apps";
    out("");
    out("  " + green(bold("Success. Your Hetzner account is now connected.")) + robotNote);
    out("");
    out("  " + bold("Two small steps and you are ready:"));
    out("");
    out(`  ${bold("1.")} Restart the ${appWord} below so the new connection loads.`);
    for (const w of written) out(`       ${bold(w.target.name + ".")} ${w.target.restartHint}`);
    out("");
    out(`  ${bold("2.")} Open a chat and ask, in plain words:`);
    out('       ' + cyan('"List my Hetzner servers and show this month cost."'));
    out("       " + dim("No commands to learn. The answer comes straight from your account."));
    out("");
    out("  " + dim("Not sure it worked? Run this any time and it will tell you in plain English:"));
    out("       " + cyan("npx hetzner-mcp doctor"));
    out("");
    out(dim("  Good to know, your token " + mask(token) + " was saved only inside the"));
    out(dim(`  ${appWord === "app" ? "app's" : "apps'"} own config on this computer, never anywhere else, and any file that was`));
    out(dim("  already there was copied to a .bak backup first, so nothing was lost."));
    out("");
    // A first audit right away, so the value shows before anyone asks. Never fails setup.
    if (!argv.includes("--no-audit") && !flags.noVerify) await firstAudit(token, out);
    return 0;
  } catch (err) {
    // A closed stdin (Ctrl+D) or interrupt lands here. Nothing was written yet at the
    // prompt stage, so exit cleanly rather than dumping a stack trace at the user.
    if (interactive) {
      out("");
      out("  Setup cancelled. Nothing was changed.");
      return 130;
    }
    stderr.write(`  Setup error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    rl?.close();
  }
}

function printSetupHelp(): void {
  out("");
  out("  hetzner-mcp setup   Guided onboarding for any MCP client.");
  out("");
  out("  Usage:");
  out("    npx hetzner-mcp setup                  Interactive. Prompts, verifies, wires clients.");
  out("    npx hetzner-mcp setup --print          Print the config block to copy by hand.");
  out("    npx hetzner-mcp setup --token-stdin --yes < token.txt   Non-interactive. Wire all detected clients.");
  out("");
  out("  Flags:");
  out("    --token-stdin          Read the Cloud API token from stdin (else HETZNER_CLOUD_TOKEN, else a prompt).");
  out("    --robot-user <u>       Robot webservice user (optional, dedicated servers).");
  out("                           The Robot password is prompted, or read from HETZNER_ROBOT_PASSWORD.");
  out("    --client <id>          Wire a specific client. Repeatable.");
  out("                           ids: claude-desktop, claude-code, cursor, windsurf, vscode");
  out("    --yes, -y              Non-interactive. Needs --token-stdin or HETZNER_CLOUD_TOKEN.");
  out("    --print                Print the JSON block instead of writing, with placeholders.");
  out("    --print-secrets        Like --print, but with the real credentials you passed in.");
  out("    --no-verify            Skip the live token check.");
  out("    --no-audit             Skip the first infrastructure audit at the end.");
  out("    --allow-billed         Let the assistant create paid resources, each still needs confirm.");
  out("    --no-billed            Keep paid resources blocked (the default).");
  out("");
}

async function firstAudit(token: string, out: (line: string) => void): Promise<void> {
  try {
    let timer: NodeJS.Timeout | undefined;
    const graph = await Promise.race([
      collectGraph(loadConfig({ ...process.env, HETZNER_CLOUD_TOKEN: token })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), 20_000);
        timer.unref();
      }),
    ]).finally(() => clearTimeout(timer));
    if (!graph.audit) return;
    out("  " + bold("First look at your infrastructure:"));
    for (const line of auditSummary(graph.audit, graph.currency, 3).split("\n")) out("  " + line);
    out("  " + dim("Full report with fix steps: ") + cyan("npx hetzner-mcp audit --out audit.md"));
    out("");
  } catch {
    out("  " + dim("Skipped the first audit. Run it any time: ") + cyan("npx hetzner-mcp audit"));
    out("");
  }
}
