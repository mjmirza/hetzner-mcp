/**
 * What survives a server delete. Hetzner deletes the server's backups with it, but keeps
 * primary IPs without auto_delete, attached volumes, and snapshots, and keeps billing them.
 * Read-only and best effort: returns an empty string if anything cannot be read.
 */
import type { HetznerConfig } from "../config.js";
import { hetznerRequest } from "../http.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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

export async function deletionPreview(cfg: HetznerConfig, serverId: string | number): Promise<string> {
  try {
    const id = encodeURIComponent(String(serverId));
    const [srv, pips, snaps, bks] = await Promise.all([
      hetznerRequest(cfg, { surface: "cloud", path: `/servers/${id}` }) as Promise<Json>,
      hetznerRequest(cfg, { surface: "cloud", path: "/primary_ips", query: { per_page: 50 } }) as Promise<Json>,
      hetznerRequest(cfg, { surface: "cloud", path: "/images", query: { type: "snapshot", per_page: 50 } }) as Promise<Json>,
      hetznerRequest(cfg, { surface: "cloud", path: "/images", query: { type: "backup", per_page: 50 } }) as Promise<Json>,
    ]);
    return describeSurvivors(srv.server ?? {}, pips.primary_ips ?? [], snaps.images ?? [], bks.images ?? []);
  } catch {
    return "";
  }
}
