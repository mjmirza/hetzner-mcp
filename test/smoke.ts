/**
 * Live smoke test. Exercises the real client code against all three surfaces using
 * only free read endpoints. Requires HETZNER_CLOUD_TOKEN and, for Robot, the webservice
 * credentials in the environment. Never creates a billed resource.
 */
import { loadConfig, availableSurfaces } from "../src/config.js";
import { hetznerRequest } from "../src/http.js";
import { formatResult } from "../src/format.js";
import { normalizePath } from "../src/security.js";
import { classifyCost } from "../src/cost.js";

const cfg = loadConfig();

function line(status: string, label: string, detail: string): void {
  process.stdout.write(`${status.padEnd(5)} ${label.padEnd(34)} ${detail}\n`);
}

async function check(label: string, surface: "cloud" | "storagebox" | "robot", path: string): Promise<boolean> {
  try {
    const res = await hetznerRequest(cfg, { surface, path });
    const preview = formatResult(res, false).replace(/\s+/g, " ").slice(0, 90);
    line("OK", label, preview);
    return true;
  } catch (err) {
    line("FAIL", label, err instanceof Error ? err.message : String(err));
    return false;
  }
}

function assert(label: string, cond: boolean): boolean {
  line(cond ? "OK" : "FAIL", label, cond ? "passed" : "FAILED");
  return cond;
}

async function main(): Promise<void> {
  process.stdout.write(`\nSurfaces available: ${availableSurfaces(cfg).join(", ") || "none"}\n\n`);

  // Security unit checks (no network).
  let secOk = true;
  try {
    normalizePath("https://evil.example.com/steal");
    secOk = false;
  } catch {
    /* expected */
  }
  assert("security: reject full URL path", secOk);
  let travOk = true;
  try {
    normalizePath("/servers/../../admin");
    travOk = false;
  } catch {
    /* expected */
  }
  assert("security: reject path traversal", travOk);

  let encTravOk = true;
  try {
    normalizePath("/servers/%2e%2e/etc");
    encTravOk = false;
  } catch {
    /* expected */
  }
  assert("security: reject percent-encoded path traversal", encTravOk);

  let bsOk = true;
  try {
    normalizePath("/servers\\..\\etc");
    bsOk = false;
  } catch {
    /* expected */
  }
  assert("security: reject backslashes", bsOk);

  let malformOk = true;
  try {
    normalizePath("/servers/%invalid");
    malformOk = false;
  } catch {
    /* expected */
  }
  assert("security: reject malformed percent encoding", malformOk);

  // Cost guard unit checks (no network). Billed creates and billed actions must be flagged,
  // free actions and reads must not be. create_image is the snapshot action from issue #2.
  const costChecks = [
    assert("cost: server create is billed", classifyCost("cloud", "POST", "/servers").billed),
    assert("cost: create_image is billed", classifyCost("cloud", "POST", "/servers/9/actions/create_image").billed),
    assert("cost: change_type is billed", classifyCost("cloud", "POST", "/servers/9/actions/change_type").billed),
    assert("cost: volume resize is billed", classifyCost("cloud", "POST", "/volumes/9/actions/resize").billed),
    assert("cost: poweron is free", !classifyCost("cloud", "POST", "/servers/9/actions/poweron").billed),
    assert("cost: list is free", !classifyCost("cloud", "GET", "/servers").billed),
  ];

  // Live free reads across all three surfaces.
  const results = [
    await check("cloud /servers", "cloud", "/servers"),
    await check("cloud /pricing", "cloud", "/pricing"),
    await check("cloud /zones (DNS)", "cloud", "/zones"),
    await check("storagebox /storage_box_types", "storagebox", "/storage_box_types"),
    await check("robot /server", "robot", "/server"),
  ];
  const passed =
    results.filter(Boolean).length +
    (secOk ? 1 : 0) +
    (travOk ? 1 : 0) +
    (encTravOk ? 1 : 0) +
    (bsOk ? 1 : 0) +
    (malformOk ? 1 : 0) +
    costChecks.filter(Boolean).length;
  const total = results.length + 5 + costChecks.length;
  process.stdout.write(`\n${passed}/${total} checks passed\n`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`smoke failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
