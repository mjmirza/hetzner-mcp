/**
 * Live token verification. The setup wizard never writes a token it has not confirmed,
 * so the user learns in seconds whether the key works, instead of after a failed session.
 * fetch is injected so this stays unit-testable with no real network.
 */

export interface TokenCheck {
  ok: boolean;
  status?: number;
  message: string;
}

/** A read-only endpoint that costs nothing and proves the token is valid and authorized. */
const PROBE_URL = "https://api.hetzner.cloud/v1/locations";

export async function validateCloudToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12000,
): Promise<TokenCheck> {
  const t = token.trim();
  if (!t) return { ok: false, message: "Token is empty." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(PROBE_URL, {
      headers: { Authorization: `Bearer ${t}` },
      signal: controller.signal,
    });
    if (res.status === 200) return { ok: true, status: 200, message: "Token verified against the Hetzner Cloud API." };
    if (res.status === 401)
      return {
        ok: false,
        status: 401,
        message: "Token rejected (401). Make sure it is a Read and Write token and was copied in full.",
      };
    if (res.status === 403)
      return { ok: false, status: 403, message: "Token lacks permission (403). Create a Read and Write token." };
    return { ok: false, status: res.status, message: `Unexpected ${res.status} from Hetzner. Try again in a moment.` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const detail = aborted ? "request timed out" : err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not reach Hetzner (${detail}). Check your connection and retry.` };
  } finally {
    clearTimeout(timer);
  }
}
