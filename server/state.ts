import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The non-secret half of the connections: which GitLabs this plugin talks to. Kept in
 * XDG state next to nothing else, so it never collides with daemon-owned files.
 */
export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "paseo-gitlab");
}

function configFile(): string {
  return join(stateDir(), "config.json");
}

interface Accounts {
  hosts: string[];
  active: string | null;
}

/** Every connected GitLab, and the one used when a request names none. */
export function readAccounts(): Accounts {
  try {
    const parsed = JSON.parse(readFileSync(configFile(), "utf8")) as {
      host?: unknown;
      hosts?: unknown;
      active?: unknown;
    };
    // `{ host }` is the file from before there could be more than one.
    const hosts = Array.isArray(parsed.hosts)
      ? parsed.hosts.filter((host): host is string => typeof host === "string")
      : typeof parsed.host === "string"
        ? [parsed.host]
        : [];
    const active =
      typeof parsed.active === "string" && hosts.includes(parsed.active) ? parsed.active : (hosts[0] ?? null);
    return { hosts, active };
  } catch {
    return { hosts: [], active: null };
  }
}

function writeAccounts(accounts: Accounts): void {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const path = configFile();
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(accounts), { mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * The GitLab a request is for. Each panel names its workspace's account, so two
 * workspaces on two GitLabs work side by side; the override lives for one request.
 */
const requestAccount = new AsyncLocalStorage<string>();

export function withAccount<T>(host: string | undefined, work: () => T): T {
  return host ? requestAccount.run(host, work) : work();
}

export function readHost(): string | null {
  return requestAccount.getStore() ?? readAccounts().active;
}

/** Adds a GitLab, or updates it, and makes it the default. */
export function writeHost(host: string): void {
  const { hosts } = readAccounts();
  writeAccounts({ hosts: hosts.includes(host) ? hosts : [...hosts, host], active: host });
}

/** Forgets the GitLab this request is for; the default moves to the next one. */
export function clearHost(): void {
  const current = readHost();
  const { hosts, active } = readAccounts();
  const rest = hosts.filter((host) => host !== current);
  if (rest.length === 0) {
    rmSync(configFile(), { force: true });
    return;
  }
  writeAccounts({ hosts: rest, active: active && rest.includes(active) ? active : rest[0]! });
}

/** Saved searches: a small list the user curates, kept next to the host. */
function queriesFile(): string {
  return join(stateDir(), "queries.json");
}

export function readSavedQueries<T>(): T[] {
  try {
    const parsed = JSON.parse(readFileSync(queriesFile(), "utf8")) as { queries?: unknown };
    return Array.isArray(parsed.queries) ? (parsed.queries as T[]) : [];
  } catch {
    return [];
  }
}

export function writeSavedQueries<T>(queries: T[]): void {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const path = queriesFile();
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ queries }), { mode: 0o600 });
  renameSync(temporary, path);
}
