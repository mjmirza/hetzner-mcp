/**
 * Cost guard. The single most important safety layer.
 * Reads are always free. Creating certain resources costs money. This module decides
 * whether an operation could incur a charge so the tool layer can require confirmation
 * and show a price first.
 */
import type { SurfaceName, HetznerConfig } from "./config.js";
import { hetznerRequest } from "./http.js";
import { oneLine } from "./text.js";

/** POST to these collection paths creates a resource that is billed by Hetzner. */
const BILLED_CREATE: Record<SurfaceName, RegExp[]> = {
  cloud: [
    /^\/servers\/?$/i,
    /^\/volumes\/?$/i,
    /^\/load_balancers\/?$/i,
    /^\/floating_ips\/?$/i,
    /^\/primary_ips\/?$/i,
  ],
  storagebox: [/^\/storage_boxes\/?$/i],
  robot: [/^\/order\//i],
};

/**
 * Resource actions that increase cost live under /{resource}/{id}/actions/. Creating a
 * snapshot image, upgrading a server type, enabling backups, and resizing a volume up all
 * raise the bill, so the guard requires confirm for them. attach_iso and request_console
 * are free but kept here as a cautious extra confirm.
 *
 * Hetzner Cloud uses enable_backup (singular). enable_backups is kept as a defensive
 * alternate so a pluralized caller still hits the guard.
 */
const BILLED_ACTIONS =
  /\/(actions)\/(create_image|change_type|enable_backups?|resize|attach_iso|request_console)\/?$/i;

/**
 * Free actions that still need an explicit confirm because they interrupt service or
 * rotate credentials. DELETE is always treated as destructive by callers.
 */
const DESTRUCTIVE_FREE_ACTIONS =
  /\/(actions)\/(poweroff|shutdown|reboot|reset|rebuild|reset_password|enable_rescue|disable_backup|detach|unassign|detach_from_network|disable_public_interface|remove_target|delete_service|delete_route|delete_subnet|import_zonefile|set_records|remove_records|change_primary_nameservers|rollback_snapshot|disable_snapshot_plan|reset_subaccount_password|change_home_directory|update_access_settings)\/?$/i;

/**
 * Robot calls that reset, cancel, reinstall or reroute a dedicated server or its addresses.
 * Robot has no /actions/ segment, so these match the whole path.
 */
const ROBOT_DESTRUCTIVE: Array<[RegExp, string]> = [
  [/^\/reset\/[^/]+$/, "hard-resets the dedicated server"],
  [/^\/server\/[^/]+\/cancellation$/, "cancels the dedicated server"],
  [/^\/server\/[^/]+\/reversal$/, "reverses the server order"],
  [/^\/boot\/[^/]+\/(linux|windows|vnc|plesk|cpanel)$/, "reinstalls the server on its next boot, which wipes its disks"],
  [/^\/failover\/[^/]+$/, "reroutes the failover IP to another server"],
  [/^\/(subnet|ip)\/[^/]+\/mac$/, "changes which MAC address the addresses are routed to"],
];

/** Storage Box actions that change what you pay. change_type moves the box to another plan. */
const BILLED_STORAGEBOX_ACTIONS = /\/storage_boxes\/[^/]+\/actions\/change_type$/i;

/** Plain-language reason for each destructive action, so the confirm prompt says what is at stake. */
const DESTRUCTIVE_REASON: Record<string, string> = {
  disable_backup: "deletes all existing automatic backups of this server",
  detach: "disconnects the volume from its server, which can break a running workload",
  unassign: "takes the IP address off its server, which cuts traffic to that address",
  rollback_snapshot: "overwrites the current Storage Box contents with the snapshot",
  import_zonefile: "replaces the DNS records of the zone",
  set_records: "replaces the records of this DNS record set",
  change_primary_nameservers: "changes where the zone is served from",
  update_access_settings: "can cut off SSH, Samba, WebDAV, or external access",
  disable_public_interface: "takes the server off the public internet",
  rebuild: "wipes the server disk and installs a fresh image",
};

// A path echoed in a guard message, bounded to one line so it cannot carry instructions.
const shown = (path: string) => oneLine(path, 120);

export interface CostDecision {
  billed: boolean;
  reason?: string;
}

export interface DestructiveDecision {
  destructive: boolean;
  reason?: string;
}

/**
 * Canonical form of a path for guard matching, so no spelling of a billed endpoint slips
 * past a regex. Strips query and hash, decodes percent-encoding, collapses repeated and
 * trailing slashes, adds the leading slash, and lowercases.
 */
export function normalizeCostPath(path: string): string {
  let clean = String(path ?? "").split("?")[0].split("#")[0].trim();
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(clean);
      if (next === clean) break;
      clean = next.split("?")[0].split("#")[0];
    } catch {
      break;
    }
  }
  // Resolve "." and ".." segments the way the URL parser will before the request is sent,
  // so the guard classifies the same path Hetzner receives.
  const out: string[] = [];
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return ("/" + out.join("/")).toLowerCase();
}

