import type { NodeKind } from "./types";

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(v: number | null | undefined, currency = "EUR"): string {
  if (v == null) return "n/a";
  if (currency === "EUR") return eur.format(v);
  return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(v);
}

export const KIND_LABEL: Record<NodeKind, string> = {
  account: "Account",
  project: "Project",
  location: "Location",
  network: "Private network",
  server: "Server",
  volume: "Volume",
  firewall: "Firewall",
  load_balancer: "Load balancer",
  floating_ip: "Floating IP",
  primary_ip: "Primary IP",
  snapshot: "Snapshot",
  backup: "Backup",
  storage_box: "Storage Box",
  robot_server: "Dedicated server",
  certificate: "Certificate",
  placement_group: "Placement group",
};

/** Kinds a person can create from the canvas, in the order the menu shows them. */
export const CREATABLE: Array<{ kind: NodeKind; hint: string }> = [
  { kind: "server", hint: "A virtual machine, billed hourly up to a monthly cap" },
  { kind: "volume", hint: "Block storage you attach to a server" },
  { kind: "network", hint: "Private network between your resources, free" },
  { kind: "firewall", hint: "Inbound rules for your servers, free" },
  { kind: "load_balancer", hint: "Spreads traffic across servers" },
  { kind: "primary_ip", hint: "A public IPv4 you keep across rebuilds" },
  { kind: "floating_ip", hint: "An IP you can move between servers" },
  { kind: "placement_group", hint: "Keeps servers on separate hosts, free" },
];

/** Kinds that sit under the project as its own shelf, not under a location. */
export const SHELF_KINDS = new Set<NodeKind>(["firewall", "certificate", "placement_group", "snapshot", "backup", "storage_box"]);
