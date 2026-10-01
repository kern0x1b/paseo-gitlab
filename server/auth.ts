import type { AuthStatus } from "../shared/contract";
import { GitLabError, rest, type Connection, type Fetch } from "./gitlab";
import { defaultSecretStore, type SecretStore } from "./secrets";
import { clearHost, readHost, writeHost } from "./state";

export interface AuthDeps {
  secrets: SecretStore;
  fetch: Fetch;
  readHost: () => string | null;
  writeHost: (host: string) => void;
  clearHost: () => void;
}

export function defaultAuthDeps(): AuthDeps {
  return { secrets: defaultSecretStore(), fetch, readHost, writeHost, clearHost };
}

const REQUIRED_SCOPE = "api";

interface TokenSelf {
  name: string;
  scopes: string[];
  expires_at: string | null;
  active: boolean;
}

interface CurrentUser {
  username: string;
  name: string;
}

export function normalizeHost(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter the GitLab address, e.g. https://gitlab.com.");
  }
  if (url.protocol !== "https:") {
    throw new Error("The GitLab address must start with https://.");
  }
  return url.origin;
}

export function accountFor(host: string): string {
  return new URL(host).host;
}

async function describe(connection: Connection, fetchImpl: Fetch): Promise<AuthStatus> {
  const [user, token] = await Promise.all([
    rest<CurrentUser>(connection, "/user", fetchImpl),
    rest<TokenSelf>(connection, "/personal_access_tokens/self", fetchImpl),
  ]);
  if (!token.active) {
    throw new GitLabError("This token is no longer active.", 401);
  }
  return {
    connected: true,
    host: connection.host,
    user: { username: user.username, name: user.name },
    token: { name: token.name, scopes: token.scopes, expiresAt: token.expires_at },
  };
}

export async function storedConnection(deps: AuthDeps): Promise<Connection | null> {
  const host = deps.readHost();
  if (!host) {
    return null;
  }
  const token = await deps.secrets.read(accountFor(host));
  return token ? { host, token } : null;
}

export async function requireConnection(deps: AuthDeps): Promise<Connection> {
  const connection = await storedConnection(deps);
  if (!connection) {
    throw new Error("Not connected to GitLab. Add a token in Settings → GitLab.");
  }
  return connection;
}

export async function authStatus(deps: AuthDeps): Promise<AuthStatus> {
  const connection = await storedConnection(deps);
  if (!connection) {
    return { connected: false, host: deps.readHost(), error: null };
  }
  try {
    return await describe(connection, deps.fetch);
  } catch (error) {
    if (error instanceof GitLabError && error.status === 401) {
      return { connected: false, host: connection.host, error: error.message };
    }
    throw error;
  }
}

export async function connect(deps: AuthDeps, input: { host: string; token: string }): Promise<AuthStatus> {
  const host = normalizeHost(input.host);
  const token = input.token.trim();
  if (!token) {
    throw new Error("Paste a personal access token.");
  }
  let status: AuthStatus;
  try {
    status = await describe({ host, token }, deps.fetch);
  } catch (error) {
    if (error instanceof GitLabError && error.status === 401) {
      throw new Error("GitLab rejected this token. Check that it is copied whole and not expired.");
    }
    throw error;
  }
  if (status.connected && !status.token.scopes.includes(REQUIRED_SCOPE)) {
    throw new Error(`The token needs the "${REQUIRED_SCOPE}" scope to post comments and resolve threads.`);
  }
  await deps.secrets.write(accountFor(host), token);
  deps.writeHost(host);
  return status;
}

export async function disconnect(deps: AuthDeps): Promise<AuthStatus> {
  const host = deps.readHost();
  if (host) {
    await deps.secrets.remove(accountFor(host));
  }
  deps.clearHost();
  return { connected: false, host: host ?? null, error: null };
}
