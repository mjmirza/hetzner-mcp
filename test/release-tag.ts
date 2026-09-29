// Release gate: runs the script the way the publish workflow does, under bash -e.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tagMismatch } from "../scripts/check-release-tag.mjs";

let passed = 0;
let failed = 0;
function assert(name: string, ok: boolean) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
}

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;
function run(tag: string | undefined): number {
  const env = { ...process.env };
  delete env.TAG;
  if (tag !== undefined) env.TAG = tag;
  try {
    execFileSync("bash", ["-e", "-c", "node scripts/check-release-tag.mjs"], { env, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

assert("v-prefixed tag matches", tagMismatch("v1.2.3", "1.2.3") === null);
assert("bare tag matches", tagMismatch("1.2.3", "1.2.3") === null);
assert("wrong version is refused", tagMismatch("v1.2.4", "1.2.3") !== null);
assert("prefix-only match is refused", tagMismatch("v1.2.30", "1.2.3") !== null);
assert("empty tag is refused", tagMismatch("", "1.2.3") !== null);
assert("script passes for the real version under bash -e", run(`v${version}`) === 0);
assert("script fails for a wrong tag under bash -e", run("v0.0.0-wrong") === 1);
assert("script fails with no tag under bash -e", run(undefined) === 1);

console.log(`${passed}/${passed + failed} release-tag checks passed`);
if (failed) process.exit(1);
