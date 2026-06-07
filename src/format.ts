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
    if (f in inner) picked[f] = inner[f];
  }
  return Object.keys(picked).length > 0 ? picked : inner;
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.map(projectItem),
      hint: "compact view, pass verbose true for full fields",
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
        hint: "compact view, pass verbose true for full fields",
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
  let text = typeof shaped === "string" ? shaped : JSON.stringify(shaped, null, 2);
  if (text.length > MAX_CHARS) {
    text =
      text.slice(0, MAX_CHARS) +
      `\n... [truncated at ${MAX_CHARS} characters. Narrow with an id or query, fetch one page, and use verbose only when needed.]`;
  }
  return text;
}
