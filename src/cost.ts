/**
 * Cost guard. The single most important safety layer.
 * Reads are always free. Creating certain resources costs money. This module decides
 * whether an operation could incur a charge so the tool layer can require confirmation
 * and show a price first.
 */
import type { SurfaceName, HetznerConfig } from "./config.js";
import { hetznerRequest } from "./http.js";

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
    if (re.test(cleanPath)) return { billed: true, reason: `${m} ${path} creates a billed ${surface} resource` };
  }
  if (surface === "storagebox" && BILLED_STORAGEBOX_ACTIONS.test(cleanPath)) {
    return { billed: true, reason: `${m} ${path} changes the Storage Box plan and its price` };
  }
  if (surface === "cloud" && BILLED_ACTIONS.test(cleanPath)) {
    return { billed: true, reason: `${m} ${path} is an action that can increase your bill` };
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
    return { destructive: true, reason: `${m} ${path} permanently deletes a resource and can cause data loss` };
  }
  if (m === "POST" && DESTRUCTIVE_FREE_ACTIONS.test(cleanPath)) {
    const action = cleanPath.split("/").pop() ?? "";
    return {
      destructive: true,
      reason: `${m} ${path} ${DESTRUCTIVE_REASON[action] ?? "can interrupt service, lose data, or rotate credentials"}`,
    };
  }
  // Turning delete or rebuild protection off removes a safety net. Turning it on is harmless.
  if (m === "POST" && /\/actions\/change_protection$/.test(cleanPath)) {
    const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (Object.values(b).some((v) => v === false)) {
      return { destructive: true, reason: `${m} ${path} turns protection off, so the resource can then be deleted or rebuilt` };
    }
  }
  // Updating a DNS record set replaces its records.
  if (m === "PUT" && /^\/zones\/[^/]+\/rrsets\//.test(cleanPath)) {
    return { destructive: true, reason: `${m} ${path} replaces the records of this DNS record set` };
  }
  return { destructive: false };
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
