/**
 * Offline safety-guard regression tests. No network.
 * Covers audit findings F1 (enable_backup), F2 (ALLOW_BILLED opt-in), F6 (destructive free actions).
 */
import { loadConfig } from "../src/config.js";
import { classifyCost, classifyDestructive, normalizeCostPath } from "../src/cost.js";

let passed = 0;
let total = 0;

function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  process.stdout.write(`${cond ? "OK  " : "FAIL"} ${label}\n`);
}

// F1: Hetzner API uses enable_backup (singular). Plural must also be guarded.
assert(
  "F1: enable_backup (singular) is billed",
  classifyCost("cloud", "POST", "/servers/9/actions/enable_backup").billed,
);
assert(
  "F1: enable_backups (plural) still billed defensively",
  classifyCost("cloud", "POST", "/servers/9/actions/enable_backups").billed,
);
assert(
  "F1: query string does not bypass enable_backup guard",
  classifyCost("cloud", "POST", "/servers/9/actions/enable_backup?foo=1").billed,
);

// Existing billed coverage still holds.
assert("server create is billed", classifyCost("cloud", "POST", "/servers").billed);
assert("create_image is billed", classifyCost("cloud", "POST", "/servers/9/actions/create_image").billed);
assert("poweron is not billed", !classifyCost("cloud", "POST", "/servers/9/actions/poweron").billed);

// F2: ALLOW_BILLED is opt-in.
assert("F2: unset ALLOW_BILLED blocks billed", loadConfig({}).allowBilled === false);
assert("F2: empty ALLOW_BILLED blocks billed", loadConfig({ HETZNER_MCP_ALLOW_BILLED: "" }).allowBilled === false);
assert("F2: ALLOW_BILLED=0 blocks billed", loadConfig({ HETZNER_MCP_ALLOW_BILLED: "0" }).allowBilled === false);
assert("F2: ALLOW_BILLED=1 allows billed", loadConfig({ HETZNER_MCP_ALLOW_BILLED: "1" }).allowBilled === true);
assert("F2: ALLOW_BILLED=true does not enable", loadConfig({ HETZNER_MCP_ALLOW_BILLED: "true" }).allowBilled === false);

// F6: free destructive actions need confirm.
for (const action of [
  "poweroff",
  "shutdown",
  "reboot",
  "reset",
  "rebuild",
  "reset_password",
  "enable_rescue",
]) {
  assert(
    `F6: ${action} is destructive`,
    classifyDestructive("POST", `/servers/9/actions/${action}`).destructive,
  );
}
assert("F6: DELETE is destructive", classifyDestructive("DELETE", "/servers/9").destructive);
assert("F6: poweron is not destructive", !classifyDestructive("POST", "/servers/9/actions/poweron").destructive);
assert("F6: GET is not destructive", !classifyDestructive("GET", "/servers/9").destructive);

assert("normalizeCostPath strips query", normalizeCostPath("/servers?page=2") === "/servers");
assert("normalizeCostPath adds slash", normalizeCostPath("servers") === "/servers");

process.stdout.write(`\n${passed}/${total} safety-guard checks passed\n`);
if (passed !== total) process.exitCode = 1;
