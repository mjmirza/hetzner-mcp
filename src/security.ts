/**
 * Security helpers. SSRF-safe path handling and method gating.
 * The generic request tools accept only a relative API path, never a full URL,
 * so a caller can never point this server at an arbitrary host.
 */

const READ_METHODS = new Set(["GET", "HEAD"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Normalize and validate a relative API path.
 * Rejects full URLs, protocol-relative URLs, path traversal, and control characters.
 */
export function normalizePath(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("path is required");
  }
  const raw = path.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("//")) {
    throw new Error("path must be a relative API path like /servers, not a full URL");
  }

  // To prevent path traversal and SSRF via URL normalization,
  // we decode the URI and explicitly check for both '..' and '\'.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch (err) {
    throw new Error("path contains malformed percent-encoding");
  }

  if (decoded.includes("..")) {
    throw new Error("path must not contain '..'");
  }
  if (decoded.includes("\\")) {
    throw new Error("path must not contain '\\'");
  }

  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      throw new Error("path must not contain control characters");
    }
  }
  return raw.startsWith("/") ? raw : "/" + raw;
}

export function normalizeMethod(method: string | undefined): string {
  const m = (method || "GET").toUpperCase();
  if (!READ_METHODS.has(m) && !WRITE_METHODS.has(m)) {
    throw new Error(`unsupported HTTP method: ${m}`);
  }
  return m;
}

export function isWrite(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}
