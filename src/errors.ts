/**
 * Error types and secret redaction.
 * Redaction is applied to anything that could end up in a log or an error message.
 */

/** Strip credentials from any string before it can be logged or returned in an error. */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");
  // Opaque high-entropy tokens (Hetzner Cloud tokens are 64+ chars).
  out = out.replace(/\b[A-Za-z0-9]{40,}\b/g, "[REDACTED]");
  return out;
}

export class HetznerApiError extends Error {
  constructor(
    public readonly surface: string,
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(redactSecrets(message));
    this.name = "HetznerApiError";
  }
}
