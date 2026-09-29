// Create, delete and connect from the map. Every call re-validates on the server, re-prices,
// and applies the same cost, read-only and destructive guards as the MCP tools.
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";
import { classifyCost } from "../cost.js";
import { waitForActions } from "../actions.js";
import { capacityRows } from "../tools/capacity.js";
import { deletionPreview } from "../tools/delete-preview.js";
import { discoverProjects, type ProjectRef } from "./projects.js";
import { readStored, removeStoredAsync, saveStoredAsync } from "./store.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class ActionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ActionEnv {
  base: HetznerConfig;
  env: NodeJS.ProcessEnv;
  demo: boolean;
}

export const CREATE_KINDS = ["server", "volume", "network", "firewall", "load_balancer", "primary_ip", "floating_ip", "placement_group"] as const;
type CreateKind = (typeof CREATE_KINDS)[number];

const NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;
export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
export const ACCOUNT = /^[^/\u0000-\u001f]{1,60}$/;
/** Shortest API token accepted. The CLI masks anything shorter completely. */
export const TOKEN_MIN_LENGTH = 20;
export const TOKEN = new RegExp(`^[A-Za-z0-9]{${TOKEN_MIN_LENGTH},128}$`);
const ID = /^[0-9]{1,15}$/;
const CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

const projectsOf = (a: ActionEnv) => discoverProjects(a.base, a.env, readStored(a.env));

export function projectById(a: ActionEnv, projectNodeId: string): ProjectRef {
  const ref = projectsOf(a).find((p) => `p:${p.account}/${p.name}` === projectNodeId);
  if (!ref) throw new ActionError(404, "That project is not connected.");
  return ref;
}

export function meta(a: ActionEnv) {
  return {
    mode: a.demo ? "demo" : "live",
    readOnly: a.base.readOnly,
    allowBilled: a.base.allowBilled,
    projects: projectsOf(a).map((p) => ({ id: `p:${p.account}/${p.name}`, name: p.name, account: p.account, workspace: p.workspace, source: p.source })),
  };
}

function str(v: unknown, field: string, re: RegExp): string {
  if (typeof v !== "string" || !re.test(v.trim())) throw new ActionError(400, `${field} is not valid.`);
  return v.trim();
}
const optId = (v: unknown, field: string) => (v === undefined || v === null || v === "" ? undefined : Number(str(String(v), field, ID)));

// ---- Catalog (what the create form offers), cached per project for five minutes ----

const catalogCache = new Map<string, { at: number; data: Json }>();

export async function catalog(ref: ProjectRef): Promise<Json> {
  const key = `${ref.account}/${ref.name}`;
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < 300_000) return hit.data;
  const cloud = (path: string, query?: Record<string, string | number>) => hetznerRequest(ref.cfg, { surface: "cloud", path, query }) as Promise<Json>;
  const [locs, types, imgs, keys, nets, fws, srvs, pricing] = await Promise.all([
    cloud("/locations"),
    cloud("/server_types", { per_page: 50 }),
    cloud("/images", { type: "system", status: "available", per_page: 50 }),
    cloud("/ssh_keys", { per_page: 50 }),
    cloud("/networks", { per_page: 50 }),
    cloud("/firewalls", { per_page: 50 }),
    cloud("/servers", { per_page: 50 }),
    cloud("/pricing"),
  ]);
  const p = pricing.pricing ?? {};
  const monthlyOf = (prices: Json[] | undefined) => {
    const v = Number(prices?.[0]?.price_monthly?.gross);
    return Number.isFinite(v) ? v : null;
  };
  const data = {
    currency: p.currency ?? "EUR",
    volumePerGb: Number.isFinite(Number(p.volume?.price_per_gb_month?.gross)) ? Number(p.volume.price_per_gb_month.gross) : null,
    locations: (locs.locations ?? []).map((l: Json) => ({ name: l.name, city: l.city ?? l.name, zone: l.network_zone ?? "" })),
    serverTypes: capacityRows(types.server_types ?? []).filter((r) => r.available),
    images: (imgs.images ?? [])
      .filter((i: Json) => i.name && !i.deprecated && !i.deprecation)
      .map((i: Json) => ({ name: i.name, description: i.description ?? i.name, architecture: i.architecture ?? "x86" })),
    sshKeys: (keys.ssh_keys ?? []).map((k: Json) => ({ id: k.id, name: k.name })),
    networks: (nets.networks ?? []).map((n: Json) => ({ id: n.id, name: n.name, ip_range: n.ip_range })),
    firewalls: (fws.firewalls ?? []).map((f: Json) => ({ id: f.id, name: f.name })),
    servers: (srvs.servers ?? []).map((s: Json) => ({ id: s.id, name: s.name, location: s.location?.name ?? "" })),
    loadBalancerTypes: (p.load_balancer_types ?? []).map((t: Json) => ({ name: t.name, monthly: monthlyOf(t.prices) })),
    _pricing: p,
  };
  catalogCache.set(key, { at: Date.now(), data });
  return data;
}

