/**
 * A clearly labelled sample estate, so a user can see the map before provisioning anything
 * and so the canvas can be tested offline. Prices mirror Hetzner list prices from 2026-09.
 */
import { buildProject } from "./collect.js";
import { finalize } from "./totals.js";
import type { InfraGraph, MapEdge, MapNode } from "./types.js";

const price = (m: number, loc = "fsn1") => [{ location: loc, price_monthly: { gross: String(m) } }];
const pricing = {
  currency: "EUR",
  vatRate: "19",
  serverTypes: new Map<string, any[]>([ // eslint-disable-line @typescript-eslint/no-explicit-any
    ["cpx11", [...price(5.49), ...price(5.49, "nbg1"), ...price(5.49, "hel1")]],
    ["cpx31", [...price(16.49), ...price(16.49, "nbg1"), ...price(16.49, "hel1")]],
    ["ccx23", [...price(31.49), ...price(31.49, "nbg1")]],
    ["cax21", [...price(7.49), ...price(7.49, "hel1")]],
  ]),
  lbTypes: new Map([["lb11", [...price(7.49), ...price(7.49, "nbg1")]]]),
  volumePerGb: 0.0572,
  imagePerGb: 0.0143,
  backupPct: 20,
  primaryIp: new Map([["ipv4", [...price(0.5), ...price(0.5, "nbg1"), ...price(0.5, "hel1")]], ["ipv6", price(0)]]),
  floatingIp: new Map([["ipv4", [...price(3), ...price(3, "nbg1")]]]),
};

const loc = (name: string) => ({ location: { name } });
const srv = (id: number, name: string, type: string, l: string, extra: Record<string, unknown> = {}) => ({
  id, name, status: "running", server_type: { name: type, cores: type === "ccx23" ? 4 : type === "cpx31" ? 4 : 2, memory: type === "ccx23" ? 16 : type === "cpx31" ? 8 : 2, disk: type === "cpx11" ? 40 : 160 },
  location: { name: l }, image: { name: "ubuntu-24.04" }, public_net: { ipv4: { ip: `203.0.113.${id % 250}` }, firewalls: [] }, private_net: [], backup_window: null, created: "2026-05-01T10:00:00Z",
  outgoing_traffic: 2e12, included_traffic: 20e12, ...extra,
});
const pip = (id: number, server: number | null, l: string) => ({ id, ip: `203.0.113.${id % 250}`, type: "ipv4", assignee_type: "server", assignee_id: server, location: { name: l }, auto_delete: true });
const fwOn = (ipv4: string, ids: number[]) => ({ ipv4: { ip: ipv4 }, firewalls: ids.map((id) => ({ id })) });
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const empty = { servers: [], volumes: [], networks: [], firewalls: [], loadBalancers: [], floatingIps: [], primaryIps: [], snapshots: [], backups: [], certificates: [], placementGroups: [], storageBoxes: [] };

