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
import type { HetznerConfig } from "../config.js";
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

export const defaultWorkspace = (env: NodeJS.ProcessEnv = process.env): string => env.HETZNER_WORKSPACE_NAME?.trim() || DEFAULT_WORKSPACE;
export const defaultAccount = (env: NodeJS.ProcessEnv = process.env): string => env.HETZNER_ACCOUNT_NAME?.trim() || "Hetzner account";

export function discoverProjects(base: HetznerConfig, env: NodeJS.ProcessEnv = process.env, stored: StoredProject[] = []): ProjectRef[] {
  const account0 = defaultAccount(env);
  const ws0 = defaultWorkspace(env);
  const out: ProjectRef[] = [];
  const seen = new Set<string>();
  if (base.cloudToken) {
    const name = env.HETZNER_PROJECT_NAME?.trim() || "default";
    out.push({ name, account: account0, workspace: ws0, cfg: base, source: "env" });
    seen.add(base.cloudToken);
  }
  for (const [key, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) {
    if (!key.startsWith(PREFIX) || !value?.trim()) continue;
    const token = value.trim();
    if (seen.has(token)) continue;
    seen.add(token);
    const suffix = key.slice(PREFIX.length);
    const name = suffix.toLowerCase().replace(/_/g, "-");
    const account = env[`HETZNER_ACCOUNT_${suffix}`]?.trim() || account0;
    const workspace = env[`HETZNER_WORKSPACE_${suffix}`]?.trim() || ws0;
    // Robot credentials belong to the default account only; extra projects are cloud only.
    out.push({ name, account, workspace, cfg: { ...base, cloudToken: token, robotUser: undefined, robotPassword: undefined }, source: "env" });
  }
  // Projects connected from the map. An env token always wins over a saved duplicate.
  for (const p of stored) {
    if (seen.has(p.token) || out.some((o) => o.name === p.name && o.account === p.account)) continue;
    seen.add(p.token);
    out.push({ name: p.name, account: p.account, workspace: p.workspace?.trim() || ws0, cfg: { ...base, cloudToken: p.token, robotUser: undefined, robotPassword: undefined }, source: "local" });
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
  const parts = raw.split("/").map((s) => s.trim());
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
