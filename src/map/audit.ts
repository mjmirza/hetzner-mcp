// The infrastructure audit: what is wrong, why it matters, exact fix steps (Console and MCP) and
// the money at stake. Pure and cheap, so it runs on every map build without anyone asking.
import type { InfraGraph, MapNode } from "./types.js";

export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "security" | "cost" | "reliability" | "hygiene";

export interface AuditFinding {
  code: string;
  severity: Severity;
  category: Category;
  title: string;
  resource: { id: string; kind: MapNode["kind"]; label: string; account: string; project?: string; location?: string };
  what: string;
  why: string;
  console: string[];
  mcp: string[];
  /** Money this fix saves per month, when it is known. */
  monthlySaving: number | null;
}

export interface AuditScope {
  account: string;
  project?: string;
  score: number;
  findings: number;
  monthlySaving: number;
}

export interface AuditReport {
  generatedAt: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  monthlySaving: number;
  counts: Record<Severity, number>;
  findings: AuditFinding[];
  scopes: AuditScope[];
  /** Said out loud so nobody reads silence as an all clear. */
  limits: string[];
}

interface Playbook {
  severity: Severity;
  category: Category;
  title: string;
  why: string;
  console: (n: MapNode) => string[];
  mcp: (n: MapNode) => string[];
}

const cloudPath = (n: MapNode) => `Cloud Console, project ${n.project ?? "(its project)"}`;
const idOf = (n: MapNode) => n.id.split(":").pop() ?? n.id;

