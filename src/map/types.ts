/** The infrastructure graph shared by the collector, the MCP summary, and the web canvas. */

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
  /** Estimated monthly gross price in the pricing currency, null when unknown. */
  monthly: number | null;
  costNote?: string;
  /** Things worth a look, in plain language. */
  flags: string[];
  details: Record<string, string | number | boolean | null>;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: "attached" | "protects" | "routes" | "assigned" | "member" | "backs_up";
}

export interface Finding {
  nodeId: string;
  project?: string;
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
}
