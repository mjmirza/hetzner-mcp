/**
 * Offline safety-guard regression tests. No network.
 * Covers audit findings F1 (enable_backup), F2 (ALLOW_BILLED opt-in), F6 (destructive free actions).
 */
import { loadConfig } from "../src/config.js";
import { classifyCost, classifyDestructive, normalizeCostPath } from "../src/cost.js";
import { normalizePath } from "../src/security.js";

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

// Path-spelling bypasses (the Sentinel finding, 26 duplicate PRs). Each must still be billed.
for (const p of [
  "servers",
  "/servers?x=1",
  "/servers#frag",
  "/servers//",
  "//servers",
  "/SERVERS",
  "/%73ervers",
  "/%2573ervers",
  " /servers ",
  "/servers/9/actions/enable_backup/",
  "/servers/9//actions/create_image",
]) {
  assert(`bypass closed: POST ${JSON.stringify(p)} is billed`, classifyCost("cloud", "POST", p).billed);
}
assert("bypass closed: DELETE via odd spelling still destructive", classifyDestructive("POST", "/servers/9/actions/%70oweroff").destructive);
assert("GET of a billed path stays free", !classifyCost("cloud", "GET", "/servers?x=1").billed);

// API review 2026-09-29: guards for actions the spec added or we missed.
assert("storage box change_type is billed", classifyCost("storagebox", "POST", "/storage_boxes/7/actions/change_type").billed);
assert("storage box change_type spelled oddly is still billed", classifyCost("storagebox", "POST", "storage_boxes/7/actions/CHANGE_TYPE/").billed);
assert("storage box enable_snapshot_plan is not billed", !classifyCost("storagebox", "POST", "/storage_boxes/7/actions/enable_snapshot_plan").billed);
for (const a of ["disable_backup", "detach_from_network", "disable_public_interface"]) {
  assert(`${a} needs confirm`, classifyDestructive("POST", `/servers/9/actions/${a}`).destructive);
}
for (const a of ["rollback_snapshot", "disable_snapshot_plan", "reset_subaccount_password", "update_access_settings", "change_home_directory"]) {
  assert(`storage box ${a} needs confirm`, classifyDestructive("POST", `/storage_boxes/7/actions/${a}`).destructive);
}
for (const a of ["import_zonefile", "change_primary_nameservers"]) {
  assert(`dns ${a} needs confirm`, classifyDestructive("POST", `/zones/example.com/actions/${a}`).destructive);
}
assert("dns rrset set_records needs confirm", classifyDestructive("POST", "/zones/example.com/rrsets/www/A/actions/set_records").destructive);
assert("dns rrset PUT needs confirm", classifyDestructive("PUT", "/zones/example.com/rrsets/www/A").destructive);
assert("dns add_records does not need confirm", !classifyDestructive("POST", "/zones/example.com/rrsets/www/A/actions/add_records").destructive);
assert("turning protection off needs confirm", classifyDestructive("POST", "/servers/9/actions/change_protection", { delete: false }).destructive);
assert("turning protection on does not", !classifyDestructive("POST", "/servers/9/actions/change_protection", { delete: true, rebuild: true }).destructive);
assert("disable_backup reason explains the data loss", /deletes all existing automatic backups/.test(classifyDestructive("POST", "/servers/9/actions/disable_backup").reason ?? ""));
assert("enable_backup is billed", classifyCost("cloud", "POST", "/servers/9/actions/enable_backup").billed);

// Adversarial review 2026-09-29 (second model). Dot segments must not bypass either guard.
for (const p of ["/./servers", "/servers/.", "./servers", "/x/../servers", "/%2e/servers", "/servers/1/actions/./create_image"]) {
  assert(`dot-segment bypass closed: POST ${p} is billed`, classifyCost("cloud", "POST", p).billed);
}
assert("dot-segment bypass closed for storage boxes", classifyCost("storagebox", "POST", "/./storage_boxes").billed);
assert("dot-segment bypass closed for rebuild", classifyDestructive("POST", "/servers/1/actions/./rebuild").destructive);
let rejected = 0;
for (const p of ["/./servers", "/servers/.", "/%2e/servers", "/servers/1/actions/./rebuild"]) {
  try { normalizePath(p); } catch { rejected++; }
}
assert("request layer refuses '.' segments outright", rejected === 4);
let accepted = true;
try { normalizePath("/servers/1.2/metrics"); normalizePath("/zones/example.com"); } catch { accepted = false; }
assert("dots inside a segment are still allowed (zone names, ids)", accepted);
assert("volume detach needs confirm", classifyDestructive("POST", "/volumes/1/actions/detach").destructive);
assert("floating IP unassign needs confirm", classifyDestructive("POST", "/floating_ips/1/actions/unassign").destructive);
assert("primary IP unassign needs confirm", classifyDestructive("POST", "/primary_ips/1/actions/unassign").destructive);
assert("volume attach does not need confirm", !classifyDestructive("POST", "/volumes/1/actions/attach").destructive);
assert("action wait is capped at 10 minutes", loadConfig({ HETZNER_MCP_ACTION_WAIT_MS: "1e308" }).actionWaitMs === 600000);

// Round 2 of the adversarial review: encoded ?, # and % are refused before any request.
let refusedEncoded = 0;
for (const p of ["/servers%3Ffoo", "/servers%23foo", "/servers/1/actions/create_image%3Ffoo", "/volumes/1/actions/detach%3ffoo", "/servers/1/actions/%252e/rebuild"]) {
  try { normalizePath(p); } catch { refusedEncoded++; }
}
assert("encoded ?, # and % in a path are refused", refusedEncoded === 5);

process.stdout.write(`\n${passed}/${total} safety-guard checks passed\n`);
if (passed !== total) process.exitCode = 1;