const PLAYBOOK: Record<string, Playbook> = {
  server_off: {
    severity: "high",
    category: "cost",
    title: "Powered-off server is still billed",
    why: "Hetzner bills a server whether it is running or off. Only deleting it stops the cost.",
    console: (n) => [`Open ${cloudPath(n)}, Servers, ${n.label}.`, "Snapshots tab, Take snapshot, if you may need it again.", "Delete tab, type the server name, Delete."],
    mcp: (n) => [`Ask: "take a snapshot of ${n.label}, then delete it". The MCP uses cloud_request to POST /servers/${idOf(n)}/actions/create_image, then cloud_delete_server with a typed confirmation.`],
  },
  type_retiring: {
    severity: "high",
    category: "reliability",
    title: "Server type is being retired",
    why: "After the cut-off date the type cannot be recreated or rescaled here. A rebuild or a move then happens under time pressure.",
    console: (n) => [`Open ${cloudPath(n)}, Servers, ${n.label}, Rescale.`, "Power off first, pick a current type of the same size, keep the disk size unless you want to grow it.", "Power on and check the service."],
    mcp: (n) => [`Ask: "which current server types match ${n.label}?" (cloud_list_server_types), then "rescale ${n.label} to <type>" (cloud_request POST /servers/${idOf(n)}/actions/change_type).`],
  },
  traffic_overage: {
    severity: "medium",
    category: "cost",
    title: "Outgoing traffic will pass the included allowance",
    why: "Traffic above the allowance is billed per TB at the end of the month.",
    console: (n) => [`Open ${cloudPath(n)}, Servers, ${n.label}, Graphs, and find what sends the traffic.`, "Put static files behind a CDN, or spread traffic across servers in EU locations, which include more traffic."],
    mcp: (n) => [`Ask: "show traffic for ${n.label}" (cloud_list_servers with verbose true).`],
  },
  traffic_high: {
    severity: "low",
    category: "cost",
    title: "Most of the included traffic is used",
    why: "One busy week can push the server into paid overage.",
    console: (n) => [`Watch ${cloudPath(n)}, Servers, ${n.label}, Graphs, for the rest of the month.`],
    mcp: (n) => [`Ask: "how much traffic has ${n.label} used?"`],
  },
  volume_unattached: {
    severity: "medium",
    category: "cost",
    title: "Volume not attached to any server",
    why: "Volumes are billed per GB whether anything uses them.",
    console: (n) => [`Open ${cloudPath(n)}, Volumes, ${n.label}.`, "Attach it to the server that needs it, or Delete it if the data is no longer needed. Copy the data first if unsure."],
    mcp: (n) => [`Ask: "attach ${n.label} to <server>" (cloud_attach_volume) or "delete volume ${n.label}" (cloud_delete_volume, needs the typed name).`],
  },
  ip_unassigned: {
    severity: "low",
    category: "cost",
    title: "Primary IP not assigned to anything",
    why: "A reserved IPv4 costs money every month even when nothing uses it.",
    console: (n) => [`Open ${cloudPath(n)}, Primary IPs, ${n.label}.`, "Assign it to a server, or Delete it if you do not need to keep this address."],
    mcp: (n) => [`Ask: "assign ${n.label} to <server>" (cloud_assign_primary_ip) or "delete primary IP ${n.label}" (cloud_delete_primary_ip).`],
  },
  fip_unassigned: {
    severity: "low",
    category: "cost",
    title: "Floating IP not assigned",
    why: "Floating IPs are billed monthly, assigned or not.",
    console: (n) => [`Open ${cloudPath(n)}, Floating IPs, ${n.label}.`, "Assign it, or Delete it if nothing points at it any more."],
    mcp: (n) => [`Ask: "assign ${n.label} to <server>" (cloud_assign_floating_ip) or "delete floating IP ${n.label}" (cloud_delete_floating_ip).`],
  },
  lb_no_targets: {
    severity: "medium",
    category: "cost",
    title: "Load balancer serves nothing",
    why: "It is billed monthly while sending traffic nowhere, and any DNS pointing at it returns errors.",
    console: (n) => [`Open ${cloudPath(n)}, Load Balancers, ${n.label}, Targets.`, "Add the servers it should serve, or Delete it."],
    mcp: (n) => [`Ask: "add <server> as a target of ${n.label}" (cloud_request POST /load_balancers/${idOf(n)}/actions/add_target) or "delete ${n.label}" (cloud_delete_load_balancer).`],
  },
  lb_single_target: {
    severity: "medium",
    category: "reliability",
    title: "Load balancer has only one target",
    why: "With one server behind it, the load balancer adds cost but no redundancy. If that server fails, the site is down.",
    console: (n) => [`Open ${cloudPath(n)}, Load Balancers, ${n.label}, Targets, and add a second server.`, "Put both servers in a spread placement group so they land on different hosts."],
    mcp: (n) => [`Ask: "create a second server like the one behind ${n.label} and add it as a target".`],
  },
  fw_unused: {
    severity: "low",
    category: "hygiene",
    title: "Firewall is not applied to anything",
    why: "It is free, but a firewall that protects nothing gives a false sense of safety.",
    console: (n) => [`Open ${cloudPath(n)}, Firewalls, ${n.label}, Apply to, and pick the servers it was meant for. Or delete it.`],
    mcp: (n) => [`Ask: "apply ${n.label} to <server>" (cloud_request POST /firewalls/${idOf(n)}/actions/apply_to_resources) or "delete firewall ${n.label}" (cloud_delete_firewall).`],
  },
  fw_open_ports: {
    severity: "critical",
    category: "security",
    title: "Admin ports open to the whole internet",
    why: "SSH and database ports open to everyone are scanned within minutes. One weak password or unpatched service is enough.",
    console: (n) => [`Open ${cloudPath(n)}, Firewalls, ${n.label}, Rules.`, "Change the source of each flagged rule from Any to your own IP addresses, or remove it and reach the server through a private network or VPN.", "Save. Rules apply immediately."],
    mcp: (n) => [`Ask: "limit SSH on ${n.label} to <your IP>" (cloud_request POST /firewalls/${idOf(n)}/actions/set_rules).`],
  },
  no_firewall: {
    severity: "high",
    category: "security",
    title: "Public server with no Hetzner firewall",
    why: "Everything the server listens on is reachable from the internet. A firewall in front is a second lock if the server's own setup slips.",
    console: (n) => [`Open ${cloudPath(n)}, Firewalls, Create firewall.`, "Allow only what the server serves, for example 80 and 443, and SSH from your own IP.", `Apply it to ${n.label}.`],
    mcp: (n) => [`Ask: "create a firewall that allows 80 and 443, SSH from <your IP>, and apply it to ${n.label}" (cloud_create_firewall).`],
  },
  snapshot_orphan: {
    severity: "low",
    category: "cost",
    title: "Snapshot of a server that no longer exists",
    why: "Snapshots are billed per GB each month. Old ones from deleted servers are easy to forget.",
    console: (n) => [`Open ${cloudPath(n)}, Snapshots, ${n.label}. Delete it unless you plan to restore it.`],
    mcp: (n) => [`Ask: "delete snapshot ${n.label}" (cloud_request DELETE /images/${idOf(n)}).`],
  },
  snapshot_old: {
    severity: "low",
    category: "cost",
    title: "Old snapshot",
    why: "If newer snapshots or daily backups exist, an old snapshot mostly adds cost.",
    console: (n) => [`Open ${cloudPath(n)}, Snapshots, ${n.label}. Keep it only if it is a restore point you need.`],
    mcp: (n) => [`Ask: "delete snapshot ${n.label}" (cloud_request DELETE /images/${idOf(n)}).`],
  },
  cert_expired: {
    severity: "critical",
    category: "reliability",
    title: "Certificate has expired",
    why: "Browsers refuse the connection. Anything using this certificate is effectively down for visitors.",
    console: (n) => [`Open ${cloudPath(n)}, Load Balancers, Certificates, ${n.label}.`, "Managed certificate: check DNS points at the load balancer, then retry. Uploaded: upload the renewed certificate and swap it on the HTTPS service."],
    mcp: (n) => [`Ask: "retry certificate ${n.label}" (cloud_request POST /certificates/${idOf(n)}/actions/retry).`],
  },
  cert_expiring: {
    severity: "high",
    category: "reliability",
    title: "Certificate expires soon",
    why: "If it lapses, visitors see a security error and most will leave.",
    console: (n) => [`Open ${cloudPath(n)}, Load Balancers, Certificates, ${n.label}.`, "Managed: check DNS still points at the load balancer so renewal can succeed. Uploaded: upload the renewed one now."],
    mcp: (n) => [`Ask: "show certificate ${n.label}" (cloud_list_certificates).`],
  },
  backup_surcharge: {
    severity: "low",
    category: "cost",
    title: "Automatic backups on a server",
    why: "Backups add 20% to the server price. Right for production, often not needed for test or throwaway servers.",
    console: (n) => [`If ${n.label} is not important, open ${cloudPath(n)}, Servers, ${n.label}, Backups, and disable them.`],
    mcp: (n) => [`Ask: "disable backups on ${n.label}" (cloud_request POST /servers/${idOf(n)}/actions/disable_backup).`],
  },
  no_backups_prod: {
    severity: "medium",
    category: "reliability",
    title: "Production server without automatic backups",
    why: "A bad deploy, a deleted file or a disk fault has no recent restore point. Backups cost 20% of the server price.",
    console: (n) => [`Open ${cloudPath(n)}, Servers, ${n.label}, Backups, Enable backups.`],
    mcp: (n) => [`Ask: "enable backups on ${n.label}" (cloud_request POST /servers/${idOf(n)}/actions/enable_backup).`],
  },
  single_location: {
    severity: "low",
    category: "reliability",
    title: "All servers of the project in one location",
    why: "A data center outage takes the whole project down at once.",
    console: (n) => [`For the parts that must stay up in ${n.label}, run a second server in another EU location, for example Nuremberg or Helsinki, behind a load balancer.`],
    mcp: () => ['Ask: "create a copy of <server> in nbg1" (cloud_create_server).'],
  },
  no_placement_group: {
    severity: "low",
    category: "reliability",
    title: "Several servers but no placement group",
    why: "Without a spread placement group, two servers can land on the same physical host and fail together.",
    console: (n) => [`Open Cloud Console, project ${n.label}, Placement groups, create a spread group, and add servers when you next create or rebuild them.`],
    mcp: () => ['Ask: "create a spread placement group" (cloud_create_placement_group).'],
  },
  robot_cancelled: {
    severity: "low",
    category: "hygiene",
    title: "Dedicated server is cancelled",
    why: "It stops at the paid-until date. Anything still running on it goes down then.",
    console: (n) => [`Robot, Servers, ${n.label}. Move anything still needed before the paid-until date.`],
    mcp: (n) => [`Ask: "show dedicated server ${n.label}" (robot_list_servers).`],
  },
  project_unreadable: {
    severity: "high",
    category: "hygiene",
    title: "Project could not be read",
    why: "Nothing in this project is on the map or in this audit, so problems there stay invisible.",
    console: (n) => [`Cloud Console, project ${n.label}, Security, API tokens. Create a new Read token and replace the old one.`],
    mcp: () => ["Run: npx hetzner-mcp doctor to see which token fails, then npx hetzner-mcp setup."],
  },
  fallback: {
    severity: "low",
    category: "hygiene",
    title: "Worth a look",
    why: "Raised by the map while reading your estate.",
    console: (n) => [`Open ${n.label} in the Hetzner Console and review it.`],
    mcp: (n) => [`Ask: "show me ${n.label}".`],
  },
};