export function sampleGraph(): InfraGraph {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const accounts = ["Acme GmbH", "Side projects"];
  for (const a of accounts) nodes.push({ id: `a:${a}`, kind: "account", label: a, account: a, monthly: null, flags: [], details: {} });

  const prod = buildProject({ name: "production", account: "Acme GmbH" }, {
    ...empty,
    networks: [{ id: 1, name: "prod-net", ip_range: "10.0.0.0/16", subnets: [{ network_zone: "eu-central" }], servers: [11, 12, 13, 14] }],
    servers: [
      srv(11, "web-1", "cpx31", "fsn1", { private_net: [{ network: 1 }], backup_window: "22-02", public_net: fwOn("203.0.113.11", [41]), outgoing_traffic: 17e12 }),
      srv(12, "web-2", "cpx31", "nbg1", { private_net: [{ network: 1 }], backup_window: "22-02", public_net: fwOn("203.0.113.12", [41]) }),
      srv(13, "db-primary", "ccx23", "fsn1", { private_net: [{ network: 1 }], backup_window: "02-06", public_net: fwOn("203.0.113.13", [42]) }),
      srv(14, "worker", "cpx11", "fsn1", {
        private_net: [{ network: 1 }],
        server_type: { name: "cpx11", cores: 2, memory: 2, disk: 40, locations: [{ name: "fsn1", deprecation: { announced: daysAgo(40), unavailable_after: inDays(60) } }] },
      }),
    ],
    volumes: [
      { id: 21, name: "db-data", size: 200, server: 13, format: "ext4", status: "available", ...loc("fsn1") },
      { id: 22, name: "uploads", size: 100, server: 11, format: "xfs", status: "available", ...loc("fsn1") },
    ],
    loadBalancers: [{ id: 31, name: "prod-lb", load_balancer_type: { name: "lb11" }, ...loc("fsn1"), public_net: { ipv4: { ip: "203.0.113.200" } }, targets: [{ type: "server", server: { id: 11 } }, { type: "server", server: { id: 12 } }], services: [{}, {}], private_net: [{ network: 1 }] }],
    firewalls: [
      { id: 41, name: "web-fw", rules: [
        { direction: "in", protocol: "tcp", port: "443", source_ips: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "22", source_ips: ["0.0.0.0/0"] },
      ], applied_to: [{ type: "server", server: { id: 11 } }, { type: "server", server: { id: 12 } }] },
      { id: 42, name: "db-fw", rules: [{}], applied_to: [{ type: "server", server: { id: 13 } }] },
    ],
    primaryIps: [pip(51, 11, "fsn1"), pip(52, 12, "nbg1"), pip(53, 13, "fsn1"), pip(54, 14, "fsn1")],
    certificates: [
      { id: 61, name: "acme.example", type: "managed", domain_names: ["acme.example", "www.acme.example"], not_valid_after: inDays(70) },
      { id: 62, name: "legacy-partner", type: "uploaded", domain_names: ["partner.acme.example"], not_valid_after: inDays(12) },
    ],
    placementGroups: [{ id: 71, name: "web-spread", type: "spread", servers: [11, 12] }],
    backups: [{ id: 81, description: "db-primary backup", image_size: "38.2", created_from: { id: 13, name: "db-primary" } }],
    snapshots: [{ id: 82, description: "db before 2025 migration", image_size: "44.0", created: daysAgo(210), created_from: { id: 13, name: "db-primary" } }],
  }, pricing);

  const staging = buildProject({ name: "staging", account: "Acme GmbH" }, {
    ...empty,
    servers: [
      srv(111, "staging-app", "cpx11", "fsn1"),
      srv(112, "old-migration-box", "cpx31", "fsn1", { status: "off" }),
    ],
    volumes: [{ id: 121, name: "orphan-disk", size: 250, server: null, status: "available", ...loc("fsn1") }],
    primaryIps: [pip(151, 111, "fsn1"), pip(152, 112, "fsn1"), pip(153, null, "fsn1")],
    floatingIps: [{ id: 161, ip: "203.0.113.90", type: "ipv4", server: null, home_location: { name: "fsn1" } }],
    firewalls: [{ id: 141, name: "staging-fw", rules: [{}], applied_to: [] }],
    snapshots: [{ id: 181, description: "pre-upgrade 2026-03", image_size: "61.7", created_from: { id: 9999, name: "deleted-server" } }],
  }, pricing);

  const blog = buildProject({ name: "blog", account: "Side projects" }, {
    ...empty,
    servers: [srv(211, "blog", "cax21", "hel1", { backup_window: "01-05", public_net: fwOn("203.0.113.211", [241]) })],
    primaryIps: [pip(251, 211, "hel1")],
    firewalls: [{ id: 241, name: "blog-fw", rules: [{ direction: "in", protocol: "tcp", port: "80-443", source_ips: ["0.0.0.0/0"] }], applied_to: [{ type: "server", server: { id: 211 } }] }],
    storageBoxes: [{ id: 291, name: "backups-box", status: "active", location: { name: "hel1" }, storage_box_type: { name: "bx11", size: 1e12, prices: price(3.2, "hel1") } }],
  }, pricing);

  for (const p of [prod, staging, blog]) {
    nodes.push(...p.nodes);
    edges.push(...p.edges);
  }
  nodes.push({
    id: "a:Acme GmbH/robot:1234", kind: "robot_server", label: "ax52-archive", parent: "a:Acme GmbH", account: "Acme GmbH", location: "FSN1-DC14",
    status: "ready", monthly: null, costNote: "The Robot API does not expose prices. See your Robot invoice.", flags: [],
    details: { product: "AX52", ip: "198.51.100.7", paid_until: "2026-10-31" },
  });

  const g = finalize({ source: "sample", currency: "EUR", vatNote: "Gross prices, VAT rate 19%.", nodes, edges, errors: [], projectCount: 3 });
  g.caveats.unshift("SAMPLE DATA. This is an example estate, not your account. Run without --demo to see your own.");
  return g;
}
