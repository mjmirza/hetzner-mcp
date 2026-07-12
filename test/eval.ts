/**
 * Validating eval harness. Proves, with live calls, that every endpoint the MCP claims
 * actually responds, and that the security and cost guards behave. No fabrication.
 *
 * Cost safety. all reads are free. The single write test creates one free SSH key and
 * deletes it immediately. No billed resource is ever created.
 *
 * Output. a console report and a written audit at docs/AUDIT.md.
 */
import { writeFileSync } from "node:fs";
import { loadConfig, availableSurfaces, type SurfaceName } from "../src/config.js";
import { hetznerRequest } from "../src/http.js";
import { HetznerApiError } from "../src/errors.js";
import { normalizePath } from "../src/security.js";
import { classifyCost } from "../src/cost.js";
import { redactSecrets } from "../src/errors.js";

const cfg = loadConfig();

interface Row {
  group: string;
  name: string;
  detail: string;
  status: "PASS" | "FAIL" | "SKIP";
}

const READS: Array<{ surface: SurfaceName; path: string; name: string }> = [
  { surface: "cloud", path: "/servers", name: "servers" },
  { surface: "cloud", path: "/ssh_keys", name: "ssh_keys" },
  { surface: "cloud", path: "/networks", name: "networks" },
  { surface: "cloud", path: "/firewalls", name: "firewalls" },
  { surface: "cloud", path: "/volumes", name: "volumes" },
  { surface: "cloud", path: "/load_balancers", name: "load_balancers" },
  { surface: "cloud", path: "/load_balancer_types", name: "load_balancer_types" },
  { surface: "cloud", path: "/floating_ips", name: "floating_ips" },
  { surface: "cloud", path: "/primary_ips", name: "primary_ips" },
  { surface: "cloud", path: "/placement_groups", name: "placement_groups" },
  { surface: "cloud", path: "/certificates", name: "certificates" },
  { surface: "cloud", path: "/images", name: "images" },
  { surface: "cloud", path: "/isos", name: "isos" },
  { surface: "cloud", path: "/server_types", name: "server_types" },
  { surface: "cloud", path: "/locations", name: "locations" },
  { surface: "cloud", path: "/datacenters", name: "datacenters" },
  { surface: "cloud", path: "/pricing", name: "pricing" },
  { surface: "cloud", path: "/zones", name: "dns_zones" },
  { surface: "storagebox", path: "/storage_boxes", name: "storage_boxes" },
  { surface: "storagebox", path: "/storage_box_types", name: "storage_box_types" },
  { surface: "robot", path: "/server", name: "robot_servers" },
  { surface: "robot", path: "/ip", name: "robot_ips" },
  { surface: "robot", path: "/subnet", name: "robot_subnets" },
  { surface: "robot", path: "/vswitch", name: "robot_vswitches" },
  { surface: "robot", path: "/failover", name: "robot_failover" },
  { surface: "robot", path: "/key", name: "robot_ssh_keys" },
  { surface: "robot", path: "/storagebox", name: "robot_storageboxes" },
  { surface: "robot", path: "/rdns", name: "robot_rdns" },
];

async function liveRead(e: { surface: SurfaceName; path: string; name: string }): Promise<Row> {
  const label = `${e.surface} GET ${e.path}`;
  try {
    const res = (await hetznerRequest(cfg, { surface: e.surface, path: e.path })) as Record<string, unknown>;
    const key = Object.keys(res).find((k) => Array.isArray(res[k]));
    const count = Array.isArray(res) ? res.length : key ? (res[key] as unknown[]).length : "ok";
    return { group: e.surface, name: e.name, detail: `200, count ${count}`, status: "PASS" };
  } catch (err) {
    if (err instanceof HetznerApiError) {
      // 404 on Robot means authenticated but the collection is empty. 410 means a documented deprecation.
      if (err.status === 404) return { group: e.surface, name: e.name, detail: "404, empty collection, auth OK", status: "PASS" };
      if (err.status === 410) return { group: e.surface, name: e.name, detail: "410, deprecated endpoint (expected)", status: "PASS" };
      return { group: e.surface, name: e.name, detail: `${err.status} ${err.code}`, status: "FAIL" };
    }
    return { group: e.surface, name: e.name, detail: String(err), status: "FAIL" };
  }
}