// Info notes that are worth acting on. Other info notes stay on the map only.
const ACTIONABLE_INFO = new Set(["backup_surcharge", "fw_unused", "traffic_high", "robot_cancelled"]);
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 25, high: 12, medium: 6, low: 2 };
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PROD = /prod|live|main|primary/i;

const round = (n: number) => Math.round(n * 100) / 100;

export function playbookCodes(): string[] {
  return Object.keys(PLAYBOOK).filter((c) => c !== "fallback");
}

function finding(code: string, n: MapNode, what: string, saving: number | null): AuditFinding {
  const pb = PLAYBOOK[code] ?? PLAYBOOK.fallback!;
  return {
    code,
    severity: pb.severity,
    category: pb.category,
    title: pb.title,
    resource: { id: n.id, kind: n.kind, label: n.label, account: n.account, project: n.project, location: n.location },
    what,
    why: pb.why,
    console: pb.console(n),
    mcp: pb.mcp(n),
    monthlySaving: saving,
  };
}

function score(fs: AuditFinding[]): number {
  return Math.max(0, 100 - fs.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0));
}

function grade(s: number): AuditReport["grade"] {
  return s >= 90 ? "A" : s >= 75 ? "B" : s >= 60 ? "C" : s >= 40 ? "D" : "E";
}

