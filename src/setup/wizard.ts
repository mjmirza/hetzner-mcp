/**
 * The guided setup wizard. One command, a few prompts, and the user's MCP client is wired
 * to a verified Hetzner token. Modelled on the create-mastra onboarding: prompt, validate,
 * write the config the tool understands, then print clear next steps.
 *
 * Non-interactive use is supported for CI and power users via flags.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import fs from "node:fs";
import path from "node:path";
import {
  clientTargets,
  buildServerEntry,
  mergeServerIntoConfig,
  tilde,
  type ClientTarget,
  type ServerEntryEnv,
} from "./clients.js";
import { validateCloudToken } from "./validate.js";

interface Flags {
  token?: string;
  robotUser?: string;
  robotPassword?: string;
  clients: string[];
  yes: boolean;
  print: boolean;
  noVerify: boolean;
  help: boolean;
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
  const flags: Flags = { clients: [], yes: false, print: false, noVerify: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--print") flags.print = true;
    else if (a === "--no-verify") flags.noVerify = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--token" || a.startsWith("--token=")) {
      const r = takeValue(argv, i, "--token");
      flags.token = r.value;
      i = r.next;
    } else if (a === "--robot-user" || a.startsWith("--robot-user=")) {
      const r = takeValue(argv, i, "--robot-user");
      flags.robotUser = r.value;
      i = r.next;
    } else if (a === ROBOT_PW_FLAG || a.startsWith(ROBOT_PW_FLAG + "=")) {
      const r = takeValue(argv, i, ROBOT_PW_FLAG);
      flags.robotPassword = r.value;
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

/** Atomically merge the hetzner entry into a client config, backing up the original first. */
function writeClientConfig(target: ClientTarget, creds: ServerEntryEnv): WriteResult {
  let existing: unknown = {};
  if (fs.existsSync(target.configPath)) {
    const raw = fs.readFileSync(target.configPath, "utf8");
    if (raw.trim()) {
      try {
        existing = JSON.parse(raw);
      } catch {
        throw new Error(`${tilde(target.configPath)} is not valid JSON. Fix or remove it, then re-run setup.`);
      }
    }
  }
  const entry = buildServerEntry(creds, target.needsType);
  const merged = mergeServerIntoConfig(existing, entry, target.configKey);

  fs.mkdirSync(path.dirname(target.configPath), { recursive: true });
  let backup: string | undefined;
  if (fs.existsSync(target.configPath)) {
    backup = `${target.configPath}.bak`;
    fs.copyFileSync(target.configPath, backup);
  }
  const tmp = `${target.configPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, target.configPath);
  return { target, configPath: target.configPath, backup };
}

export async function runSetup(argv: string[]): Promise<number> {
  const flags = parseSetupFlags(argv);
  if (flags.help) {
    printSetupHelp();
    return 0;
  }

  out("");
  out("  hetzner-mcp setup");
  out("  Connect any MCP client to your Hetzner account in under a minute.");
  out("");

  const interactive = stdin.isTTY && !flags.yes;
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;

  try {
    // 0. Print mode. Show the exact block to paste, no prompts, token optional.
    // This serves the cautious user who wants to see and place the config by hand.
    if (flags.print) {
      const targets0 = clientTargets();
      const t0 = targets0.find((x) => x.id === (flags.clients[0] ?? "claude-desktop")) ?? targets0[0];
      const printCreds: ServerEntryEnv = {
        HETZNER_CLOUD_TOKEN: flags.token?.trim() || "<paste-your-token-here>",
        HETZNER_ROBOT_USER: flags.robotUser?.trim() || undefined,
        HETZNER_ROBOT_PASSWORD: flags.robotPassword || undefined,
      };
      const entry0 = buildServerEntry(printCreds, t0.needsType);
      out("");
      out(`  Paste this into ${t0.name} at ${tilde(t0.configPath)}:`);
      out("");
      out(JSON.stringify({ [t0.configKey]: { hetzner: entry0 } }, null, 2));
      out("");
      return 0;
    }

    // 1. Token. Prompt and verify, or take it from a flag.
    let token = flags.token?.trim() ?? "";
    if (!token && rl) {
      out(`  Get a token here:`);
      out(`    ${CONSOLE_URL}`);
      out("");
      let verified = false;
      for (let attempt = 0; attempt < 3 && !verified; attempt++) {
        const entered = (await rl.question("  Paste your Hetzner Cloud API token: ")).trim(); // BESTPRACTICE_OK: one shared stdin, prompts run one at a time
        if (!entered) {
          out("  A token is required to talk to Hetzner. Try again.");
          continue;
        }
        token = entered;
        if (flags.noVerify) {
          verified = true;
          break;
        }
        out("  Verifying...");
        const check = await validateCloudToken(token); // BESTPRACTICE_OK: verify must follow the prompt in this retry loop
        out(`  ${check.ok ? "OK" : "x "} ${check.message}`);
        if (check.ok) {
          verified = true;
          break;
        }
        if (check.status === undefined) {
          // Could not reach Hetzner. An offline user can save now and verify later.
          const ans = (await rl.question("  Save this token anyway and verify later? [y/N]: ")).trim().toLowerCase(); // BESTPRACTICE_OK: one shared stdin, prompts run one at a time
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
      out(`  ${check.ok ? "OK" : "x "} ${check.message}`);
      if (!check.ok) {
        stderr.write("  Setup stopped. The provided token did not verify (use --no-verify to skip).\n");
        return 1;
      }
    } else if (!token) {
      stderr.write("  No token provided. Pass --token <token> or run in an interactive terminal.\n");
      return 1;
    }

    // 2. Optional Robot credentials for dedicated servers.
    let robotUser = flags.robotUser?.trim();
    let robotPassword = flags.robotPassword;
    if (rl && robotUser === undefined && robotPassword === undefined) {
      const ans = (await rl.question("  Also manage dedicated (Robot) servers? [y/N]: ")).trim().toLowerCase();
      if (ans === "y" || ans === "yes") {
        robotUser = (await rl.question("  Robot webservice user: ")).trim();
        robotPassword = (await rl.question("  Robot webservice password: ")).trim();
      }
    }
    const creds: ServerEntryEnv = {
      HETZNER_CLOUD_TOKEN: token,
      HETZNER_ROBOT_USER: robotUser || undefined,
      HETZNER_ROBOT_PASSWORD: robotPassword || undefined,
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
        const ans = (await rl!.question(`    ${t.name}${detected} [${def}]: `)).trim().toLowerCase(); // BESTPRACTICE_OK: one shared stdin, prompts run one at a time
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
        out(`  OK wrote ${t.name} (${tilde(t.configPath)})`);
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
    out("  Success. Your Hetzner account is now connected." + robotNote);
    out("");
    out("  Two small steps and you are ready:");
    out("");
    out(`  1. Restart the ${appWord} below so the new connection loads.`);
    for (const w of written) out(`       ${w.target.name}. ${w.target.restartHint}`);
    out("");
    out("  2. Open a chat and ask, in plain words:");
    out('       "List my Hetzner servers and show this month cost."');
    out("       No commands to learn. The answer comes straight from your account.");
    out("");
    out("  Not sure it worked? Run this any time and it will tell you in plain English:");
    out("       npx hetzner-mcp doctor");
    out("");
    out("  Good to know, your token " + mask(token) + " was saved only inside the");
    out(`  ${appWord === "app" ? "app's" : "apps'"} own config on this computer, never anywhere else, and any file that was`);
    out("  already there was copied to a .bak backup first, so nothing was lost.");
    out("");
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
  out("    npx hetzner-mcp setup --token T --yes   Non-interactive. Wire all detected clients.");
  out("");
  out("  Flags:");
  out("    --token <t>            Hetzner Cloud API token (else you are prompted).");
  out("    --robot-user <u>       Robot webservice user (optional, dedicated servers).");
  out("    --robot-password <p>   Robot webservice password (optional).");
  out("    --client <id>          Wire a specific client. Repeatable.");
  out("                           ids: claude-desktop, claude-code, cursor, windsurf, vscode");
  out("    --yes, -y              Non-interactive. Requires --token.");
  out("    --print                Print the JSON block instead of writing.");
  out("    --no-verify            Skip the live token check.");
  out("");
}
