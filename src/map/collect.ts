/**
 * Reads every project the user configured and turns it into one graph with an estimated
 * monthly cost per resource. Read-only: only GET requests, never a write.
 *
 * The cost is a list-price estimate from the free /pricing endpoint, not an invoice.
 * Hetzner exposes no Cloud billing API, so traffic overage and partial hours are not counted.
 */
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";
import { defaultAccount, defaultWorkspace, discoverProjects, type ProjectRef } from "./projects.js";
import { settleWithLimit } from "./limit.js";
import { readStored } from "./store.js";
import { finalize } from "./totals.js";
import { targetHealth } from "./status.js";
import type { Flag, InfraGraph, MapEdge, MapNode } from "./types.js";

const waste = (code: string, text: string, monthly: number | null): Flag => ({ kind: "waste", code, text, monthly });
const risk = (code: string, text: string): Flag => ({ kind: "risk", code, text, monthly: null });
const info = (code: string, text: string, monthly: number | null = null): Flag => ({ kind: "info", code, text, monthly });

/** Inbound ports that should almost never be open to the whole internet. */
const SENSITIVE_PORTS: Record<string, string> = {
  "22": "SSH", "3306": "MySQL", "5432": "PostgreSQL", "6379": "Redis", "27017": "MongoDB",
  "9200": "Elasticsearch", "11211": "Memcached", "2375": "Docker API", "5984": "CouchDB",
};
const WORLD = new Set(["0.0.0.0/0", "::/0"]);

/** True when a rule's port spec (single, range, or "any") includes the port. */
function portCovers(spec: string | null | undefined, port: number): boolean {
  if (!spec || spec.trim().toLowerCase() === "any") return true;
  const [a, b] = spec.split("-").map(Number);
  if (!Number.isFinite(a)) return false;
  return b ? port >= a! && port <= b : port === a;
}

const DAY_MS = 86_400_000;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PER_PAGE = 50;

/** How a list was read: pages fetched, and what it covers when Hetzner still had more. */
export interface ListInfo {
  pages: number;
  /** Set when the page limit stopped the read, for example "servers". */
  truncated?: string;
}
const listInfos = new WeakMap<Json[], ListInfo>();
export const listInfo = (list: Json[]): ListInfo | undefined => listInfos.get(list);

export async function listAll(cfg: HetznerConfig, surface: "cloud" | "storagebox", path: string, key: string): Promise<Json[]> {
  const out: Json[] = [];
  const [bare, qs] = path.split("?");
  const extra = Object.fromEntries(new URLSearchParams(qs ?? ""));
  const info: ListInfo = { pages: 0 };
  for (let page = 1; page <= cfg.maxPages; page++) {
    const res = (await hetznerRequest(cfg, { surface, path: bare!, query: { ...extra, page, per_page: PER_PAGE } })) as Json;
    info.pages = page;
    const items = res[key];
    // One push per item: spreading a huge page into push overflows the call stack.
    if (Array.isArray(items)) for (const item of items as Json[]) out.push(item);
    const next = res.meta?.pagination?.next_page;
    if (!next) break;
    if (page === cfg.maxPages) info.truncated = key === "images" ? (extra.type === "backup" ? "backups" : "snapshots") : key.replace(/_/g, " ");
  }
  listInfos.set(out, info);
  return out;
}