/** Builds the audit from a finished map. */
export function audit(graph: Pick<InfraGraph, "nodes">, now = new Date()): AuditReport {
  const out: AuditFinding[] = [];
  const { nodes } = graph;

  // Everything the collector already flagged, each with its playbook.
  for (const n of nodes) {
    for (const f of n.flags) {
      if (f.kind === "info" && !ACTIONABLE_INFO.has(f.code ?? "")) continue;
      // Backups on production are the right call, not a cost to trim.
      if (f.code === "backup_surcharge" && PROD.test(n.project ?? "")) continue;
      out.push(finding(f.code ?? "fallback", n, f.text, f.kind === "waste" ? f.monthly : null));
    }
  }

  // Checks that need the whole project rather than one resource.
  const projects = nodes.filter((n) => n.kind === "project");
  for (const p of projects) {
    const servers = nodes.filter((n) => n.kind === "server" && n.project === p.project && n.account === p.account);
    if (PROD.test(p.label)) {
      for (const s of servers.filter((x) => x.details.backups === false)) {
        out.push(finding("no_backups_prod", s, `${s.label} runs in project ${p.label} with automatic backups switched off.`, null));
      }
    }
    const locs = new Set(servers.map((s) => s.location).filter(Boolean));
    if (servers.length >= 2 && locs.size === 1) out.push(finding("single_location", p, `All ${servers.length} servers in ${p.label} run in ${[...locs][0]}.`, null));
    // Only a spread group that actually holds two or more servers protects anything.
    const hasGroup = nodes.some((n) => n.kind === "placement_group" && n.project === p.project && n.account === p.account && n.details.type === "spread" && Number(n.details.servers) >= 2);
    if (servers.length >= 2 && !hasGroup) out.push(finding("no_placement_group", p, `${p.label} has ${servers.length} servers and no placement group.`, null));
  }
  for (const lb of nodes.filter((n) => n.kind === "load_balancer" && n.details.targets === 1)) {
    out.push(finding("lb_single_target", lb, `${lb.label} sends all traffic to a single server.`, null));
  }

  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.monthlySaving ?? 0) - (a.monthlySaving ?? 0));

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of out) counts[f.severity]++;

  // One scope per project, plus account-level scopes for dedicated servers and Storage Boxes.
  const keyOf = (account: string, project?: string) => `${account}|${project ?? ""}`;
  const keys = new Map<string, { account: string; project?: string }>();
  for (const p of projects) keys.set(keyOf(p.account, p.project), { account: p.account, project: p.project });
  for (const f of out) keys.set(keyOf(f.resource.account, f.resource.project), { account: f.resource.account, project: f.resource.project });
  const scopes = [...keys.values()]
    .map((sc) => {
      const mine = out.filter((f) => keyOf(f.resource.account, f.resource.project) === keyOf(sc.account, sc.project));
      return { ...sc, score: score(mine), findings: mine.length, monthlySaving: round(mine.reduce((s, f) => s + (f.monthlySaving ?? 0), 0)) };
    })
    .sort((a, b) => a.score - b.score);

  // Overall score is the resource-weighted mean of the scopes, so one bad project cannot zero a
  // healthy estate, and a big project counts for more than a tiny one.
  const size = (sc: { account: string; project?: string }) => Math.max(1, nodes.filter((n) => n.account === sc.account && n.project === sc.project && !["account", "project", "location"].includes(n.kind)).length);
  const weight = scopes.reduce((s, sc) => s + size(sc), 0);
  const total = scopes.length ? Math.round(scopes.reduce((s, sc) => s + sc.score * size(sc), 0) / weight) : 100;
  return {
    generatedAt: now.toISOString(),
    score: total,
    grade: grade(total),
    monthlySaving: round(out.reduce((s, f) => s + (f.monthlySaving ?? 0), 0)),
    counts,
    findings: out,
    scopes,
    limits: [
      "Reads configuration through the Hetzner API. It does not log in to servers, so it cannot see ports opened inside the OS, patch levels, or application settings.",
      "Savings use list prices, not your invoice.",
      "Dedicated (Robot) servers are listed but not priced, because the Robot API does not return prices.",
    ],
  };
}

