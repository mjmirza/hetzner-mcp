/**
 * Which Hetzner projects and accounts to map. One Cloud token covers exactly one project,
 * so several projects mean several tokens. Tokens never leave this module's callers.
 *
 *   HETZNER_CLOUD_TOKEN            the default project
 *   HETZNER_PROJECT_NAME           display name for the default project
 *   HETZNER_CLOUD_TOKEN_<NAME>     one more project per variable, for example _PROD, _STAGING
 *   HETZNER_ACCOUNT_<NAME>         optional account label a project belongs to
 *   HETZNER_ACCOUNT_NAME           label for the default account
 *   HETZNER_WORKSPACE_<NAME>       optional workspace a project belongs to
 *   HETZNER_WORKSPACE_NAME         workspace for the default project, "Personal" when unset
 */
import { readToken, type HetznerConfig } from "../config.js";
import { normName } from "../text.js";
import type { StoredProject } from "./store.js";

export interface ProjectRef {
  name: string;
  account: string;
  /** A group of accounts, for example one client. Projects with none join the default. */
  workspace: string;
  cfg: HetznerConfig;
  /** Where the token came from. Only "local" projects can be disconnected from the map. */
  source: "env" | "local";
}

const PREFIX = "HETZNER_CLOUD_TOKEN_";
export const DEFAULT_WORKSPACE = "Personal";

export const defaultWorkspace = (env: NodeJS.ProcessEnv = process.env): string => normName(env.HETZNER_WORKSPACE_NAME) || DEFAULT_WORKSPACE;
export const defaultAccount = (env: NodeJS.ProcessEnv = process.env): string => normName(env.HETZNER_ACCOUNT_NAME) || "Hetzner account";

export function discoverProjects(base: HetznerConfig, env: NodeJS.ProcessEnv = process.env, stored: StoredProject[] = []): ProjectRef[] {
  const account0 = defaultAccount(env);
  const ws0 = defaultWorkspace(env);
  const out: ProjectRef[] = [];
  const seen = new Set<string>();
  // account + name pairs already taken, so each check is a lookup instead of a scan.
  const taken = new Set<string>();
  const pair = (account: string, name: string) => `${account}\u0000${name}`;
  if (base.cloudToken || base.cloudTokenError) {
    const name = normName(env.HETZNER_PROJECT_NAME) || "default";
    out.push({ name, account: account0, workspace: ws0, cfg: base, source: "env" });
    taken.add(pair(account0, name));
    if (base.cloudToken) seen.add(base.cloudToken);
  }
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) {
    if (!key.startsWith(PREFIX) || !value?.trim()) continue;
    // A malformed token stays on the map as an unreadable project that names its variable.
    const { token, error } = readToken(env, key);
    if (token && seen.has(token)) continue;
    if (token) seen.add(token);
    const suffix = key.slice(PREFIX.length);
    const base0 = suffix.toLowerCase().replace(/_/g, "-");
    const account = normName(env[`HETZNER_ACCOUNT_${suffix}`]) || account0;
    const workspace = normName(env[`HETZNER_WORKSPACE_${suffix}`]) || ws0;
    // _PROD and _prod give the same name; the later one gets a suffix so ids never collide.
    let name = base0;
    for (let i = 2; taken.has(pair(account, name)); i++) name = `${base0}-${i}`;
    // Robot credentials belong to the default account only; extra projects are cloud only.
    const cfg: HetznerConfig = { ...base, cloudToken: token, robotUser: undefined, robotPassword: undefined };
    if (error) cfg.cloudTokenError = error;
    else delete cfg.cloudTokenError;
    out.push({ name, account, workspace, cfg, source: "env" });
    taken.add(pair(account, name));
  }
  // Projects connected from the map. An env token always wins over a saved duplicate.
  for (const p of stored) {
    if (seen.has(p.token) || taken.has(pair(normName(p.account), p.name))) continue;
    seen.add(p.token);
    taken.add(pair(normName(p.account), p.name));
    out.push({ name: p.name, account: normName(p.account), workspace: normName(p.workspace) || ws0, cfg: { ...base, cloudToken: p.token, robotUser: undefined, robotPassword: undefined }, source: "local" });
  }
  return out;
}

export interface WorkspaceSummary {
  name: string;
  accounts: number;
  projects: number;
}

/** Workspaces with counts only, never tokens. The default workspace comes first. */
export function listWorkspaces(projects: ProjectRef[], env: NodeJS.ProcessEnv = process.env, hasRobot = false): WorkspaceSummary[] {
  const ws0 = defaultWorkspace(env);
  const groups = new Map<string, { accounts: Set<string>; projects: number }>();
  const group = (name: string) => groups.get(name) ?? groups.set(name, { accounts: new Set(), projects: 0 }).get(name)!;
  for (const p of projects) {
    const g = group(p.workspace);
    g.accounts.add(p.account);
    g.projects++;
  }
  // Robot servers belong to the default account, so they live in the default workspace.
  if (hasRobot) group(ws0).accounts.add(defaultAccount(env));
  return [...groups.entries()]
    .map(([name, g]) => ({ name, accounts: g.accounts.size, projects: g.projects }))
    .sort((a, b) => (a.name === ws0 ? -1 : b.name === ws0 ? 1 : a.name.localeCompare(b.name)));
}

export interface Target {
  workspace: string;
  account?: string;
  project?: string;
}

/** Parses "workspace" or "workspace/account/project". Returns an error text when unknown. */
export function resolveTarget(projects: ProjectRef[], raw: string, env: NodeJS.ProcessEnv = process.env, hasRobot = false): Target | { error: string } {
  const parts = raw.split("/").map((s) => normName(s));
  const names = listWorkspaces(projects, env, hasRobot).map((w) => w.name);
  const hint = `Valid workspaces: ${names.slice(0, 20).join(", ")}${names.length > 20 ? ", ..." : ""}. List every project with: npx hetzner-mcp projects list`;
  if (parts.length === 1 && parts[0]) {
    return names.includes(parts[0]) ? { workspace: parts[0] } : { error: `Unknown workspace "${parts[0]}". ${hint}` };
  }
  if (parts.length === 3 && parts.every(Boolean)) {
    const [workspace, account, project] = parts as [string, string, string];
    const hit = projects.some((p) => p.workspace === workspace && p.account === account && p.name === project);
    return hit ? { workspace, account, project } : { error: `Unknown project "${raw}". ${hint}` };
  }
  return { error: `Target must be "workspace" or "workspace/account/project". ${hint}` };
}
