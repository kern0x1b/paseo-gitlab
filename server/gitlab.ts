/**
 * The only code that talks to GitLab. A personal access token is sent as a Bearer
 * token, which both the REST and the GraphQL API accept.
 */
export interface Connection {
  /** Origin only, e.g. `https://gitlab.example.com`. */
  host: string;
  token: string;
}

export type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 20_000;

export class GitLabError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

function headers(connection: Connection): Record<string, string> {
  return { Authorization: `Bearer ${connection.token}`, Accept: "application/json" };
}

function httpError(status: number): GitLabError {
  if (status === 401) {
    return new GitLabError("GitLab rejected the token. Reconnect in Settings → GitLab.", 401);
  }
  if (status === 403) {
    return new GitLabError("The token is not allowed to do that (403).", 403);
  }
  return new GitLabError(`GitLab returned ${status}.`, status);
}

export async function rest<T>(connection: Connection, path: string, fetchImpl: Fetch = fetch): Promise<T> {
  const response = await fetchImpl(`${connection.host}/api/v4${path}`, {
    headers: headers(connection),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw httpError(response.status);
  }
  return (await response.json()) as T;
}

export async function graphql<T>(
  connection: Connection,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: Fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${connection.host}/api/graphql`, {
    method: "POST",
    headers: { ...headers(connection), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw httpError(response.status);
  }
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new GitLabError(body.errors.map((error) => error.message).join("; "));
  }
  if (!body.data) {
    throw new GitLabError("GitLab returned an empty response.");
  }
  return body.data;
}

/** Mutations report failures in their payload's `errors`, not at the top level. */
export function assertNoMutationErrors(
  payload: { errors?: string[] } | null | undefined,
  action: string,
): void {
  if (!payload) {
    throw new GitLabError(`GitLab did not ${action}.`);
  }
  if (payload.errors?.length) {
    throw new GitLabError(payload.errors.join("; "));
  }
}
