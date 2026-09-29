/**
 * Which Hetzner projects and accounts to map. One Cloud token covers exactly one project,
 * so several projects mean several tokens. Tokens never leave this module's callers.
 *
 *   HETZNER_CLOUD_TOKEN            the default project
 *   HETZNER_PROJECT_NAME           display name for the default project
 *   HETZNER_CLOUD_TOKEN_<NAME>     one more project per variable, for example _PROD, _STAGING
 *   HETZNER_ACCOUNT_<NAME>         optional account label a project belongs to
 *   HETZNER_ACCOUNT_NAME           label for the default account
 */
import type { HetznerConfig } from "../config.js";
import type { StoredProject } from "./store.js";

export interface ProjectRef {
  name: string;
  account: string;
  cfg: HetznerConfig;
  /** Where the token came from. Only "local" projects can be disconnected from the map. */
  source: "env" | "local";
}

const PREFIX = "HETZNER_CLOUD_TOKEN_";

export function discoverProjects(base: HetznerConfig, env: NodeJS.ProcessEnv = process.env, stored: StoredProject[] = []): ProjectRef[] {
  const defaultAccount = env.HETZNER_ACCOUNT_NAME?.trim() || "Hetzner account";
  const out: ProjectRef[] = [];
  const seen = new Set<string>();
  if (base.cloudToken) {
    const name = env.HETZNER_PROJECT_NAME?.trim() || "default";
    out.push({ name, account: defaultAccount, cfg: base, source: "env" });
    seen.add(base.cloudToken);
  }
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) {
    if (!key.startsWith(PREFIX) || !value?.trim()) continue;
    const token = value.trim();
    if (seen.has(token)) continue;
    seen.add(token);
    const suffix = key.slice(PREFIX.length);
    const name = suffix.toLowerCase().replace(/_/g, "-");
    const account = env[`HETZNER_ACCOUNT_${suffix}`]?.trim() || defaultAccount;
    // Robot credentials belong to the default account only; extra projects are cloud only.
    out.push({ name, account, cfg: { ...base, cloudToken: token, robotUser: undefined, robotPassword: undefined }, source: "env" });
  }
  // Projects connected from the map. An env token always wins over a saved duplicate.
  for (const p of stored) {
    if (seen.has(p.token) || out.some((o) => o.name === p.name && o.account === p.account)) continue;
    seen.add(p.token);
    out.push({ name: p.name, account: p.account, cfg: { ...base, cloudToken: p.token, robotUser: undefined, robotPassword: undefined }, source: "local" });
  }
  return out;
}
