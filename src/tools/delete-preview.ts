/**
 * What survives a server delete. Hetzner deletes the server's backups with it, but keeps
 * primary IPs without auto_delete, attached volumes, and snapshots, and keeps billing them.
 * Read-only and best effort: returns an empty string if anything cannot be read.
 *
 * Each list is paged. Hetzner returns at most 50 items per response, so stopping after
 * the first page hides a primary IP or snapshot that would keep billing.
 */
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PER_PAGE = 50;

export function describeSurvivors(server: Json, primaryIps: Json[], snapshots: Json[], backups: Json[]): string {
  const keep: string[] = [];
  const lose: string[] = [];
  for (const ip of primaryIps) {
    if (ip.assignee_id === server.id && ip.auto_delete === false) {
      keep.push(`primary IP ${ip.ip ?? ip.name} (auto delete is off, it keeps billing)`);
    }
  }
  for (const v of (server.volumes ?? []) as Array<number | Json>) {
    const vid = typeof v === "number" ? v : v.id;
    keep.push(`volume ${vid} (detached, not deleted, it keeps billing)`);
  }
  const snaps = snapshots.filter((i) => i.created_from?.id === server.id);
  if (snaps.length) keep.push(`${snaps.length} snapshot(s) of this server (they keep billing per GB)`);
  const bks = backups.filter((i) => i.created_from?.id === server.id);
  if (bks.length) lose.push(`${bks.length} automatic backup(s), deleted together with the server`);
  const parts: string[] = [];
  if (keep.length) parts.push(`Stays after the delete: ${keep.join("; ")}.`);
  if (lose.length) parts.push(`Lost with it: ${lose.join("; ")}. Take a snapshot first if you may need them.`);
  return parts.join(" ");
}

/** One collection, following meta.pagination until it ends or the page cap is hit. */
async function listCollection(
  cfg: HetznerConfig,
  path: string,
  key: string,
  query: Record<string, string | number>,
): Promise<{ items: Json[]; truncated: boolean }> {
  const items: Json[] = [];
  for (let page = 1; page <= cfg.maxPages; page++) {
    const res = (await hetznerRequest(cfg, { surface: "cloud", path, query: { ...query, page, per_page: PER_PAGE } })) as Json;
    const batch = res[key];
    if (Array.isArray(batch)) for (const item of batch as Json[]) items.push(item);
    if (!res.meta?.pagination?.next_page) return { items, truncated: false };
  }
  return { items, truncated: true };
}

function incompleteNote(cfg: HetznerConfig, names: string[]): string {
  const list = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `Only the first ${(cfg.maxPages * PER_PAGE).toLocaleString("en-US")} ${list} were checked; more may keep billing.`;
}

export async function deletionPreview(cfg: HetznerConfig, serverId: string | number): Promise<string> {
  try {
    const id = encodeURIComponent(String(serverId));
    const [srv, pips, snaps, bks] = await Promise.all([
      hetznerRequest(cfg, { surface: "cloud", path: `/servers/${id}` }) as Promise<Json>,
      listCollection(cfg, "/primary_ips", "primary_ips", {}),
      listCollection(cfg, "/images", "images", { type: "snapshot" }),
      listCollection(cfg, "/images", "images", { type: "backup" }),
    ]);
    const text = describeSurvivors(srv.server ?? {}, pips.items, snaps.items, bks.items);
    const cut = [pips.truncated ? "primary IPs" : "", snaps.truncated ? "snapshots" : "", bks.truncated ? "backups" : ""].filter((n) => n.length > 0);
    const note = cut.length ? incompleteNote(cfg, cut) : "";
    return [text, note].filter((part) => part.length > 0).join(" ");
  } catch {
    return "";
  }
}
