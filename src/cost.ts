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
 */
const BILLED_ACTIONS =
  /\/(actions)\/(create_image|change_type|enable_backups|resize|attach_iso|request_console)\/?$/i;

export interface CostDecision {
  billed: boolean;
  reason?: string;
}

export function classifyCost(surface: SurfaceName, method: string, path: string): CostDecision {
  const m = method.toUpperCase();
  if (m !== "POST" && m !== "PUT") return { billed: false };

  // Strip query parameters and hash fragments, and normalize leading slash before matching against billing regexes.
  let cleanPath = (path || "").split("?")[0].split("#")[0];
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  for (const re of BILLED_CREATE[surface] ?? []) {
    if (re.test(cleanPath)) return { billed: true, reason: `${m} ${path} creates a billed ${surface} resource` };
  }
  if (surface === "cloud" && BILLED_ACTIONS.test(cleanPath)) {
    return { billed: true, reason: `${m} ${path} is an action that can increase your bill` };
  }
  return { billed: false };
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
