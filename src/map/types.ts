/** The infrastructure graph shared by the collector, the MCP summary, and the web canvas. */
import type { AuditReport } from "./audit.js";

export type NodeKind =
  | "account"
  | "project"
  | "location"
  | "network"
  | "server"
  | "volume"
  | "firewall"
  | "load_balancer"
  | "floating_ip"
  | "primary_ip"
  | "snapshot"
  | "backup"
  | "storage_box"
  | "robot_server"
  | "certificate"
  | "placement_group";

export interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Container this node sits in on the canvas. */
  parent?: string;
  project?: string;
  account: string;
  location?: string;
  status?: string;
  /** Load balancers only: Hetzner target health checks, counted per target and port. */
  health?: TargetHealth;
  /** Estimated monthly gross price in the pricing currency, null when unknown. */
  monthly: number | null;
  costNote?: string;
  /** Things worth a look, in plain language. */
  flags: Flag[];
  details: Record<string, string | number | boolean | null>;
}

export interface TargetHealth {
  healthy: number;
  unhealthy: number;
  unknown: number;
}

/**
 * waste: money spent on something unused. risk: something that can hurt you.
 * info: worth knowing, not necessarily wrong. monthly is only the money this flag is about.
 */
export interface Flag {
  kind: "waste" | "risk" | "info";
  /** Stable id of the check that raised it, for example "volume_unattached". The audit keys fix steps on it. */
  code?: string;
  text: string;
  monthly: number | null;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: "attached" | "protects" | "routes" | "assigned" | "member" | "backs_up";
}

export interface Finding {
  nodeId: string;
  project?: string;
  kind: Flag["kind"];
  title: string;
  monthly: number | null;
}

export interface ProjectTotal {
  project: string;
  account: string;
  monthly: number;
  resources: number;
  error?: string;
}

export interface InfraGraph {
  source: "live" | "sample";
  generatedAt: string;
  currency: string;
  vatNote: string;
  nodes: MapNode[];
  edges: MapEdge[];
  totals: {
    monthly: number;
    byProject: ProjectTotal[];
    byKind: Array<{ kind: NodeKind; monthly: number; count: number }>;
    topDrivers: Array<{ nodeId: string; label: string; kind: NodeKind; project?: string; monthly: number }>;
    findings: Finding[];
  };
  caveats: string[];
  /** The workspace this graph covers. Absent when every workspace was mapped together. */
  workspace?: string;
  /** Built on every map refresh, so the report is always there without a click. */
  audit?: AuditReport;
}