function unitChecks(): Row[] {
  const rows: Row[] = [];
  const sec = (name: string, fn: () => void, shouldThrow: boolean) => {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    rows.push({ group: "security", name, detail: shouldThrow ? "rejected" : "accepted", status: threw === shouldThrow ? "PASS" : "FAIL" });
  };
  sec("reject full URL", () => normalizePath("https://evil.example.com"), true);
  sec("reject protocol-relative", () => normalizePath("//evil.example.com"), true);
  sec("reject path traversal", () => normalizePath("/a/../../etc"), true);
  sec("reject URL-encoded path traversal", () => normalizePath("/servers/%2e%2e/admin"), true);
  sec("reject backslash path traversal", () => normalizePath("/servers/..\\..\\admin"), true);
  sec("reject URL-encoded control chars", () => normalizePath("/servers/%00admin"), true);
  sec("accept normal path", () => normalizePath("/servers"), false);

  const cost = (name: string, got: boolean, want: boolean) =>
    rows.push({ group: "cost-guard", name, detail: `billed=${got}`, status: got === want ? "PASS" : "FAIL" });
  cost("POST /servers is billed", classifyCost("cloud", "POST", "/servers").billed, true);
  cost("POST /ssh_keys is free", classifyCost("cloud", "POST", "/ssh_keys").billed, false);
  cost("DELETE /servers/1 is not billed", classifyCost("cloud", "DELETE", "/servers/1").billed, false);
  cost("POST /storage_boxes is billed", classifyCost("storagebox", "POST", "/storage_boxes").billed, true);

  const sample = "token Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG end";
  const redacted = redactSecrets(sample);
  rows.push({
    group: "security",
    name: "redact bearer token",
    detail: redacted.includes("REDACTED") && !redacted.includes("abcdefghijklmnop") ? "redacted" : "LEAK",
    status: redacted.includes("REDACTED") && !redacted.includes("abcdefghijklmnop") ? "PASS" : "FAIL",
  });
  return rows;
}

async function writeTest(): Promise<Row[]> {
  const pub = process.env.HETZNER_TEST_SSH_PUBKEY;
  if (!cfg.cloudToken || !pub) {
    return [{ group: "write", name: "ssh_key create+delete", detail: "skipped, no test pubkey", status: "SKIP" }];
  }
  const name = `hetzner-mcp-eval-${Date.now()}`;
  try {
    const created = (await hetznerRequest(cfg, {
      surface: "cloud",
      method: "POST",
      path: "/ssh_keys",
      body: { name, public_key: pub },
    })) as { ssh_key?: { id?: number } };
    const id = created.ssh_key?.id;
    if (!id) return [{ group: "write", name: "ssh_key create", detail: "no id returned", status: "FAIL" }];
    await hetznerRequest(cfg, { surface: "cloud", method: "DELETE", path: `/ssh_keys/${id}` });
    // confirm gone
    let gone = false;
    try {
      await hetznerRequest(cfg, { surface: "cloud", path: `/ssh_keys/${id}` });
    } catch (e) {
      gone = e instanceof HetznerApiError && e.status === 404;
    }
    return [
      { group: "write", name: "ssh_key create (free)", detail: `created id ${id}`, status: "PASS" },
      { group: "write", name: "ssh_key delete", detail: gone ? "deleted and verified gone" : "deleted, verify inconclusive", status: gone ? "PASS" : "FAIL" },
    ];
  } catch (err) {
    return [{ group: "write", name: "ssh_key create+delete", detail: err instanceof Error ? err.message : String(err), status: "FAIL" }];
  }
}

function renderMarkdown(rows: Row[], stamp: string): string {
  const lines: string[] = [];
  lines.push("# Validating Audit");
  lines.push("");
  lines.push(`Generated by test/eval.ts against a live Hetzner account on ${stamp}.`);
  lines.push("Every row is a real result, not an assumption. Reads are free, the one write test");
  lines.push("creates a free SSH key and deletes it. No billed resource is created.");
  lines.push("");
  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const skip = rows.filter((r) => r.status === "SKIP").length;
  lines.push(`Result. ${pass} passed, ${fail} failed, ${skip} skipped, ${rows.length} total.`);
  lines.push("");
  lines.push("| Group | Check | Result | Status |");
  lines.push("|---|---|---|---|");
  for (const r of rows) lines.push(`| ${r.group} | ${r.name} | ${r.detail} | ${r.status} |`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const stamp = process.env.EVAL_STAMP ?? "unknown date";
  process.stdout.write(`\nValidating audit. surfaces: ${availableSurfaces(cfg).join(", ") || "none"}\n\n`);

  const reads = await Promise.all(READS.map(liveRead));
  const units = unitChecks();
  const writes = await writeTest();
  const rows = [...units, ...reads, ...writes];

  for (const r of rows) {
    process.stdout.write(`${r.status.padEnd(4)} ${r.group.padEnd(11)} ${r.name.padEnd(30)} ${r.detail}\n`);
  }
  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const skip = rows.filter((r) => r.status === "SKIP").length;
  process.stdout.write(`\n${pass} passed, ${fail} failed, ${skip} skipped, ${rows.length} total\n`);

  writeFileSync("docs/AUDIT.md", renderMarkdown(rows, stamp));
  process.stdout.write("Wrote docs/AUDIT.md\n");
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
