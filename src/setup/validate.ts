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

/** Where a Cloud API token is created. The old console address redirects here. */
export const CONSOLE_URL = "https://console.hetzner.com/";

/** The exact clicks that create a token, for a user who has never made one. */
export const TOKEN_STEPS = [
  `Open ${CONSOLE_URL} and pick the project to manage (or create one).`,
  "Go to Security, then API tokens, then Generate API token.",
  "Choose Read & Write so your assistant can also create and delete. Read lets it only look.",
  "Copy the token right away. Hetzner shows it only once.",
];

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
        message: `Hetzner did not accept this token (401). It may be mistyped, cut short, or deleted. Copy it again, or make a new one at ${CONSOLE_URL} under your project, Security, API tokens.`,
      };
    if (res.status === 403)
      return { ok: false, status: 403, message: `This token is not allowed to do that (403). Make a Read & Write token at ${CONSOLE_URL} under your project, Security, API tokens.` };
    return { ok: false, status: res.status, message: `Unexpected ${res.status} from Hetzner. Try again in a moment.` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const detail = aborted ? "request timed out" : err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not reach Hetzner (${detail}). Check your internet connection, then try again.` };
  } finally {
    clearTimeout(timer);
  }
}