export const publicCatalog = (c: Json) => {
  const { _pricing, ...rest } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

// ---- Plan: turn form input into one exact Hetzner request plus its price ----

interface Planned {
  label: string;
  path: string;
  body: Json;
  billed: boolean;
  monthly: number | null;
  currency: string;
  notes: string[];
  blocked?: string;
}

function priceAt(prices: Json[] | undefined, location?: string): number | null {
  const row = (prices ?? []).find((x) => !location || x.location === location) ?? prices?.[0];
  const v = Number(row?.price_monthly?.gross);
  return Number.isFinite(v) ? v : null;
}

function firewallRules(preset: string): Json[] {
  const open = (port: string) => ({ direction: "in", protocol: "tcp", port, source_ips: ["0.0.0.0/0", "::/0"] });
  if (preset === "none") return [];
  if (preset === "web-ssh") return [open("80"), open("443"), open("22")];
  return [open("80"), open("443")];
}

function subnetOf(range: string): string {
  const m = CIDR.exec(range)!;
  const prefix = Math.max(Number(m[5]), 24);
  return `${m[1]}.${m[2]}.${m[3]}.0/${prefix}`;
}

export async function plan(a: ActionEnv, ref: ProjectRef, kindIn: unknown, params: Json): Promise<Planned> {
  if (typeof kindIn !== "string" || !(CREATE_KINDS as readonly string[]).includes(kindIn)) throw new ActionError(400, "That resource type cannot be created here.");
  const kind = kindIn as CreateKind;
  const c = await catalog(ref);
  const p = c._pricing as Json;
  const name = str(params.name, "Name", NAME);
  const locNames = new Set((c.locations as Json[]).map((l) => l.name));
  const location = params.location ? str(params.location, "Location", /^[a-z0-9-]{2,20}$/) : undefined;
  if (location && !locNames.has(location)) throw new ActionError(400, "That location does not exist in this project.");
  const server = optId(params.server, "Server");
  const serverName = server ? (c.servers as Json[]).find((s) => s.id === server)?.name : undefined;
  if (server && !serverName) throw new ActionError(400, "That server is not in this project.");
  const notes: string[] = [];
  let out: Omit<Planned, "billed" | "currency" | "blocked">;

  switch (kind) {
    case "server": {
      if (!location) throw new ActionError(400, "Choose a location.");
      const type = str(params.server_type, "Type", /^[a-z0-9-]{2,20}$/);
      const row = (c.serverTypes as Json[]).find((r) => r.type === type && r.location === location);
      if (!row) throw new ActionError(400, `${type} cannot be ordered in ${location} right now.`);
      const image = str(params.image, "Image", /^[a-z0-9.-]{2,40}$/);
      if (!(c.images as Json[]).some((i) => i.name === image)) throw new ActionError(400, "That image is not available.");
      const keys = Array.isArray(params.ssh_keys) ? params.ssh_keys.map((k: unknown) => Number(str(String(k), "SSH key", ID))) : [];
      const net = optId(params.network, "Network");
      const fw = optId(params.firewall, "Firewall");
      if (!keys.length) notes.push("No SSH key. Hetzner emails a root password to the account owner.");
      if (row.retiring_after) notes.push(`This type is being retired after ${String(row.retiring_after).slice(0, 10)}.`);
      notes.push("Billed hourly, capped at the monthly price. It keeps billing while powered off.");
      out = {
        label: `${type.toUpperCase()} in ${location}, ${row.cores} vCPU, ${row.memory_gb} GB`,
        path: "/servers",
        body: { name, server_type: type, image, location, start_after_create: true, ssh_keys: keys.length ? keys : undefined, networks: net ? [net] : undefined, firewalls: fw ? [{ firewall: fw }] : undefined },
        monthly: row.monthly,
        notes,
      };
      break;
    }
    case "volume": {
      const size = Number(params.size);
      if (!Number.isInteger(size) || size < 10 || size > 10240) throw new ActionError(400, "Size must be a whole number from 10 to 10240 GB.");
      if (!location && !server) throw new ActionError(400, "Choose a location or a server to attach to.");
      const per = Number(p.volume?.price_per_gb_month?.gross);
      notes.push(server ? `Formatted ext4 and mounted on ${serverName}.` : "Created empty. Attach it to a server later.");
      out = {
        label: `${size} GB volume${server ? ` on ${serverName}` : ` in ${location}`}`,
        path: "/volumes",
        body: { name, size, location: server ? undefined : location, server, format: "ext4", automount: server ? true : undefined },
        monthly: Number.isFinite(per) ? Math.round(per * size * 100) / 100 : null,
        notes,
      };
      break;
    }
    case "network": {
      const range = str(params.ip_range ?? "10.0.0.0/16", "IP range", CIDR);
      out = {
        label: `Private network ${range}`,
        path: "/networks",
        body: { name, ip_range: range, subnets: [{ type: "cloud", network_zone: "eu-central", ip_range: subnetOf(range) }] },
        monthly: 0,
        notes: ["Adds one eu-central subnet (Falkenstein, Nuremberg, Helsinki)."],
      };
      break;
    }
    case "firewall": {
      const preset = ["web", "web-ssh", "none"].includes(String(params.preset)) ? String(params.preset) : "web";
      if (preset === "web-ssh") notes.push("SSH open to the whole internet. Narrow it to your IP in the Console when you can.");
      out = {
        label: `Firewall, ${preset === "none" ? "no inbound rules" : preset === "web" ? "HTTP and HTTPS" : "HTTP, HTTPS and SSH"}${serverName ? ` on ${serverName}` : ""}`,
        path: "/firewalls",
        body: { name, rules: firewallRules(preset), apply_to: server ? [{ type: "server", server: { id: server } }] : undefined },
        monthly: 0,
        notes,
      };
      break;
    }
    case "load_balancer": {
      if (!location) throw new ActionError(400, "Choose a location.");
      const type = str(params.load_balancer_type, "Type", /^[a-z0-9-]{2,20}$/);
      const t = (p.load_balancer_types ?? []).find((x: Json) => x.name === type);
      if (!t) throw new ActionError(400, "That load balancer type does not exist.");
      notes.push("Add a service (for example HTTP on port 80) in the Console before it carries traffic.");
      out = {
        label: `${type.toUpperCase()} load balancer in ${location}${serverName ? `, to ${serverName}` : ""}`,
        path: "/load_balancers",
        body: { name, load_balancer_type: type, location, targets: server ? [{ type: "server", server: { id: server } }] : undefined },
        monthly: priceAt(t.prices, location),
        notes,
      };
      break;
    }
    case "primary_ip": {
      if (!location) throw new ActionError(400, "Choose a location.");
      const t = (p.primary_ips ?? []).find((x: Json) => x.type === "ipv4");
      notes.push("Kept when a server is deleted, so it keeps billing until you delete it.");
      out = { label: `IPv4 in ${location}`, path: "/primary_ips", body: { name, type: "ipv4", assignee_type: "server", location, auto_delete: false }, monthly: priceAt(t?.prices, location), notes };
      break;
    }
    case "floating_ip": {
      if (!location) throw new ActionError(400, "Choose a location.");
      const t = (p.floating_ips ?? []).find((x: Json) => x.type === "ipv4");
      out = { label: `Floating IPv4, home ${location}${serverName ? `, on ${serverName}` : ""}`, path: "/floating_ips", body: { name, type: "ipv4", home_location: location, server, description: name }, monthly: priceAt(t?.prices, location), notes };
      break;
    }
    case "placement_group": {
      out = { label: "Spread placement group", path: "/placement_groups", body: { name, type: "spread" }, monthly: 0, notes: ["Servers in it land on separate physical hosts."] };
      break;
    }
  }

  for (const [k, v] of Object.entries(out.body)) if (v === undefined) delete out.body[k];
  const billed = classifyCost("cloud", "POST", out.path).billed;
  let blocked: string | undefined;
  if (a.demo) blocked = "This is sample data. Start the live map to create real resources.";
  else if (a.base.readOnly) blocked = "Read-only mode is on (HETZNER_MCP_READONLY=1).";
  else if (billed && !a.base.allowBilled) blocked = "Billed creates are off. Restart the map with HETZNER_MCP_ALLOW_BILLED=1 to allow them.";
  return { ...out, billed, currency: c.currency, blocked };
}

export async function apply(a: ActionEnv, ref: ProjectRef, kind: unknown, params: Json, confirm: unknown): Promise<string> {
  const pl = await plan(a, ref, kind, params);
  if (pl.blocked) throw new ActionError(403, pl.blocked);
  if (confirm !== true) throw new ActionError(400, "Confirmation missing.");
  const res = await hetznerRequest(ref.cfg, { surface: "cloud", method: "POST", path: pl.path, body: pl.body });
  catalogCache.delete(`${ref.account}/${ref.name}`);
  const actions = await waitForActions(ref.cfg, res, { budgetMs: Math.min(ref.cfg.actionWaitMs, 90_000) });
  const failed = actions.find((x) => x.status === "error");
  if (failed) throw new ActionError(502, `Hetzner reported an error: ${failed.error ?? failed.command}.`);
  const running = actions.some((x) => x.status === "running");
  return `${pl.label} created${running ? ", still finishing at Hetzner" : ""}.`;
}

// ---- Delete ----

const KIND_PATH: Record<string, string> = { srv: "servers", vol: "volumes", net: "networks", fw: "firewalls", lb: "load_balancers", fip: "floating_ips", pip: "primary_ips", pg: "placement_groups", img: "images", cert: "certificates" };
const NODE = /^p:(.+)\/([^/]+)\/(srv|vol|net|fw|lb|fip|pip|pg|img|cert):([0-9]{1,15})$/;

async function target(a: ActionEnv, nodeId: unknown) {
  const m = typeof nodeId === "string" ? NODE.exec(nodeId) : null;
  if (!m) throw new ActionError(400, "That item cannot be deleted from the map.");
  const ref = projectById(a, `p:${m[1]}/${m[2]}`);
  const collection = KIND_PATH[m[3]!]!;
  const path = `/${collection}/${m[4]}`;
  const res = (await hetznerRequest(ref.cfg, { surface: "cloud", path })) as Json;
  const obj = Object.values(res)[0] as Json;
  const name = String(obj?.name ?? obj?.description ?? obj?.ip ?? m[4]);
  return { ref, path, obj, name, code: m[3]! };
}

export async function deletePlan(a: ActionEnv, nodeId: unknown) {
  const t = await target(a, nodeId);
  const notes = ["Deleting is permanent. Hetzner stops billing it from the next hour."];
  let blocked: string | undefined;
  if (t.obj?.protection?.delete) blocked = "Delete protection is on. Turn it off in the Hetzner Console first.";
  if (t.code === "vol" && t.obj?.server) blocked = "This volume is attached. Detach it from its server first.";
  if (t.code === "pip" && t.obj?.assignee_id) blocked = "This IP is assigned to a server. Unassign it first.";
  if (t.code === "srv") {
    const survivors = await deletionPreview(t.ref.cfg, t.obj.id);
    notes.push("The server disk is erased.");
    if (survivors) notes.push(survivors);
  }
  if (t.code === "net") notes.push("Servers in this network lose their private address.");
  if (a.demo) blocked = "This is sample data. Nothing can be deleted here.";
  else if (a.base.readOnly) blocked = "Read-only mode is on (HETZNER_MCP_READONLY=1).";
  return { name: t.name, label: t.path, notes, blocked };
}

export async function deleteNode(a: ActionEnv, nodeId: unknown, typed: unknown): Promise<string> {
  if (a.demo) throw new ActionError(403, "This is sample data. Nothing can be deleted here.");
  if (a.base.readOnly) throw new ActionError(403, "Read-only mode is on (HETZNER_MCP_READONLY=1).");
  const pl = await deletePlan(a, nodeId);
  if (pl.blocked) throw new ActionError(409, pl.blocked);
  if (typed !== pl.name) throw new ActionError(400, "The name you typed does not match.");
  const t = await target(a, nodeId);
  const res = await hetznerRequest(t.ref.cfg, { surface: "cloud", method: "DELETE", path: t.path });
  await waitForActions(t.ref.cfg, res, { budgetMs: Math.min(t.ref.cfg.actionWaitMs, 60_000) });
  catalogCache.delete(`${t.ref.account}/${t.ref.name}`);
  return `${t.name} deleted.`;
}

// ---- Connect a project (Hetzner has no API to create one) ----

export async function connectProject(a: ActionEnv, body: Json): Promise<string> {
  if (a.demo) throw new ActionError(403, "This is sample data. Start the live map to connect a project.");
  const name = str(body.name, "Project name", PROJECT_NAME);
  const account = typeof body.account === "string" && body.account.trim() ? str(body.account, "Account", ACCOUNT) : a.env.HETZNER_ACCOUNT_NAME?.trim() || "Hetzner account";
  const token = str(body.token, "API token", TOKEN);
  const workspace = typeof body.workspace === "string" && body.workspace.trim() ? str(body.workspace, "Workspace", ACCOUNT) : undefined;
  const existing = projectsOf(a);
  if (existing.some((p) => p.cfg.cloudToken === token)) throw new ActionError(409, "That token is already connected.");
  if (existing.some((p) => p.name === name && p.account === account && p.source === "env")) throw new ActionError(409, "A project with that name comes from your environment settings.");
  try {
    await hetznerRequest({ ...a.base, cloudToken: token, readOnly: true }, { surface: "cloud", path: "/servers", query: { per_page: 1 } });
  } catch (err) {
    const status = (err as { status?: number }).status;
    throw new ActionError(400, status === 401 || status === 403 ? "Hetzner rejected this token. Copy it again from the project." : "Could not reach Hetzner to check the token. Try again.");
  }
  await saveStoredAsync(a.env, { name, account, token, ...(workspace ? { workspace } : {}) });
  return `Connected ${name}. The token checked out with Hetzner and is saved only on this computer.`;
}

export async function disconnectProject(a: ActionEnv, projectNodeId: unknown): Promise<string> {
  const ref = projectById(a, String(projectNodeId));
  if (ref.source !== "local") throw new ActionError(400, "This project comes from your environment settings. Remove it there.");
  await removeStoredAsync(a.env, ref.account, ref.name);
  return `Disconnected ${ref.name}. Nothing at Hetzner changed.`;
}
