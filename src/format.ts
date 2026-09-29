/**
 * Token-efficiency layer. Hetzner responses can be large. By default we return a compact
 * projection of list responses and cap the total size, so the MCP stays cheap on context.
 * Callers can pass verbose to get the full payload when they actually need it.
 */

const MAX_CHARS = 24000;

/** Fields worth keeping in a compact list view across Cloud, Storage Box, and Robot. */
const COMPACT_FIELDS = [
  "id",
  "name",
  "status",
  "type",
  "server_type",
  "load_balancer_type",
  "location",
  "datacenter",
  "ip",
  "ipv4",
  "ipv6",
  "created",
  "labels",
  "product",
  "server_ip",
  "server_name",
  "server_number",
  "dc",
  "cancelled",
  "paid_until",
];

function projectItem(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const obj = item as Record<string, unknown>;
  const keys = Object.keys(obj);
  // Robot wraps each item in a single key, for example { server: {...} }. Unwrap it.
  const inner =
    keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === "object"
      ? (obj[keys[0]] as Record<string, unknown>)
      : obj;
  const picked: Record<string, unknown> = {};
  for (const f of COMPACT_FIELDS) {
    if (!(f in inner)) continue;
    const v = flatten(inner[f], f);
    if (v !== undefined) picked[f] = v;
  }
  return Object.keys(picked).length > 0 ? picked : inner;
}

// Size fields a model needs to answer capacity questions without asking for verbose.
const KEEP_NESTED: Record<string, string[]> = {
  server_type: ["name", "cores", "memory", "disk", "architecture", "cpu_type"],
  load_balancer_type: ["name", "max_connections", "max_targets"],
};

// A nested object such as server_type carries its full price table. In the compact view it
// collapses to its name, ip, or id, or to the few size fields above. Empty values go.
function flatten(v: unknown, key = ""): unknown {
  if (v === null || v === undefined || v === "") return undefined;
  if (Array.isArray(v)) return v.length ? v : undefined;
  if (typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length === 0) return undefined;
  const keep = KEEP_NESTED[key];
  if (keep && typeof o.name === "string") return Object.fromEntries(keep.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
  for (const k of ["name", "ip", "id"]) if (typeof o[k] === "string" || typeof o[k] === "number") return o[k];
  return o;
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.map(projectItem),
      hint: "verbose:true for all fields",
    };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const arrayKey = Object.keys(obj).find((k) => k !== "error" && Array.isArray(obj[k]));
    if (arrayKey) {
      const arr = obj[arrayKey] as unknown[];
      const pagination = (obj.meta as { pagination?: { next_page?: number | null } } | undefined)
        ?.pagination;
      const result: Record<string, unknown> = {
        collection: arrayKey,
        count: arr.length,
        items: arr.map(projectItem),
        hint: "verbose:true for all fields",
      };
      if (pagination?.next_page) result.next_page = pagination.next_page;
      return result;
    }
  }
  return value;
}

/** Render a value as text for a tool result, compacting and capping unless verbose. */
export function formatResult(value: unknown, verbose: boolean): string {
  const shaped = verbose ? value : compact(value);
  let text = typeof shaped === "string" ? shaped : JSON.stringify(shaped);
  if (text.length > MAX_CHARS) {
    text =
      text.slice(0, MAX_CHARS) +
      `\n... [truncated at ${MAX_CHARS} characters. Narrow with an id or query, fetch one page, and use verbose only when needed.]`;
  }
  return text;
}
