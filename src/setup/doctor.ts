/**
 * The doctor command. A read-only console companion that answers, at a glance,
 * is my token good, what can I do, and which clients are wired. It writes nothing.
 * This is the verify step that backs every claim the setup wizard makes.
 */
import { stdout } from "node:process";
import { loadConfig, availableSurfaces } from "../config.js";
import { clientTargets, readWiredCredentials, tilde, type ClientTarget } from "./clients.js";
import { validateCloudToken, CONSOLE_URL, type TokenCheck } from "./validate.js";
import { bold, dim, green, red, cyan } from "./style.js";
import { readStdinLine, warnVisibleSecrets } from "./prompt.js";

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

/** One connected app and what Hetzner said about the token saved in it. */
export interface AppCheck {
  target: ClientTarget;
  /** Absent when the app has no Cloud token saved. */
  check?: TokenCheck;
}

/**
 * Checks the token saved in each connected app against Hetzner. Each distinct token is sent once,
 * with one free read request. The token itself is never returned or printed.
 */
export async function checkConnectedApps(targets: ClientTarget[] = clientTargets(), fetchImpl: typeof fetch = fetch): Promise<AppCheck[]> {
  const byToken = new Map<string, Promise<TokenCheck>>();
  return Promise.all(
    readWiredCredentials(targets).map(async (w) => {
      if (!w.token) return { target: w.target };
      if (!byToken.has(w.token)) byToken.set(w.token, validateCloudToken(w.token, fetchImpl));
      return { target: w.target, check: await byToken.get(w.token)! };
    }),
  );
}

/** The one line that says what to do next, from the app checks. Kept separate so it can be tested. */
export function doctorVerdict(apps: AppCheck[]): { ok: boolean; line: string } {
  if (!apps.length) return { ok: false, line: "No app is connected yet. Set one up in one command: npx hetzner-mcp setup" };
  const rejected = apps.filter((a) => a.check && !a.check.ok && a.check.status !== undefined);
  const missing = apps.filter((a) => !a.check);
  const unreached = apps.filter((a) => a.check && a.check.status === undefined);
  if (rejected.length || missing.length) {
    const names = [...rejected, ...missing].map((a) => a.target.name).join(", ");
    return { ok: false, line: `The token saved in ${names} does not work. Make a new one at ${CONSOLE_URL}, then run: npx hetzner-mcp setup` };
  }
  if (unreached.length) return { ok: false, line: "Could not reach Hetzner to check your token. Check your internet connection and run doctor again." };
  const n = apps.length;
  return { ok: true, line: `All good. ${n} app${n === 1 ? "" : "s"} connected, and Hetzner accepts the token.` };
}

export async function runDoctor(argv: string[]): Promise<number> {
  const cfg = loadConfig();
  const fromArgv = flagToken(argv)?.trim();
  if (fromArgv) warnVisibleSecrets(["--token"]);
  out("");
  out("  " + bold(cyan("hetzner-mcp doctor")));
  out("  " + dim("A read-only health check. It looks, and changes nothing."));
  out("");

  // A token given here, or set in this terminal, is checked on its own.
  const token = (argv.includes("--token-stdin") ? await readStdinLine() : fromArgv) || cfg.cloudToken;
  if (token) {
    out(dim("  Checking the token from this terminal with Hetzner..."));
    const check = await validateCloudToken(token);
    out(`  ${check.ok ? green("OK ") : red("x  ")}${bold("Token")}. ${check.message}`);
  } else if (cfg.cloudTokenError) {
    out(`  ${red("x  ")}${bold("Token")}. ${cfg.cloudTokenError}`);
  } else {
    out(`  ${dim("-")}  ${bold("Token in this terminal")}. Not set, which is normal. Each app keeps its own, checked below.`);
    out(dim("     To check a token you have not saved yet: npx hetzner-mcp doctor --token-stdin"));
  }

  // Surfaces available from the current environment.
  const surfaces = availableSurfaces(cfg);
  out("");
  out(`  ${dim("Surfaces in this shell.")} ${surfaces.length ? surfaces.join(", ") : "none"}`);
  out(`  ${dim("Write mode.")} ${cfg.readOnly ? "read-only (HETZNER_MCP_READONLY=1)" : "read and write"}`);
  out(`  ${dim("Billed creates.")} ${cfg.allowBilled ? "allowed with confirm (HETZNER_MCP_ALLOW_BILLED=1)" : "blocked (set HETZNER_MCP_ALLOW_BILLED=1 to enable)"}`);

  // Which known apps have hetzner wired, and whether the token saved there still works.
  const targets = clientTargets();
  const apps = await checkConnectedApps(targets);
  out("");
  out("  " + bold("Your apps:"));
  for (const t of targets) {
    const app = apps.find((a) => a.target.id === t.id);
    let marker = dim("-  ");
    let tail = dim("not connected yet");
    if (app) {
      const c = app.check;
      if (c?.ok) marker = green("OK ");
      else if (c && c.status === undefined) marker = dim("?  ");
      else marker = red("x  ");
      const state = !c ? "no Cloud token saved" : c.ok ? "token works" : c.status === undefined ? "could not check, offline?" : `token rejected (${c.status})`;
      tail = `${state} ${dim(tilde(t.configPath))}`;
    }
    out(`    ${marker}${t.name.padEnd(24)} ${tail}`);
  }

  const verdict = doctorVerdict(apps);
  out("");
  out("  " + (verdict.ok ? green(bold(verdict.line)) : bold(verdict.line)));
  if (verdict.ok) {
    out("  Restart the app if you just ran setup, then open a chat and ask:");
    out("       " + cyan('"List my Hetzner servers and show this month cost."'));
    out("  " + dim("Or see everything on one page:") + " " + cyan("npx hetzner-mcp map --open"));
  }
  out("");
  return verdict.ok || !apps.length ? 0 : 1;
}
