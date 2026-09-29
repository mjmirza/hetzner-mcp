// Plain-language names for the short codes Hetzner uses. Verified against the Hetzner Cloud API
// (GET /locations and GET /server_types) on 2026-09-29.
import type { MapNode } from "./types";

interface Place {
  city: string;
  country: string;
  zone: string;
}

const LOCATIONS: Record<string, Place> = {
  fsn1: { city: "Falkenstein", country: "Germany", zone: "EU central" },
  nbg1: { city: "Nuremberg", country: "Germany", zone: "EU central" },
  hel1: { city: "Helsinki", country: "Finland", zone: "EU central" },
  ash: { city: "Ashburn, Virginia", country: "USA", zone: "US east" },
  hil: { city: "Hillsboro, Oregon", country: "USA", zone: "US west" },
  sin: { city: "Singapore", country: "Singapore", zone: "Asia Pacific" },
};

// Server type prefix to what it actually is. Longest prefix first so "cpx" wins over "cx".
const FAMILIES: [string, string][] = [
  ["cax", "Arm CPU, shared, budget"],
  ["ccx", "Dedicated CPU"],
  ["cpx", "x86 CPU, shared, regular"],
  ["cx", "x86 CPU, shared, budget"],
];

/** "Falkenstein, Germany" for "fsn1", or the code itself when it is not a known location. */
export function placeName(code: string | undefined | null): string | null {
  if (!code) return null;
  const p = LOCATIONS[code];
  return p ? `${p.city}, ${p.country}` : null;
}

/** Short city for tight spots, like "Falkenstein". */
export function cityName(code: string | undefined | null): string | null {
  if (!code) return null;
  return LOCATIONS[code]?.city ?? null;
}

/** One line explaining a location code, for tooltips and the inspector. */
export function explainLocation(code: string | undefined | null): string | null {
  if (!code) return null;
  const p = LOCATIONS[code];
  return p ? `${code} is Hetzner's data center in ${p.city}, ${p.country} (${p.zone} network zone).` : null;
}

export function familyOf(type: string | undefined | null): string | null {
  if (!type) return null;
  const hit = FAMILIES.find(([prefix]) => type.toLowerCase().startsWith(prefix));
  return hit ? hit[1] : null;
}

/** "2 vCPU · 4 GB RAM · 40 GB disk" from a server node's details, or null when unknown. */
export function specLine(n: MapNode): string | null {
  const d = n.details;
  const bits: string[] = [];
  if (typeof d.cores === "number") bits.push(`${d.cores} vCPU`);
  if (typeof d.memory_gb === "number") bits.push(`${d.memory_gb} GB RAM`);
  if (typeof d.disk_gb === "number") bits.push(`${d.disk_gb} GB disk`);
  return bits.length ? bits.join(" · ") : null;
}

/** One line explaining a server type code, for tooltips and the inspector. */
export function explainType(n: MapNode): string | null {
  const type = typeof n.details.type === "string" ? n.details.type : null;
  if (!type) return null;
  const fam = familyOf(type);
  const spec = specLine(n);
  return `${type} is ${[fam, spec].filter(Boolean).join(", ") || "a Hetzner server type"}.`;
}
