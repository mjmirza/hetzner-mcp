export type { InfraGraph, MapNode, MapEdge, NodeKind, Flag, Finding } from "../../../src/map/types";

export interface Meta {
  mode: "live" | "demo";
  readOnly: boolean;
  allowBilled: boolean;
  projects: Array<{ id: string; name: string; account: string; source: "env" | "local" }>;
}

export interface Plan {
  label: string;
  billed: boolean;
  monthly: number | null;
  currency: string;
  notes: string[];
  blocked?: string;
}

export interface Catalog {
  locations: Array<{ name: string; city: string; zone: string }>;
  serverTypes: Array<{ type: string; location: string; monthly: number | null; cores: number; memory_gb: number; disk_gb: number; architecture: string; recommended: boolean; retiring_after: string | null }>;
  images: Array<{ name: string; description: string; architecture: string }>;
  sshKeys: Array<{ id: number; name: string }>;
  networks: Array<{ id: number; name: string; ip_range: string }>;
  firewalls: Array<{ id: number; name: string }>;
  servers: Array<{ id: number; name: string; location: string }>;
  loadBalancerTypes: Array<{ name: string; monthly: number | null }>;
  volumePerGb: number | null;
  currency: string;
}

export interface WorkspaceSummary {
  name: string;
  accounts: number;
  projects: number;
}
