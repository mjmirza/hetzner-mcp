/**
 * Reads every project the user configured and turns it into one graph with an estimated
 * monthly cost per resource. Read-only: only GET requests, never a write.
 *
 * The cost is a list-price estimate from the free /pricing endpoint, not an invoice.
 * Hetzner exposes no Cloud billing API, so traffic overage and partial hours are not counted.
 */
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";
import { discoverProjects, type ProjectRef } from "./projects.js";
import { finalize } from "./totals.js";
import type { InfraGraph, MapEdge, MapNode } from "./types.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function listAll(cfg: HetznerConfig, surface: "cloud" | "storagebox", path: string, key: string): Promise<Json[]> {
  const out: Json[] = [];
  const [bare, qs] = path.split("?");
  const extra = Object.fromEntries(new URLSearchParams(qs ?? ""));
  for (let page = 1; page <= cfg.maxPages; page++) {
    const res = (await hetznerRequest(cfg, { surface, path: bare!, query: { ...extra, page, per_page: 50 } })) as Json;
    const items = (res[key] as Json[] | undefined) ?? [];
    out.push(...items);
    const next = res.meta?.pagination?.next_page;
    if (!next) break;
  }
  return out;
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

interface Pricing {
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

  const locNode = (loc: string | undefined) => {
    const l = loc || "global";
    const id = `${P}/loc:${l}`;
    if (!nodes.some((n) => n.id === id)) {
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
    const loc = s.datacenter?.location?.name as string | undefined;
    const id = `${P}/srv:${s.id}`;
    serverIds.set(s.id, id);
    const type = s.server_type?.name as string | undefined;
    let monthly = priceAt(pricing.serverTypes.get(type ?? "") ?? s.server_type?.prices, loc);
    const flags: string[] = [];
    const backupsOn = Boolean(s.backup_window);
    let costNote = `${type ?? "unknown type"} list price in ${loc ?? "its location"}.`;
    if (monthly !== null && backupsOn && pricing.backupPct) {
      monthly = monthly * (1 + pricing.backupPct / 100);
      costNote += ` Includes ${pricing.backupPct}% for automatic backups.`;
    }
    if (s.status === "off") flags.push("Powered off but still billed in full. Delete it or snapshot and delete to stop the cost.");
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
    const flags: string[] = [];
    const attachedTo = v.server ? serverIds.get(v.server) : undefined;
    if (!v.server) flags.push("Not attached to any server but still billed per GB.");
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
    const loc = ip.datacenter?.location?.name as string | undefined;
    const id = `${P}/pip:${ip.id}`;
    const target = ip.assignee_type === "server" && ip.assignee_id ? serverIds.get(ip.assignee_id) : undefined;
    const flags = ip.assignee_id ? [] : ["Unassigned primary IP, still billed. Delete it if you do not need to keep the address."];
    nodes.push({
      id, kind: "primary_ip", label: ip.ip ?? ip.name, parent: target ?? locNode(loc), location: loc,
      monthly: priceAt(pricing.primaryIp.get(ip.type), loc), costNote: `Primary ${ip.type} address.`, flags,
      details: { type: ip.type ?? null, ip: ip.ip ?? null, auto_delete: ip.auto_delete ?? null },
      ...base,
    });
    if (target) edges.push({ from: id, to: target, kind: "assigned" });
  }

  for (const ip of data.floatingIps) {
    const loc = ip.home_location?.name as string | undefined;
    const id = `${P}/fip:${ip.id}`;
    const target = ip.server ? serverIds.get(ip.server) : undefined;
    const flags = ip.server ? [] : ["Floating IP not assigned to a server, still billed."];
    nodes.push({
      id, kind: "floating_ip", label: ip.ip ?? ip.name, parent: locNode(loc), location: loc,
      monthly: priceAt(pricing.floatingIp.get(ip.type), loc), costNote: `Floating ${ip.type} address.`, flags,
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
    const flags = targets.length ? [] : ["Load balancer with no targets, billed while serving nothing."];
    const net = lb.private_net?.[0]?.network as number | undefined;
    nodes.push({
      id, kind: "load_balancer", label: lb.name, parent: net && netIds.has(net) ? netIds.get(net)! : locNode(loc), location: loc,
      monthly: priceAt(pricing.lbTypes.get(type ?? ""), loc), costNote: `${type ?? "load balancer"} list price.`, flags,
      details: { type: type ?? null, ipv4: lb.public_net?.ipv4?.ip ?? null, targets: targets.length, services: lb.services?.length ?? 0 },
      ...base,
    });
    for (const t of targets) {
      const sid = t.type === "server" ? serverIds.get(t.server?.id) : undefined;
      if (sid) edges.push({ from: id, to: sid, kind: "routes" });
    }
  }

  for (const fw of data.firewalls) {
    const id = `${P}/fw:${fw.id}`;
    const applied = (fw.applied_to ?? []) as Json[];
    nodes.push({
      id, kind: "firewall", label: fw.name, parent: P, monthly: 0, costNote: "Firewalls are free.",
      flags: applied.length ? [] : ["Firewall not applied to anything. Free, but it protects nothing."],
      details: { rules: fw.rules?.length ?? 0, applied_to: applied.length },
      ...base,
    });
    for (const a of applied) {
      const sid = a.type === "server" ? serverIds.get(a.server?.id) : undefined;
      if (sid) edges.push({ from: id, to: sid, kind: "protects" });
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
      flags: kind === "snapshot" && !src ? ["Snapshot of a server that no longer exists. Keep only if you plan to restore it."] : [],
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
      flags: [], details: { type: c.type ?? null, domains: (c.domain_names ?? []).join(", "), expires: c.not_valid_after ?? null },
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
  return { nodes, edges };
}

async function collectProject(ref: ProjectRef, pricing: Pricing) {
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
  return buildProject(ref, { servers, volumes, networks, firewalls, loadBalancers, floatingIps, primaryIps, snapshots, backups, certificates, placementGroups, storageBoxes }, pricing);
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
      flags: s.cancelled ? ["Cancelled, runs until the paid-until date."] : [],
      details: { product: s.product ?? null, ip: s.server_ip ?? null, paid_until: s.paid_until ?? null, traffic: s.traffic ?? null },
    };
  });
}

export async function collectGraph(base: HetznerConfig, env: NodeJS.ProcessEnv = process.env): Promise<InfraGraph> {
  const projects = discoverProjects(base, env);
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const errors: Array<{ project: string; account: string; error: string }> = [];
  const accounts = new Set(projects.map((p) => p.account));
  if (base.robotUser) accounts.add(env.HETZNER_ACCOUNT_NAME?.trim() || "Hetzner account");
  for (const a of accounts) nodes.push({ id: `a:${a}`, kind: "account", label: a, account: a, monthly: null, flags: [], details: {} });

  let pricing: Pricing | undefined;
  let currency = "EUR";
  let vatRate = "";
  if (projects[0]) {
    pricing = await loadPricing(projects[0].cfg);
    currency = pricing.currency;
    vatRate = pricing.vatRate;
  }
  const results = await Promise.allSettled(projects.map((p) => collectProject(p, pricing!)));
  results.forEach((r, i) => {
    const ref = projects[i]!;
    if (r.status === "fulfilled") {
      nodes.push(...r.value.nodes);
      edges.push(...r.value.edges);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push({ project: ref.name, account: ref.account, error: msg });
      nodes.push({ id: `p:${ref.account}/${ref.name}`, kind: "project", label: ref.name, parent: `a:${ref.account}`, project: ref.name, account: ref.account, monthly: null, flags: [`Could not read this project. ${msg}`], details: {} });
    }
  });
  const robotAccount = env.HETZNER_ACCOUNT_NAME?.trim() || "Hetzner account";
  try {
    nodes.push(...(await collectRobot(base, robotAccount)));
  } catch (err) {
    errors.push({ project: "robot", account: robotAccount, error: err instanceof Error ? err.message : String(err) });
  }

  return finalize({
    source: "live",
    currency,
    vatNote: vatRate ? `Gross prices, VAT rate ${Number(vatRate)}%.` : "Gross list prices.",
    nodes,
    edges,
    errors,
    projectCount: projects.length,
  });
}