/** The caveat for a list cut off by the page limit. */
export function truncatedNote(cfg: HetznerConfig, what: string): string {
  return `Only the first ${(cfg.maxPages * PER_PAGE).toLocaleString("en-US")} ${what} were read; totals are incomplete.`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Monthly gross price for a location from a Hetzner prices array. */
function priceAt(prices: Json[] | undefined, location: string | undefined): number | null {
  if (!prices?.length) return null;
  const p = prices.find((x) => x.location === location) ?? prices[0];
  return num(p?.price_monthly?.gross);
}

export interface Pricing {
  currency: string;
  vatRate: string;
  serverTypes: Map<string, Json[]>;
  lbTypes: Map<string, Json[]>;
  volumePerGb: number | null;
  imagePerGb: number | null;
  backupPct: number | null;
  primaryIp: Map<string, Json[]>;
  floatingIp: Map<string, Json[]>;
}

async function loadPricing(cfg: HetznerConfig): Promise<Pricing> {
  const p = ((await hetznerRequest(cfg, { surface: "cloud", path: "/pricing" })) as Json).pricing as Json;
  return {
    currency: p.currency ?? "EUR",
    vatRate: p.vat_rate ?? "",
    serverTypes: new Map((p.server_types ?? []).map((t: Json) => [t.name, t.prices])),
    lbTypes: new Map((p.load_balancer_types ?? []).map((t: Json) => [t.name, t.prices])),
    volumePerGb: num(p.volume?.price_per_gb_month?.gross),
    imagePerGb: num(p.image?.price_per_gb_month?.gross),
    backupPct: num(p.server_backup?.percentage),
    primaryIp: new Map((p.primary_ips ?? []).map((t: Json) => [t.type, t.prices])),
    floatingIp: new Map((p.floating_ips ?? []).map((t: Json) => [t.type, t.prices])),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Build the nodes and edges for one project. Exported for tests with fixture data. */
export function buildProject(
  ref: { name: string; account: string },
  data: {
    servers: Json[];
    volumes: Json[];
    networks: Json[];
    firewalls: Json[];
    loadBalancers: Json[];
    floatingIps: Json[];
    primaryIps: Json[];
    snapshots: Json[];
    backups: Json[];
    certificates: Json[];
    placementGroups: Json[];
    storageBoxes: Json[];
  },
  pricing: Pricing,
): { nodes: MapNode[]; edges: MapEdge[] } {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const P = `p:${ref.account}/${ref.name}`;
  const base = { project: ref.name, account: ref.account };
  nodes.push({ id: P, kind: "project", label: ref.name, parent: `a:${ref.account}`, monthly: null, details: {}, ...base, flags: [] });

  const locs = new Set<string>();
  const locNode = (loc: string | undefined) => {
    const l = loc || "global";
    const id = `${P}/loc:${l}`;
    if (!locs.has(id)) {
      locs.add(id);
      nodes.push({ id, kind: "location", label: l, parent: P, location: l, monthly: null, details: {}, ...base, flags: [] });
    }
    return id;
  };

  const netIds = new Map<number, string>();
  for (const n of data.networks) {
    const id = `${P}/net:${n.id}`;
    netIds.set(n.id, id);
    nodes.push({
      id, kind: "network", label: n.name, parent: P, monthly: 0, costNote: "Private networks are free.",
      details: { ip_range: n.ip_range ?? null, zone: n.subnets?.[0]?.network_zone ?? null, servers: n.servers?.length ?? 0 },
      ...base, flags: [],
    });
  }

  const serverIds = new Map<number, string>();
  for (const s of data.servers) {
    // Hetzner removed server.datacenter on 2026-07-01; location is the current field.
    const loc = (s.location?.name ?? s.datacenter?.location?.name) as string | undefined;
    const id = `${P}/srv:${s.id}`;
    serverIds.set(s.id, id);
    const type = s.server_type?.name as string | undefined;
    const typePrices = pricing.serverTypes.get(type ?? "") ?? s.server_type?.prices;
    const base$ = priceAt(typePrices, loc);
    let monthly = base$;
    const flags: Flag[] = [];
    const backupsOn = Boolean(s.backup_window);
    let costNote = `${type ?? "unknown type"} list price in ${loc ?? "its location"}.`;
    if (base$ !== null && backupsOn && pricing.backupPct) {
      const surcharge = round((base$ * pricing.backupPct) / 100);
      monthly = base$ + surcharge;
      costNote += ` Includes ${pricing.backupPct}% for automatic backups.`;
      flags.push(info("backup_surcharge", `Automatic backups add ${surcharge.toFixed(2)} a month. Worth it for production, often not for test boxes.`, surcharge));
    }
    if (s.status === "off") flags.push(waste("server_off", "Powered off but still billed in full. Delete it, or snapshot it and delete, to stop the cost.", monthly === null ? null : round(monthly)));

    // Retiring server type, per location first (the top-level field is deprecated).
    const dep = (s.server_type?.locations as Json[] | undefined)?.find((l) => l.name === loc)?.deprecation ?? s.server_type?.deprecation;
    if (dep?.unavailable_after) {
      flags.push(risk("type_retiring", `Server type ${type} is being retired here and stops being available after ${String(dep.unavailable_after).slice(0, 10)}. Plan a move. Changing type switches the server to current pricing.`));
    }

    // Outgoing traffic projected to month end against the included allowance.
    const out = num(s.outgoing_traffic);
    const incl = num(s.included_traffic);
    if (out !== null && incl && incl > 0) {
      const now = new Date();
      const day = Math.max(1, now.getUTCDate());
      const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
      const projected = (out / day) * days;
      const perTb = num((typePrices as Json[] | undefined)?.find((x) => x.location === loc)?.price_per_tb_traffic?.gross ?? (typePrices as Json[] | undefined)?.[0]?.price_per_tb_traffic?.gross);
      if (projected > incl) {
        const overTb = (projected - incl) / 1e12;
        const cost = perTb === null ? null : round(overTb * perTb);
        flags.push(waste("traffic_overage", `Outgoing traffic is on track to pass the included allowance this month (about ${Math.round((projected / incl) * 100)}%). Expected overage about ${overTb.toFixed(2)} TB.`, cost));
      } else if (out / incl > 0.8) {
        flags.push(info("traffic_high", `Already used ${Math.round((out / incl) * 100)}% of this month's included outgoing traffic.`));
      }
    }
    const firstNet = s.private_net?.[0]?.network as number | undefined;
    nodes.push({
      id, kind: "server", label: s.name, parent: firstNet && netIds.has(firstNet) ? netIds.get(firstNet)! : locNode(loc),
      location: loc, status: s.status, monthly: monthly === null ? null : round(monthly), costNote, flags,
      details: {
        type: type ?? null,
        cores: s.server_type?.cores ?? null,
        memory_gb: s.server_type?.memory ?? null,
        disk_gb: s.server_type?.disk ?? null,
        image: s.image?.name ?? s.image?.description ?? null,
        ipv4: s.public_net?.ipv4?.ip ?? null,
        ipv6: s.public_net?.ipv6?.ip ?? null,
        backups: backupsOn,
        firewalls: Array.isArray(s.public_net?.firewalls) ? s.public_net.firewalls.length : null,
        traffic_used_pct: out !== null && incl ? Math.round((out / incl) * 100) : null,
        created: s.created ?? null,
      },
      ...base,
    });
    for (const pn of s.private_net ?? []) {
      const nid = netIds.get(pn.network);
      if (nid) edges.push({ from: id, to: nid, kind: "member" });
    }
  }

  for (const v of data.volumes) {
    const loc = v.location?.name as string | undefined;
    const monthly = pricing.volumePerGb === null ? null : round(pricing.volumePerGb * (v.size ?? 0));
    const flags: Flag[] = [];
    const attachedTo = v.server ? serverIds.get(v.server) : undefined;
    if (!v.server) flags.push(waste("volume_unattached", "Not attached to any server but still billed per GB.", monthly));
    const id = `${P}/vol:${v.id}`;
    nodes.push({
      id, kind: "volume", label: v.name, parent: attachedTo ?? locNode(loc), location: loc, status: v.status,
      monthly, costNote: `${v.size} GB at the per-GB volume price.`, flags,
      details: { size_gb: v.size ?? null, format: v.format ?? null, attached: Boolean(v.server) },
      ...base,
    });
    if (attachedTo) edges.push({ from: id, to: attachedTo, kind: "attached" });
  }

  for (const ip of data.primaryIps) {
    const loc = (ip.location?.name ?? ip.datacenter?.location?.name) as string | undefined;
    const id = `${P}/pip:${ip.id}`;
    const target = ip.assignee_type === "server" && ip.assignee_id ? serverIds.get(ip.assignee_id) : undefined;
    const ipPrice = priceAt(pricing.primaryIp.get(ip.type), loc);
    const flags = ip.assignee_id ? [] : [waste("ip_unassigned", "Unassigned primary IP, still billed. Delete it if you do not need to keep the address.", ipPrice)];
    nodes.push({
      id, kind: "primary_ip", label: ip.ip ?? ip.name, parent: target ?? locNode(loc), location: loc,
      monthly: ipPrice, costNote: `Primary ${ip.type} address.`, flags,
      details: { type: ip.type ?? null, ip: ip.ip ?? null, auto_delete: ip.auto_delete ?? null },
      ...base,
    });
    if (target) edges.push({ from: id, to: target, kind: "assigned" });
  }

  for (const ip of data.floatingIps) {
    const loc = ip.home_location?.name as string | undefined;
    const id = `${P}/fip:${ip.id}`;
    const target = ip.server ? serverIds.get(ip.server) : undefined;
    const fipPrice = priceAt(pricing.floatingIp.get(ip.type), loc);
    const flags = ip.server ? [] : [waste("fip_unassigned", "Floating IP not assigned to a server, still billed.", fipPrice)];
    nodes.push({
      id, kind: "floating_ip", label: ip.ip ?? ip.name, parent: locNode(loc), location: loc,
      monthly: fipPrice, costNote: `Floating ${ip.type} address.`, flags,
      details: { type: ip.type ?? null, ip: ip.ip ?? null },
      ...base,
    });
    if (target) edges.push({ from: id, to: target, kind: "assigned" });
  }

  for (const lb of data.loadBalancers) {
    const loc = lb.location?.name as string | undefined;
    const id = `${P}/lb:${lb.id}`;
    const type = lb.load_balancer_type?.name as string | undefined;
    const targets = (lb.targets ?? []) as Json[];
    const lbPrice = priceAt(pricing.lbTypes.get(type ?? ""), loc);
    const flags = targets.length ? [] : [waste("lb_no_targets", "Load balancer with no targets, billed while serving nothing.", lbPrice)];
    const net = lb.private_net?.[0]?.network as number | undefined;
    nodes.push({
      id, kind: "load_balancer", label: lb.name, parent: net && netIds.has(net) ? netIds.get(net)! : locNode(loc), location: loc,
      monthly: lbPrice, costNote: `${type ?? "load balancer"} list price.`, flags, health: targetHealth(targets),
      details: { type: type ?? null, ipv4: lb.public_net?.ipv4?.ip ?? null, targets: targets.length, services: lb.services?.length ?? 0 },
      ...base,
    });
    for (const t of targets) {
      const sid = t.type === "server" ? serverIds.get(t.server?.id) : undefined;
      if (sid) edges.push({ from: id, to: sid, kind: "routes" });
    }
  }

  const protectedServers = new Set<string>();
  for (const fw of data.firewalls) {
    const id = `${P}/fw:${fw.id}`;
    const applied = (fw.applied_to ?? []) as Json[];
    const fwFlags: Flag[] = applied.length ? [] : [info("fw_unused", "Firewall not applied to anything. Free, but it protects nothing.")];
    const open = new Set<string>();
    for (const r of (fw.rules ?? []) as Json[]) {
      if (r.direction !== "in" || (r.protocol !== "tcp" && r.protocol !== "udp")) continue;
      if (!((r.source_ips ?? []) as string[]).some((ip) => WORLD.has(ip))) continue;
      for (const [port, name] of Object.entries(SENSITIVE_PORTS)) if (portCovers(r.port, Number(port))) open.add(`${name} (${port})`);
    }
    if (open.size) fwFlags.push(risk("fw_open_ports", `Opens ${[...open].join(", ")} to the whole internet. Limit these to your own IP addresses or a private network.`));
    nodes.push({
      id, kind: "firewall", label: fw.name, parent: P, monthly: 0, costNote: "Firewalls are free.",
      flags: fwFlags,
      details: { rules: fw.rules?.length ?? 0, applied_to: applied.length },
      ...base,
    });
    for (const a of applied) {
      const sid = a.type === "server" ? serverIds.get(a.server?.id) : undefined;
      if (sid) {
        edges.push({ from: id, to: sid, kind: "protects" });
        protectedServers.add(sid);
      }
      // Label selectors apply a firewall to every server carrying that label.
      if (a.type === "label_selector") {
        for (const srvSid of (a.applied_to_resources ?? []) as Json[]) {
          const t = srvSid.type === "server" ? serverIds.get(srvSid.server?.id) : undefined;
          if (t) protectedServers.add(t);
        }
      }
    }
  }

  const imageNode = (img: Json, kind: "snapshot" | "backup") => {
    const id = `${P}/img:${img.id}`;
    const size = num(img.image_size) ?? 0;
    const src = img.created_from?.id ? serverIds.get(img.created_from.id) : undefined;
    nodes.push({
      id, kind, label: img.description || `${kind} ${img.id}`, parent: P,
      monthly: pricing.imagePerGb === null || kind === "backup" ? (kind === "backup" ? 0 : null) : round(pricing.imagePerGb * size),
      costNote: kind === "backup" ? "Covered by the server's backup surcharge." : `${size.toFixed(2)} GB at the per-GB image price.`,
      flags: snapshotFlags(img, kind, Boolean(src), pricing.imagePerGb === null ? null : round(pricing.imagePerGb * size)),
      details: { size_gb: size, created: img.created ?? null, from_server: img.created_from?.name ?? null },
      ...base,
    });
    if (src) edges.push({ from: id, to: src, kind: "backs_up" });
  };
  data.snapshots.forEach((i) => imageNode(i, "snapshot"));
  data.backups.forEach((i) => imageNode(i, "backup"));

  for (const c of data.certificates) {
    nodes.push({
      id: `${P}/cert:${c.id}`, kind: "certificate", label: c.name, parent: P, monthly: 0, costNote: "Certificates are free.",
      flags: certFlags(c), details: { type: c.type ?? null, domains: (c.domain_names ?? []).join(", "), expires: c.not_valid_after ?? null },
      ...base,
    });
  }
  for (const g of data.placementGroups) {
    const id = `${P}/pg:${g.id}`;
    nodes.push({ id, kind: "placement_group", label: g.name, parent: P, monthly: 0, costNote: "Placement groups are free.", flags: [], details: { type: g.type ?? null, servers: g.servers?.length ?? 0 }, ...base });
    for (const sidNum of g.servers ?? []) {
      const sid = serverIds.get(sidNum);
      if (sid) edges.push({ from: id, to: sid, kind: "member" });
    }
  }

  for (const b of data.storageBoxes) {
    const loc = b.location?.name as string | undefined;
    nodes.push({
      id: `${P}/sb:${b.id}`, kind: "storage_box", label: b.name ?? `storage box ${b.id}`, parent: P, location: loc, status: b.status,
      monthly: priceAt(b.storage_box_type?.prices, loc), costNote: `${b.storage_box_type?.name ?? "Storage Box"} list price.`,
      flags: [], details: { type: b.storage_box_type?.name ?? null, size_gb: b.storage_box_type?.size ? Math.round(b.storage_box_type.size / 1e9) : null },
      ...base,
    });
  }
  // A public server with no firewall relies entirely on its own configuration.
  for (const n of nodes) {
    const fromServer = n.details.firewalls;
    const unprotected = typeof fromServer === "number" ? fromServer === 0 : !protectedServers.has(n.id);
    if (n.kind === "server" && (n.details.ipv4 || n.details.ipv6) && unprotected) {
      n.flags.push(risk("no_firewall", "No Hetzner firewall is attached and it has a public address. One mistake in its own setup exposes it."));
    }
  }
  return { nodes, edges };
}

function snapshotFlags(img: Json, kind: "snapshot" | "backup", hasServer: boolean, cost: number | null): Flag[] {
  if (kind !== "snapshot") return [];
  if (!hasServer) return [waste("snapshot_orphan", "Snapshot of a server that no longer exists. Keep only if you plan to restore it.", cost)];
  const created = Date.parse(img.created ?? "");
  const ageDays = Number.isFinite(created) ? Math.floor((Date.now() - created) / DAY_MS) : 0;
  return ageDays > 90 ? [waste("snapshot_old", `Snapshot is ${ageDays} days old. Delete it if a newer one or backups cover you.`, cost)] : [];
}

function certFlags(c: Json): Flag[] {
  const end = Date.parse(c.not_valid_after ?? "");
  if (!Number.isFinite(end)) return [];
  const days = Math.floor((end - Date.now()) / DAY_MS);
  if (days < 0) return [risk("cert_expired", `Certificate expired ${-days} days ago.`)];
  // Managed certificates renew themselves, so only warn late for those.
  const limit = c.type === "managed" ? 7 : 30;
  return days <= limit ? [risk("cert_expiring", `Certificate expires in ${days} days${c.type === "managed" ? " and has not renewed yet" : ". Upload a renewed one"}.`)] : [];
}

async function collectProject(ref: ProjectRef, pricing: Pricing): Promise<{ nodes: MapNode[]; edges: MapEdge[]; incomplete?: string[] }> {
  const c = ref.cfg;
  const [servers, volumes, networks, firewalls, loadBalancers, floatingIps, primaryIps, snapshots, backups, certificates, placementGroups] =
    await Promise.all([
      listAll(c, "cloud", "/servers", "servers"),
      listAll(c, "cloud", "/volumes", "volumes"),
      listAll(c, "cloud", "/networks", "networks"),
      listAll(c, "cloud", "/firewalls", "firewalls"),
      listAll(c, "cloud", "/load_balancers", "load_balancers"),
      listAll(c, "cloud", "/floating_ips", "floating_ips"),
      listAll(c, "cloud", "/primary_ips", "primary_ips"),
      listAll(c, "cloud", "/images?type=snapshot", "images"),
      listAll(c, "cloud", "/images?type=backup", "images"),
      listAll(c, "cloud", "/certificates", "certificates"),
      listAll(c, "cloud", "/placement_groups", "placement_groups"),
    ]);
  // Storage Box uses a separate API; a token without that scope must not break the map.
  const storageBoxes = await listAll(c, "storagebox", "/storage_boxes", "storage_boxes").catch(() => []);
  const built = buildProject(ref, { servers, volumes, networks, firewalls, loadBalancers, floatingIps, primaryIps, snapshots, backups, certificates, placementGroups, storageBoxes }, pricing);
  const cut = [servers, volumes, networks, firewalls, loadBalancers, floatingIps, primaryIps, snapshots, backups, certificates, placementGroups, storageBoxes]
    .map((l) => listInfo(l)?.truncated)
    .filter((w): w is string => !!w);
  return cut.length ? { ...built, incomplete: cut.map((w) => truncatedNote(c, w)) } : built;
}

async function collectRobot(cfg: HetznerConfig, account: string): Promise<MapNode[]> {
  if (!cfg.robotUser || !cfg.robotPassword) return [];
  const res = (await hetznerRequest(cfg, { surface: "robot", path: "/server" })) as Json[];
  return (Array.isArray(res) ? res : []).map((row) => {
    const s = row.server ?? row;
    return {
      id: `a:${account}/robot:${s.server_number}`, kind: "robot_server" as const, label: s.server_name || s.server_ip || `#${s.server_number}`,
      parent: `a:${account}`, account, location: s.dc, status: s.status, monthly: null,
      costNote: "The Robot API does not expose prices. See your Robot invoice.",
      flags: s.cancelled ? [info("robot_cancelled", "Cancelled, runs until the paid-until date.")] : [],
      details: { product: s.product ?? null, ip: s.server_ip ?? null, paid_until: s.paid_until ?? null, traffic: s.traffic ?? null },
    };
  });
}

export interface CollectOptions {
  /** Only this workspace. Undefined maps every configured project, as before. */
  workspace?: string;
  /** With workspace, narrows to one project in it. */
  account?: string;
  project?: string;
  /** Projects read at the same time. Each one already makes about a dozen parallel calls. */
  concurrency?: number;
  /** Test seams, so the offline suite never touches the network. */
  collector?: (ref: ProjectRef, pricing: Pricing) => Promise<{ nodes: MapNode[]; edges: MapEdge[]; incomplete?: string[] }>;
  pricingLoader?: (cfg: HetznerConfig) => Promise<Pricing>;
}

export const PROJECT_CONCURRENCY = 4;
export const PRICING_CONCURRENCY = 4;

export async function collectGraph(base: HetznerConfig, env: NodeJS.ProcessEnv = process.env, opts: CollectOptions = {}): Promise<InfraGraph> {
  const all = discoverProjects(base, env, readStored(env));
  const projects = all.filter(
    (p) => (opts.workspace === undefined || p.workspace === opts.workspace) && (opts.account === undefined || p.account === opts.account) && (opts.project === undefined || p.name === opts.project),
  );
  // Robot servers belong to the default account, which lives in the default workspace.
  const withRobot = !!base.robotUser && opts.project === undefined && (opts.workspace === undefined || opts.workspace === defaultWorkspace(env));
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const errors: Array<{ project: string; account: string; error: string }> = [];
  const incomplete: string[] = [];
  const accounts = new Set(projects.map((p) => p.account));
  if (withRobot) accounts.add(defaultAccount(env));
  for (const a of accounts) nodes.push({ id: `a:${a}`, kind: "account", label: a, account: a, monthly: null, flags: [], details: {} });

  // Pricing is the same for every project; probe tokens a few at a time and keep the first that
  // works, so many revoked tokens cannot stall the map for minutes.
  const loadP = opts.pricingLoader ?? loadPricing;
  let pricing: Pricing | undefined;
  let pricingError = "";
  await settleWithLimit(projects, PRICING_CONCURRENCY, async (p) => {
    if (pricing) return;
    try {
      const got = await loadP(p.cfg);
      pricing ??= got;
    } catch (err) {
      pricingError = err instanceof Error ? err.message : String(err);
    }
  });
  const currency = pricing?.currency ?? "EUR";
  const vatRate = pricing?.vatRate ?? "";
  const collect = opts.collector ?? collectProject;
  const results = pricing
    ? await settleWithLimit(projects, opts.concurrency ?? PROJECT_CONCURRENCY, (p) => collect(p, pricing!))
    : projects.map((): PromiseSettledResult<never> => ({ status: "rejected", reason: new Error(pricingError || "Could not load prices.") }));
  results.forEach((r, i) => {
    const ref = projects[i]!;
    if (r.status === "fulfilled") {
      for (const n of r.value.nodes) nodes.push(n);
      for (const e of r.value.edges) edges.push(e);
      const cut = r.value.incomplete;
      if (cut?.length) {
        const projectNode = r.value.nodes.find((n) => n.kind === "project");
        if (projectNode) {
          projectNode.details.incomplete = true;
          for (const text of cut) projectNode.flags.push(info("list_incomplete", text));
        }
        for (const text of cut) incomplete.push(`Project ${ref.name}: ${text}`);
      }
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push({ project: ref.name, account: ref.account, error: msg });
      nodes.push({ id: `p:${ref.account}/${ref.name}`, kind: "project", label: ref.name, parent: `a:${ref.account}`, project: ref.name, account: ref.account, monthly: null, flags: [risk("project_unreadable", `Could not read this project. ${msg}`)], details: {} });
    }
  });
  const robotAccount = defaultAccount(env);
  if (withRobot) {
    try {
      nodes.push(...(await collectRobot(base, robotAccount)));
    } catch (err) {
      errors.push({ project: "robot", account: robotAccount, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const graph = finalize({
    source: "live",
    currency,
    vatNote: vatRate ? `Gross prices, VAT rate ${Number(vatRate)}%.` : "Gross list prices.",
    nodes,
    edges,
    errors,
    projectCount: projects.length,
  });
  for (const text of incomplete) graph.caveats.push(text);
  if (opts.workspace !== undefined) graph.workspace = opts.workspace;
  return graph;
}
