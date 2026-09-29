/**
 * Runs the documented commands against the BUILT program, the way a user pastes them.
 * Catches what unit tests miss: a flag parsed but never reaching the output. Needs `npm run build`.
 * No credentials, no network, a throwaway HOME so no real client config is read or written.
 */
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const home = mkdtempSync(join(tmpdir(), "hzmcp-cli-"));
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, APPDATA: home, HETZNER_MCP_MAP_PORT: "43411" };

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean, detail = ""): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}${cond || !detail ? "" : `  -> ${detail.slice(0, 160)}`}\n`);
}
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [bin, ...args], { env, encoding: "utf8", timeout: 20000, input: "" });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const pkg = (await import("../package.json", { with: { type: "json" } })).default as { version: string };

let r = run("version");
assert("version prints the package version", r.code === 0 && r.out.trim() === pkg.version, r.out);
r = run("help");
assert("help lists setup, doctor and map", r.code === 0 && /setup/.test(r.out) && /doctor/.test(r.out) && /map/.test(r.out), r.out);
r = run("setup", "--print");
assert("setup --print works with no token and no terminal", r.code === 0 && r.out.includes("<paste-your-token-here>"), r.out);
assert("setup --print keeps paid resources off by default", !r.out.includes('"HETZNER_MCP_ALLOW_BILLED"') && r.out.includes("--allow-billed"), r.out);
r = run("setup", "--print", "--no-verify", "--token", "t0k", "--allow-billed");
assert("setup --print --allow-billed includes the switch", r.code === 0 && r.out.includes('"HETZNER_MCP_ALLOW_BILLED": "1"'), r.out);
assert("setup --print includes the given token", r.out.includes('"HETZNER_CLOUD_TOKEN": "t0k"'), r.out);
r = run("setup", "--print", "--client", "cursor");
assert("setup --print --client cursor targets Cursor", r.code === 0 && /Cursor/i.test(r.out), r.out);
r = run("doctor");
assert("doctor runs without a token and says billed is blocked", r.code === 0 && /blocked/.test(r.out), r.out);
r = run("map");
assert("map without credentials exits 1 with a helpful message", r.code === 1 && r.out.includes("map --demo"), r.out);

// map --demo serves the canvas, then stops on SIGTERM.
const child = spawn(process.execPath, [bin, "map", "--demo"], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => (out += d));
const url = await new Promise<string>((res) => {
  const t = setTimeout(() => res(""), 8000);
  child.stdout.on("data", () => {
    const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//);
    if (m) {
      clearTimeout(t);
      res(m[0]);
    }
  });
});
assert("map --demo prints a loopback URL", url.startsWith("http://127.0.0.1:"), out);
if (url) {
  const html = await fetch(url).then((x) => x.text()).catch(() => "");
  assert("map --demo serves the page", html.includes("Hetzner Infra Map"));
  const g = await fetch(url + "api/graph", { headers: { "X-Hzmap": "1" } }).then((x) => x.json()).catch(() => ({})) as { source?: string };
  assert("map --demo serves sample data", g.source === "sample");
}
const exited = new Promise<number | null>((res) => child.on("exit", (c) => res(c)));
child.kill("SIGTERM");
assert("map stops cleanly on Ctrl+C", (await exited) === 0);

// The MCP server starts over stdio when launched with no arguments.
const mcp = spawn(process.execPath, [bin], { env, stdio: ["pipe", "pipe", "pipe"] });
let err = "";
mcp.stderr.on("data", (d) => (err += d));
await new Promise((res) => setTimeout(res, 1500));
assert("no-argument launch starts the MCP server", err.includes(`hetzner-mcp ${pkg.version} ready`), err);
mcp.kill();

process.stdout.write(`\n${passed}/${total} cli checks passed\n`);
if (passed !== total) process.exitCode = 1;