export function classifyCost(surface: SurfaceName, method: string, path: string): CostDecision {
  const m = method.toUpperCase();
  if (m !== "POST" && m !== "PUT") return { billed: false };
  const cleanPath = normalizeCostPath(path);
  for (const re of BILLED_CREATE[surface] ?? []) {
    if (re.test(cleanPath)) return { billed: true, reason: `${m} ${shown(path)} creates a billed ${surface} resource` };
  }
  if (surface === "storagebox" && BILLED_STORAGEBOX_ACTIONS.test(cleanPath)) {
    return { billed: true, reason: `${m} ${shown(path)} changes the Storage Box plan and its price` };
  }
  if (surface === "cloud" && BILLED_ACTIONS.test(cleanPath)) {
    return { billed: true, reason: `${m} ${shown(path)} is an action that can increase your bill` };
  }
  return { billed: false };
}

/**
 * True for DELETE and for free Cloud actions that can take a machine down or rotate
 * root credentials. Billed actions are handled separately by classifyCost.
 */
export function classifyDestructive(method: string, path: string, body?: unknown): DestructiveDecision {
  const m = method.toUpperCase();
  const cleanPath = normalizeCostPath(path);
  if (m === "DELETE") {
    return { destructive: true, reason: `${m} ${shown(path)} permanently deletes a resource and can cause data loss` };
  }
  if (m === "POST" || m === "PUT") {
    const hit = ROBOT_DESTRUCTIVE.find(([re]) => re.test(cleanPath));
    if (hit) return { destructive: true, reason: `${m} ${shown(path)} ${hit[1]}` };
  }
  if (m === "POST" && DESTRUCTIVE_FREE_ACTIONS.test(cleanPath)) {
    const action = cleanPath.split("/").pop() ?? "";
    return {
      destructive: true,
      reason: `${m} ${shown(path)} ${DESTRUCTIVE_REASON[action] ?? "can interrupt service, lose data, or rotate credentials"}`,
    };
  }
  // Turning delete or rebuild protection off removes a safety net. Turning it on is harmless.
  if (m === "POST" && /\/actions\/change_protection$/.test(cleanPath)) {
    const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (Object.values(b).some((v) => v === false)) {
      return { destructive: true, reason: `${m} ${shown(path)} turns protection off, so the resource can then be deleted or rebuilt` };
    }
  }
  // Updating a DNS record set replaces its records.
  if (m === "PUT" && /^\/zones\/[^/]+\/rrsets\//.test(cleanPath)) {
    return { destructive: true, reason: `${m} ${shown(path)} replaces the records of this DNS record set` };
  }
  return { destructive: false };
}

interface PriceRow {
  location?: string;
  price_hourly?: { gross?: string };
  price_monthly?: { gross?: string };
}

