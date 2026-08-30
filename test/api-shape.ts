// Hallucination check. Every create field our write tools send must exist in the official
// Hetzner OpenAPI spec at docs.hetzner.cloud (cloud spec, extracted 2026-08-30).

interface Field {
  required: boolean;
}
type Fields = Record<string, Field>;

const req = (): Field => ({ required: true });
const opt = (): Field => ({ required: false });

// Allowed request-body fields per POST path, from the official spec.
const OFFICIAL: Record<string, Fields> = {
  "/volumes": { size: req(), name: req(), labels: opt(), automount: opt(), format: opt(), location: opt(), server: opt() },
  "/networks": { name: req(), ip_range: req(), labels: opt(), subnets: opt(), routes: opt(), expose_routes_to_vswitch: opt() },
  "/firewalls": { name: req(), labels: opt(), rules: opt(), apply_to: opt() },
  "/load_balancers": { name: req(), load_balancer_type: req(), algorithm: opt(), services: opt(), targets: opt(), labels: opt(), public_interface: opt(), network: opt(), network_zone: opt(), location: opt() },
  "/floating_ips": { type: req(), server: opt(), home_location: opt(), description: opt(), name: opt(), labels: opt() },
  "/primary_ips": { name: req(), labels: opt(), type: req(), location: opt(), assignee_type: opt(), assignee_id: opt(), auto_delete: opt() },
  "/ssh_keys": { name: req(), public_key: req(), labels: opt() },
  "/placement_groups": { name: req(), labels: opt(), type: req() },
};

// Fields each curated create tool can put in the body. Keep in lockstep with write-cloud.
const OURS: Record<string, string[]> = {
  "/volumes": ["name", "size", "location", "server", "format", "automount"],
  "/networks": ["name", "ip_range", "subnets", "expose_routes_to_vswitch"],
  "/firewalls": ["name", "rules", "apply_to"],
  "/load_balancers": ["name", "load_balancer_type", "location", "network_zone", "algorithm", "services", "targets", "public_interface"],
  "/floating_ips": ["type", "home_location", "server", "name", "description"],
  "/primary_ips": ["type", "name", "location", "assignee_type", "assignee_id", "auto_delete"],
  "/ssh_keys": ["name", "public_key", "labels"],
  "/placement_groups": ["name", "type", "labels"],
};

// Required official fields our tools always send (type is defaulted for placement and primary).
const ALWAYS_SENT: Record<string, string[]> = {
  "/volumes": ["name", "size"],
  "/networks": ["name", "ip_range"],
  "/firewalls": ["name"],
  "/load_balancers": ["name", "load_balancer_type"],
  "/floating_ips": ["type"],
  "/primary_ips": ["type", "name"],
  "/ssh_keys": ["name", "public_key"],
  "/placement_groups": ["name", "type"],
};

const NL = String.fromCharCode(10);
const line = (s: string): void => void process.stdout.write(s + NL);

let passed = 0;
let total = 0;
function assert(label: string, cond: boolean): void {
  total++;
  if (cond) passed++;
  line(`${cond ? "OK  " : "FAIL"} ${label}`);
}

for (const [path, fields] of Object.entries(OURS)) {
  const official = OFFICIAL[path];
  for (const f of fields) assert(`${path}: field '${f}' exists in official spec`, official[f] !== undefined);
  for (const [f, meta] of Object.entries(official)) {
    if (meta.required) {
      const covered = fields.includes(f) || (ALWAYS_SENT[path] ?? []).includes(f);
      assert(`${path}: required field '${f}' is covered`, covered);
    }
  }
}

line("");
line(`${passed}/${total} api-shape checks passed`);
if (passed !== total) process.exitCode = 1;
