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

export interface ProjectRef {
  name: string;
  account: string;
  cfg: HetznerConfig;
}

const PREFIX = "HETZNER_CLOUD_TOKEN_";

export function discoverProjects(base: HetznerConfig, env: NodeJS.ProcessEnv = process.env): ProjectRef[] {
  const defaultAccount = env.HETZNER_ACCOUNT_NAME?.trim() || "Hetzner account";
  const out: ProjectRef[] = [];
  const seen = new Set<string>();
  if (base.cloudToken) {
    const name = env.HETZNER_PROJECT_NAME?.trim() || "default";
    out.push({ name, account: defaultAccount, cfg: base });
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
    out.push({ name, account, cfg: { ...base, cloudToken: token, robotUser: undefined, robotPassword: undefined } });
  }
  return out;
}
