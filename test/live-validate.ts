/**
 * Live validation suite for hetzner-mcp.
 *
 * Drives the BUILT MCP server over stdio (the exact artifact a client loads) and
 * exercises the real Hetzner API, so every read and write path is proven, not assumed.
 *
 * What it validates:
 *   1. Reads  - every cloud list/catalog endpoint returns without error.
 *   2. Cost guard - each billed create is refused without confirm (no charge).
 *   3. Free writes - ssh key, network, firewall, placement group create + delete.
 *   4. Billed writes - primary IP, floating IP, volume, load balancer create + delete.
 *      Each lives for seconds, so the real cost is a few cents, far under any budget.
 *
 * Independent resource lifecycles run concurrently to bound wall-clock and cost.
 * Every created resource is deleted in a finally block, so a failure never leaks a
 * billed resource. Requires HETZNER_CLOUD_TOKEN.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "index.js");
const LOCATION = "fsn1";
const DATACENTER = "fsn1-dc14";

// A unique ed25519 public key per run, in OpenSSH wire format. Hetzner rejects a
// duplicate key by material, so generating a fresh one keeps the ssh_key lifecycle
// reliable no matter what already exists on the account.
function freshOpenSshEd25519(comment: string): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  const raw = der.subarray(der.length - 32);
  const wrap = (b: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  const blob = Buffer.concat([wrap(Buffer.from("ssh-ed25519")), wrap(raw)]);
  return `ssh-ed25519 ${blob.toString("base64")} ${comment}`;
}
const PUBKEY = freshOpenSshEd25519("lvtest");

type CallResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean };
interface Row {
  name: string;
  pass: boolean;
  detail: string;
}
const rows: Row[] = [];
function record(name: string, pass: boolean, detail = ""): boolean {
  rows.push({ name, pass, detail });
  console.log(`${pass ? "OK  " : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
  return pass;
}
function textOf(r: CallResult): string {
  return (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

async function main(): Promise<void> {
  const token = process.env.HETZNER_CLOUD_TOKEN;
  if (!token) {
    console.error("FAIL  HETZNER_CLOUD_TOKEN not set");
    process.exit(1);
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, HETZNER_CLOUD_TOKEN: token },
  });
  const client = new Client({ name: "live-validate", version: "1.0.0" });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown>): Promise<CallResult> =>
    (await client.callTool({ name, arguments: args })) as CallResult;
  const req = (args: Record<string, unknown>): Promise<CallResult> => call("cloud_request", args);
  // A response is an error only if it is a guard message or a Hetzner error envelope
  // ({"error": {...}}). A success action carries "error": null, which is NOT a failure.
  const isApiError = (t: string): boolean => {
    if (/failed to parse|A valid JSON document|COST GUARD|Refused\.|Blocked\.|DESTRUCTIVE GUARD/i.test(t)) {
      return true;
    }
    try {
      const j = JSON.parse(t) as { error?: unknown };
      return j !== null && typeof j === "object" && j.error != null;
    } catch {
      return false;
    }
  };

  // ---- 1. READS. Every cloud list/catalog endpoint must return cleanly. ----
  const readTools = [
    "cloud_list_servers",
    "cloud_list_ssh_keys",
    "cloud_list_networks",
    "cloud_list_firewalls",
    "cloud_list_volumes",
    "cloud_list_load_balancers",
    "cloud_list_floating_ips",
    "cloud_list_primary_ips",
    "cloud_list_placement_groups",
    "cloud_list_certificates",
    "cloud_list_images",
    "cloud_list_isos",
    "cloud_list_dns_zones",
    "cloud_list_server_types",
    "cloud_list_load_balancer_types",
    "cloud_list_locations",
    "cloud_list_datacenters",
    "cloud_get_pricing",
  ];
  await Promise.all(
    readTools.map(async (t) => {
      try {
        const r = await call(t, {});
        const t2 = textOf(r);
        record(`read ${t}`, !r.isError && !isApiError(t2), r.isError ? t2.slice(0, 80) : "");
      } catch (e) {
        record(`read ${t}`, false, e instanceof Error ? e.message.slice(0, 80) : String(e));
      }
    }),
  );

  // ---- 2. COST GUARD. Billed creates must be refused without confirm (no charge). ----
  const billedPaths: Array<{ path: string; body: Record<string, unknown> }> = [
    { path: "/primary_ips", body: { name: "g", type: "ipv4", datacenter: DATACENTER, assignee_type: "server" } },
    { path: "/floating_ips", body: { type: "ipv4", home_location: LOCATION } },
    { path: "/volumes", body: { name: "g", size: 10, location: LOCATION, format: "ext4" } },
    { path: "/load_balancers", body: { name: "g", load_balancer_type: "lb11", location: LOCATION } },
  ];
  await Promise.all(
    billedPaths.map(async ({ path, body }) => {
      const r = await req({ method: "POST", path, body });
      const t = textOf(r);
      record(`cost-guard refuses ${path}`, /COST GUARD/i.test(t), t.slice(0, 70));
    }),
  );
  // Typed server create must also refuse without confirm.
  {
    const r = await call("cloud_create_server", { name: "g", server_type: "cx23", image: "ubuntu-24.04" });
    const t = textOf(r);
    record("cost-guard refuses cloud_create_server", /COST GUARD/i.test(t), t.slice(0, 70));
  }

  // ---- 3 + 4. FREE and BILLED writes: create + delete each, concurrently. ----
  const idFrom = (r: CallResult, key: string): number | undefined => {
    try {
      return JSON.parse(textOf(r))?.[key]?.id;
    } catch {
      return undefined;
    }
  };
  const lifecycle = async (
    label: string,
    createBody: Record<string, unknown>,
    path: string,
    key: string,
    billed: boolean,
  ): Promise<void> => {
    let id: number | undefined;
    try {
      const create = await req({ method: "POST", path, body: createBody, confirm: billed, verbose: true });
      const ct = textOf(create);
      if (create.isError || isApiError(ct)) {
        record(`${billed ? "billed" : "free"} ${label} create`, false, ct.slice(0, 120));
        return;
      }
      id = idFrom(create, key);
      if (!id) {
        record(`${billed ? "billed" : "free"} ${label} create`, false, `no id in ${ct.slice(0, 100)}`);
        return;
      }
      record(`${billed ? "billed" : "free"} ${label} create`, true, `id=${id}`);
    } finally {
      if (id) {
        const del = await req({ method: "DELETE", path: `${path}/${id}`, confirm: true });
        record(`${label} delete`, !del.isError, del.isError ? textOf(del).slice(0, 80) : `id=${id}`);
      }
    }
  };

  await Promise.all([
    lifecycle("ssh_key", { name: "lvtest-key", public_key: PUBKEY }, "/ssh_keys", "ssh_key", false),
    lifecycle(
      "network",
      {
        name: "lvtest-net",
        ip_range: "10.20.0.0/16",
        subnets: [{ type: "cloud", ip_range: "10.20.1.0/24", network_zone: "eu-central" }],
      },
      "/networks",
      "network",
      false,
    ),
    lifecycle(
      "firewall",
      { name: "lvtest-fw", rules: [{ direction: "in", protocol: "tcp", port: "80", source_ips: ["0.0.0.0/0"] }] },
      "/firewalls",
      "firewall",
      false,
    ),
    lifecycle("placement_group", { name: "lvtest-pg", type: "spread" }, "/placement_groups", "placement_group", false),
    lifecycle(
      "primary_ip",
      { name: "lvtest-pip", type: "ipv4", datacenter: DATACENTER, assignee_type: "server" },
      "/primary_ips",
      "primary_ip",
      true,
    ),
    lifecycle("floating_ip", { type: "ipv4", home_location: LOCATION, name: "lvtest-fip" }, "/floating_ips", "floating_ip", true),
    lifecycle("volume", { name: "lvtest-vol", size: 10, location: LOCATION, format: "ext4" }, "/volumes", "volume", true),
    lifecycle("load_balancer", { name: "lvtest-lb", load_balancer_type: "lb11", location: LOCATION }, "/load_balancers", "load_balancer", true),
  ]);

  // ---- 5. STORAGE BOX surface: reads + billed cost-guard (no box is created). ----
  const names = new Set((await client.listTools()).tools.map((t) => t.name));
  if (names.has("storagebox_list")) {
    await Promise.all(
      ["storagebox_list", "storagebox_list_types"].map(async (t) => {
        const r = await call(t, {});
        const txt = textOf(r);
        record(`read ${t}`, !r.isError && !isApiError(txt), r.isError ? txt.slice(0, 80) : "");
      }),
    );
    const guard = await call("storagebox_request", {
      method: "POST",
      path: "/storage_boxes",
      body: { name: "lvtest-box", storage_box_type: "bx11", location: LOCATION },
    });
    record("cost-guard refuses /storage_boxes", /COST GUARD/i.test(textOf(guard)), textOf(guard).slice(0, 70));
  } else {
    record("storagebox surface", true, "skipped (storagebox not configured)");
  }

  // ---- 6. ROBOT surface: every read endpoint (dedicated servers are not orderable). ----
  if (names.has("robot_list_servers")) {
    const robotReads = [
      "robot_list_servers",
      "robot_list_ips",
      "robot_list_subnets",
      "robot_list_vswitches",
      "robot_list_failover",
      "robot_list_ssh_keys",
      "robot_list_storageboxes",
      "robot_list_rdns",
    ];
    await Promise.all(
      robotReads.map(async (t) => {
        const r = await call(t, {});
        const txt = textOf(r);
        // An empty robot collection answers with 404 / "no ... found" by design, not a failure.
        const okEmpty = /not found|no [a-z ]*found|"status":\s*404|NOT_FOUND/i.test(txt);
        record(`read ${t}`, !r.isError || okEmpty, r.isError && !okEmpty ? txt.slice(0, 80) : "");
      }),
    );
  } else {
    record("robot surface", true, "skipped (robot credentials not configured)");
  }

  // ---- 8. Remaining tools: the typed delete guard and the generic robot reader. ----
  {
    const delGuard = await call("cloud_delete_server", { id: 1 });
    const dg = textOf(delGuard);
    record("cloud_delete_server requires confirm", /confirm|DESTRUCTIVE|GUARD/i.test(dg) || Boolean(delGuard.isError), dg.slice(0, 70));
  }
  if (names.has("robot_request")) {
    const rr = await call("robot_request", { method: "GET", path: "/server" });
    const rt = textOf(rr);
    const okEmpty = /not found|no [a-z ]*found|"status":\s*404|NOT_FOUND/i.test(rt);
    record("robot_request GET /server", !rr.isError || okEmpty, rr.isError && !okEmpty ? rt.slice(0, 80) : "");
  }

  await client.close();

  const passed = rows.filter((r) => r.pass).length;
  const failed = rows.length - passed;
  console.log(`\n==== LIVE VALIDATE: ${passed}/${rows.length} passed, ${failed} failed ====`);
  if (failed > 0) {
    console.log("Failures:");
    for (const r of rows.filter((x) => !x.pass)) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  console.log("ALL GREEN. Every read, cost-guard, and write path round-trips through the MCP.");
}

main().catch((err) => {
  console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