const SEV_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** One finding as Markdown: what, why, and numbered fix steps. */
export function findingMarkdown(f: AuditFinding, n: number, currency = "EUR"): string {
  const money = (v: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(v);
  const where = [f.resource.account, f.resource.project].filter(Boolean).join(" / ");
  const lines = [
    `## ${n}. ${SEV_LABEL[f.severity]}: ${f.title}`,
    "",
    `**Resource:** ${f.resource.label} (${f.resource.kind.replace("_", " ")}), ${where}${f.resource.location ? `, ${f.resource.location}` : ""}`,
    `**Category:** ${f.category}${f.monthlySaving ? `. **Saves:** ${money(f.monthlySaving)} a month` : ""}`,
    "",
    `**What:** ${f.what}`,
    "",
    `**Why it matters:** ${f.why}`,
    "",
    "**Fix in the Hetzner Console:**",
    "",
    ...f.console.map((s, j) => `${j + 1}. ${s}`),
    "",
    "**Fix with this MCP:**",
    "",
    ...f.mcp.map((s) => `- ${s}`),
    "",
  ];
  return lines.join("\n");
}

/** The report as Markdown, for the CLI, the MCP tool and the downloadable file. */
export function auditMarkdown(r: AuditReport, currency = "EUR", offset = 0): string {
  const money = (v: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(v);
  const lines = [
    "# Hetzner infrastructure audit",
    "",
    `Score **${r.score}/100 (grade ${r.grade})**. ${r.findings.length} finding(s): ${r.counts.critical} critical, ${r.counts.high} high, ${r.counts.medium} medium, ${r.counts.low} low.`,
    r.monthlySaving > 0 ? `Fixing the cost findings saves about **${money(r.monthlySaving)} a month**.` : "No direct monthly savings found.",
    "",
    `Generated ${r.generatedAt}.`,
    "",
  ];
  if (r.scopes.length) {
    lines.push("## By project", "", "| Account | Project | Score | Findings | Saving / month |", "| --- | --- | --- | --- | --- |");
    for (const s of r.scopes) lines.push(`| ${s.account} | ${s.project ?? "(account level)"} | ${s.score} | ${s.findings} | ${s.monthlySaving > 0 ? money(s.monthlySaving) : "-"} |`);
    lines.push("");
  }
  if (!r.findings.length) lines.push("Nothing to fix right now.", "");
  r.findings.forEach((f, i) => lines.push(findingMarkdown(f, offset + i + 1, currency)));
  lines.push("## What this audit cannot see", "");
  r.limits.forEach((l) => lines.push(`- ${l}`));
  return lines.join("\n") + "\n";
}