function grossNumber(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function priceRow(prices: PriceRow[] | undefined, location?: string): PriceRow | undefined {
  if (!prices?.length) return undefined;
  if (location) return prices.find((p) => p.location === location) ?? prices[0];
  return prices[0];
}

/**
 * Monthly gross for a new primary IP of one version, from a pricing payload the caller
 * already loaded. Null when the catalog has no figure. Zero is a real price (IPv6 often is).
 */
export function primaryIpMonthly(primaryIps: Array<{ type?: string; prices?: PriceRow[] }> | undefined, type: string, location?: string): number | null {
  const row = primaryIps?.find((t) => t.type === type);
  return grossNumber(priceRow(row?.prices, location)?.price_monthly?.gross);
}

/**
 * One sentence for the cost guard when creating a load balancer will also allocate a
 * primary IP. Reused addresses are omitted: they are already billed on their own.
 */
export function describeNewPrimaryIps(opts: {
  allocateV4: boolean;
  allocateV6: boolean;
  ipv4Monthly: number | null;
  ipv6Monthly: number | null;
  currency?: string;
}): string | undefined {
  const currency = opts.currency ?? "EUR";
  const bits: string[] = [];
  if (opts.allocateV4 && opts.ipv4Monthly != null && opts.ipv4Monthly > 0) bits.push(`IPv4 about ${opts.ipv4Monthly.toFixed(2)} ${currency} per month`);
  if (opts.allocateV6 && opts.ipv6Monthly != null && opts.ipv6Monthly > 0) bits.push(`IPv6 about ${opts.ipv6Monthly.toFixed(2)} ${currency} per month`);
  if (!bits.length) return undefined;
  return `A new primary IP is billed on its own, in addition to the load balancer (${bits.join(", ")}, gross).`;
}

export interface LoadBalancerPreview {
  /** Load balancer type monthly gross, before any new primary IP. */
  monthly: number | null;
  hourly: number | null;
  currency: string;
  /** Sentence covering the type price and any new primary IP. Undefined when pricing could not be read. */
  note?: string;
}

/**
 * Live price for a load balancer create, plus any new primary IP the create will allocate.
 * Never throws. A failed pricing read returns empty numbers and no note.
 */
export async function loadBalancerPricePreview(
  cfg: HetznerConfig,
  opts: { loadBalancerType?: string; location?: string; allocateV4: boolean; allocateV6: boolean },
): Promise<LoadBalancerPreview> {
  const empty: LoadBalancerPreview = { monthly: null, hourly: null, currency: "EUR" };
  try {
    const pricing = (await hetznerRequest(cfg, { surface: "cloud", path: "/pricing" })) as {
      pricing?: {
        currency?: string;
        load_balancer_types?: Array<{ name?: string; prices?: PriceRow[] }>;
        primary_ips?: Array<{ type?: string; prices?: PriceRow[] }>;
      };
    };
    const currency = pricing.pricing?.currency || "EUR";
    const match = (pricing.pricing?.load_balancer_types ?? []).find((t) => t.name?.toLowerCase() === opts.loadBalancerType?.toLowerCase());
    const p = priceRow(match?.prices, opts.location);
    const monthly = grossNumber(p?.price_monthly?.gross);
    const hourly = grossNumber(p?.price_hourly?.gross);
    const ipv4Monthly = primaryIpMonthly(pricing.pricing?.primary_ips, "ipv4", opts.location);
    const ipv6Monthly = primaryIpMonthly(pricing.pricing?.primary_ips, "ipv6", opts.location);
    const parts: string[] = [];
    if (opts.loadBalancerType && (hourly != null || monthly != null)) {
      parts.push(
        `Estimated price for ${opts.loadBalancerType}: about ${hourly ?? "?"} ${currency} per hour, ${monthly ?? "?"} ${currency} per month (gross, ${p?.location ?? "first location"}).`,
      );
    }
    const extra = describeNewPrimaryIps({ allocateV4: opts.allocateV4, allocateV6: opts.allocateV6, ipv4Monthly, ipv6Monthly, currency });
    if (extra) parts.push(extra);
    return { monthly, hourly, currency, note: parts.length ? parts.join(" ") : undefined };
  } catch {
    return empty;
  }
}

/**
 * Best-effort live price note for a cloud server create, read from the free pricing endpoint.
 * Never throws. Returns a human-readable string or undefined if it cannot be determined.
 */
export async function cloudServerPriceNote(
  cfg: HetznerConfig,
  serverType: string | undefined,
): Promise<string | undefined> {
  if (!serverType) return undefined;
  try {
    const pricing = (await hetznerRequest(cfg, { surface: "cloud", path: "/pricing" })) as {
      pricing?: { server_types?: Array<{ name?: string; prices?: Array<{ location?: string; price_hourly?: { gross?: string }; price_monthly?: { gross?: string } }> }> };
    };
    const types = pricing.pricing?.server_types ?? [];
    const match = types.find((t) => t.name?.toLowerCase() === serverType.toLowerCase());
    const p = match?.prices?.[0];
    if (!p) return undefined;
    const hourly = p.price_hourly?.gross;
    const monthly = p.price_monthly?.gross;
    return `Estimated price for ${serverType}: about ${hourly ?? "?"} EUR per hour, ${monthly ?? "?"} EUR per month (gross, ${p.location ?? "first location"}).`;
  } catch {
    return undefined;
  }
}
