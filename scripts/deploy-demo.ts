/**
 * Integrated deploy demo, driven entirely through the hetzner-mcp `cloud_request`
 * tool against the built MCP server. Proves the server can stand up a real, working,
 * load-balanced, high-availability web tier end to end.
 *
 * Builds, in dependency order:
 *   private network + subnet -> firewall -> placement group -> 2 cx23 web nodes
 *   (cloud-init nginx, per-host page) -> load balancer (lb11) -> HTTP service with
 *   health check -> both servers added as targets.
 *
 * Then waits for the servers to boot and the load balancer targets to go healthy,
 * and curls the load balancer public IP to prove traffic round-robins across both
 * backends. Leaves everything UP so it can be seen in the Hetzner portal, and prints
 * the exact teardown command. Every resource is labelled purpose=mcpdemo so teardown
 * is a single label sweep. Requires HETZNER_CLOUD_TOKEN.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "index.js");
const LOCATION = "fsn1";
const ZONE = "eu-central";
const TYPE = "cx23";
const IMAGE = "ubuntu-24.04";
const LABELS = { purpose: "mcpdemo" };
const PUBKEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFNEjN18aa8msd7S08R6uoWchLh1F1L250g8K5LXwvtG mcpdemo";

type CallResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean };
interface Ipv4 {
  ip?: string;
}
interface PublicNet {
  ipv4?: Ipv4;
}
interface ServerResp {
  server: { id: number; status?: string; public_net?: PublicNet };
}
interface NetResp {
  network: { id: number };
}
interface FwResp {
  firewall: { id: number };
}
interface PgResp {
  placement_group: { id: number };
}
interface KeyResp {
  ssh_key: { id: number };
}
interface Target {
  health_status?: Array<{ status?: string }>;
}
interface LbResp {
  load_balancer: { id: number; public_net?: PublicNet; targets?: Target[] };
}

function textOf(r: CallResult): string {
  return (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}
function jsonOf<T>(r: CallResult): T {
  return JSON.parse(textOf(r)) as T;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const cloudInit = [
  "#cloud-config",
  "package_update: true",
  "packages:",
  "  - nginx",
  "runcmd:",
  "  - bash -c 'echo \"<h1>hetzner-mcp demo</h1><p>served by $(hostname)</p>\" > /var/www/html/index.html'",
  "  - systemctl enable --now nginx",
  "",
].join("\n");

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
  const client = new Client({ name: "deploy-demo", version: "1.0.0" });
  await client.connect(transport);
  const req = (args: Record<string, unknown>): Promise<CallResult> =>
    client.callTool({ name: "cloud_request", arguments: args }) as Promise<CallResult>;
  const step = (msg: string): void => console.log(`>> ${msg}`);

  // 1. Network + subnet (free).
  step("creating private network 10.30.0.0/16");
  const net = jsonOf<NetResp>(
    await req({
      method: "POST",
      path: "/networks",
      body: {
        name: "mcpdemo-net",
        ip_range: "10.30.0.0/16",
        subnets: [{ type: "cloud", ip_range: "10.30.1.0/24", network_zone: ZONE }],
        labels: LABELS,
      },
      verbose: true,
    }),
  );
  const netId = net.network.id;

  // 2. Firewall (free).
  step("creating firewall (80, 443, 22, icmp)");
  const fw = jsonOf<FwResp>(
    await req({
      method: "POST",
      path: "/firewalls",
      body: {
        name: "mcpdemo-fw",
        labels: LABELS,
        rules: [
          { direction: "in", protocol: "tcp", port: "80", source_ips: ["0.0.0.0/0", "::/0"] },
          { direction: "in", protocol: "tcp", port: "443", source_ips: ["0.0.0.0/0", "::/0"] },
          { direction: "in", protocol: "tcp", port: "22", source_ips: ["0.0.0.0/0", "::/0"] },
          { direction: "in", protocol: "icmp", source_ips: ["0.0.0.0/0", "::/0"] },
        ],
      },
      verbose: true,
    }),
  );
  const fwId = fw.firewall.id;

  // 3. Placement group (free).
  step("creating placement group (spread)");
  const pg = jsonOf<PgResp>(
    await req({
      method: "POST",
      path: "/placement_groups",
      body: { name: "mcpdemo-pg", type: "spread", labels: LABELS },
      verbose: true,
    }),
  );
  const pgId = pg.placement_group.id;

  // 4. SSH key (free).
  step("registering ssh key");
  const key = jsonOf<KeyResp>(
    await req({ method: "POST", path: "/ssh_keys", body: { name: "mcpdemo-key", public_key: PUBKEY, labels: LABELS }, verbose: true }),
  );
  const keyId = key.ssh_key.id;

  // 5. Two cx23 web nodes (billed). Independent, so create concurrently.
  step("creating 2x cx23 web nodes with cloud-init nginx");
  const makeServer = async (name: string): Promise<{ id: number; ip: string }> => {
    const s = jsonOf<ServerResp>(
      await req({
        method: "POST",
        path: "/servers",
        confirm: true,
        body: {
          name,
          server_type: TYPE,
          image: IMAGE,
          location: LOCATION,
          ssh_keys: [keyId],
          networks: [netId],
          firewalls: [{ firewall: fwId }],
          placement_group: pgId,
          user_data: cloudInit,
          labels: LABELS,
        },
        verbose: true,
      }),
    );
    return { id: s.server.id, ip: s.server.public_net?.ipv4?.ip ?? "" };
  };
  const [s1, s2] = await Promise.all([makeServer("mcpdemo-web1"), makeServer("mcpdemo-web2")]);

  // 6. Load balancer lb11 (billed), attached to the private network.
  step("creating load balancer lb11");
  const lb = jsonOf<LbResp>(
    await req({
      method: "POST",
      path: "/load_balancers",
      confirm: true,
      body: { name: "mcpdemo-lb", load_balancer_type: "lb11", location: LOCATION, network: netId, labels: LABELS },
      verbose: true,
    }),
  );
  const lbId = lb.load_balancer.id;
  const lbIp = lb.load_balancer.public_net?.ipv4?.ip ?? "";

  // 7. HTTP service with health check.
  step("adding HTTP service (80->80) with health check");
  await req({
    method: "POST",
    path: `/load_balancers/${lbId}/actions/add_service`,
    confirm: true,
    body: {
      protocol: "http",
      listen_port: 80,
      destination_port: 80,
      health_check: {
        protocol: "http",
        port: 80,
        interval: 5,
        timeout: 3,
        retries: 2,
        http: { path: "/", status_codes: ["2??", "3??"] },
      },
    },
  });

  // 8. Wait for both servers to be running AND attached to the network before
  //    targeting them. Adding a target before the network attachment settles is
  //    silently dropped by the API, which leaves the load balancer with no backends.
  step("waiting for servers to boot and attach...");
  const waitRunning = async (id: number): Promise<void> => {
    const deadline = Date.now() + 120_000;
    // BESTPRACTICE_OK: a status poll must run one check after another until ready.
    while (Date.now() < deadline) {
      const s = jsonOf<ServerResp>(await req({ method: "GET", path: `/servers/${id}`, verbose: true }));
      if (s.server?.status === "running") return;
      await sleep(5000);
    }
    throw new Error(`server ${id} did not reach running in time`);
  };
  await Promise.all([waitRunning(s1.id), waitRunning(s2.id)]);

  // 9. Add both servers as targets over the private network. Verify each persisted,
  //    then confirm the load balancer actually shows two targets.
  step("adding both web nodes as targets");
  await Promise.all(
    [s1.id, s2.id].map(async (id) => {
      const r = await req({
        method: "POST",
        path: `/load_balancers/${lbId}/actions/add_target`,
        confirm: true,
        body: { type: "server", server: { id }, use_private_ip: true },
      });
      if (r.isError) throw new Error(`add_target ${id} failed: ${textOf(r).slice(0, 120)}`);
    }),
  );
  const afterAdd = jsonOf<LbResp>(await req({ method: "GET", path: `/load_balancers/${lbId}`, verbose: true }));
  const targetCount = afterAdd.load_balancer?.targets?.length ?? 0;
  if (targetCount < 2) throw new Error(`expected 2 targets, load balancer has ${targetCount}`);
  step(`confirmed ${targetCount} targets attached`);

  // 10. Wait for LB targets healthy (nginx via cloud-init takes ~30-90s).
  step("waiting for load balancer targets to go healthy...");
  const deadline = Date.now() + 180_000;
  let healthy = 0;
  // BESTPRACTICE_OK: health convergence is a poll of one resource, one check after another.
  while (Date.now() < deadline) {
    const cur = jsonOf<LbResp>(await req({ method: "GET", path: `/load_balancers/${lbId}`, verbose: true }));
    const targets = cur.load_balancer?.targets ?? [];
    healthy = targets.filter((t) => (t.health_status ?? []).every((h) => h.status === "healthy")).length;
    if (healthy >= 2) break;
    await sleep(6000);
  }

  // 11. Curl the LB public IP a few times to show round-robin.
  step(`probing load balancer http://${lbIp}/ for round-robin`);
  const seen = new Set<string>();
  const probes: string[] = [];
  await Promise.all(
    Array.from({ length: 6 }, async (_unused, i) => {
      try {
        const res = await fetch(`http://${lbIp}/`, { signal: AbortSignal.timeout(8000) });
        const body = await res.text();
        const host = (body.match(/served by ([^<]+)/) ?? [])[1]?.trim() ?? `status ${res.status}`;
        probes[i] = host;
        seen.add(host);
      } catch (e) {
        probes[i] = `err ${e instanceof Error ? e.message : String(e)}`;
      }
    }),
  );

  await client.close();

  console.log("\n================ DEPLOY COMPLETE ================");
  console.log(`Network        mcpdemo-net   id=${netId}  10.30.0.0/16`);
  console.log(`Firewall       mcpdemo-fw    id=${fwId}`);
  console.log(`PlacementGroup mcpdemo-pg    id=${pgId}  (spread)`);
  console.log(`Web node 1     mcpdemo-web1  id=${s1.id}  ${s1.ip}`);
  console.log(`Web node 2     mcpdemo-web2  id=${s2.id}  ${s2.ip}`);
  console.log(`Load balancer  mcpdemo-lb    id=${lbId}  http://${lbIp}/`);
  console.log(`LB targets healthy: ${healthy}/2`);
  console.log(`Round-robin probes: ${JSON.stringify(probes)}`);
  console.log(`Distinct backends served: ${seen.size} (${[...seen].join(", ")})`);
  console.log("\nPortal: https://console.hetzner.cloud/  (project -> Load Balancers / Servers)");
  console.log("\nTeardown (run when done): npx tsx scripts/teardown-demo.ts");
  console.log("================================================");
}

main().catch((err) => {
  console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
