/**
 * Connecting, status and disconnecting against a fake GitLab and an in-memory secret store.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountFor, authStatus, connect, disconnect, normalizeHost, type AuthDeps } from "../server/auth";
import { keychainStore, type SecretStore } from "../server/secrets";

const HOST = "https://gitlab.example.com";

function memoryStore(): SecretStore & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async read(account) {
      return entries.get(account) ?? null;
    },
    async write(account, secret) {
      entries.set(account, secret);
    },
    async remove(account) {
      entries.delete(account);
    },
  };
}

function fakeGitLab(options: { status?: number; scopes?: string[]; active?: boolean } = {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, auth: init?.headers?.Authorization ?? null });
    if (options.status && options.status !== 200) {
      return new Response("{}", { status: options.status });
    }
    if (url.endsWith("/api/v4/user")) {
      return Response.json({ username: "someone", name: "Some One" });
    }
    if (url.endsWith("/api/v4/personal_access_tokens/self")) {
      return Response.json({
        name: "Paseo",
        scopes: options.scopes ?? ["api"],
        expires_at: "2027-01-01",
        active: options.active ?? true,
      });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function deps(fetchImpl: typeof fetch, secrets = memoryStore()) {
  let host: string | null = null;
  const value: AuthDeps = {
    secrets,
    fetch: fetchImpl,
    readHost: () => host,
    writeHost: (next) => {
      host = next;
    },
    clearHost: () => {
      host = null;
    },
  };
  return { value, secrets, host: () => host };
}

describe("normalizeHost", () => {
  it("keeps only the https origin", () => {
    assert.equal(normalizeHost(" https://gitlab.example.com/group/project "), HOST);
  });

  it("refuses plain http and garbage", () => {
    assert.throws(() => normalizeHost("http://gitlab.example.com"), /https/);
    assert.throws(() => normalizeHost("gitlab"), /address/);
  });
});

describe("connect", () => {
  it("checks the token with GitLab, then stores it under the host", async () => {
    const gitlab = fakeGitLab();
    const setup = deps(gitlab.fetchImpl);
    const status = await connect(setup.value, { host: `${HOST}/`, token: " glpat-abc123 " });

    assert.equal(status.connected, true);
    assert.equal(setup.host(), HOST);
    assert.equal(setup.secrets.entries.get("gitlab.example.com"), "glpat-abc123");
    assert.ok(gitlab.calls.every((call) => call.auth === "Bearer glpat-abc123"));
  });

  it("stores nothing when GitLab rejects the token", async () => {
    const setup = deps(fakeGitLab({ status: 401 }).fetchImpl);
    await assert.rejects(connect(setup.value, { host: HOST, token: "glpat-bad" }), /rejected/);
    assert.equal(setup.secrets.entries.size, 0);
    assert.equal(setup.host(), null);
  });

  it("stores nothing for a token without the api scope", async () => {
    const setup = deps(fakeGitLab({ scopes: ["read_api"] }).fetchImpl);
    await assert.rejects(connect(setup.value, { host: HOST, token: "glpat-read" }), /"api" scope/);
    assert.equal(setup.secrets.entries.size, 0);
  });

  it("keeps each host's token when a second GitLab is added", async () => {
    const setup = deps(fakeGitLab().fetchImpl);
    await connect(setup.value, { host: HOST, token: "glpat-one" });
    await connect(setup.value, { host: "https://other.example.com", token: "glpat-two" });
    assert.deepEqual([...setup.secrets.entries.keys()], ["gitlab.example.com", "other.example.com"]);
  });
});

describe("authStatus and disconnect", () => {
  it("reports a stored token GitLab no longer accepts as disconnected, with the reason", async () => {
    const secrets = memoryStore();
    secrets.entries.set("gitlab.example.com", "glpat-expired");
    const setup = deps(fakeGitLab({ status: 401 }).fetchImpl, secrets);
    setup.value.writeHost(HOST);

    const status = await authStatus(setup.value);
    assert.equal(status.connected, false);
    assert.equal(status.connected === false && status.host, HOST);
    assert.match(status.connected === false ? (status.error ?? "") : "", /rejected/);
  });

  it("forgets the token and the host", async () => {
    const setup = deps(fakeGitLab().fetchImpl);
    await connect(setup.value, { host: HOST, token: "glpat-abc" });
    await disconnect(setup.value);
    assert.equal(setup.secrets.entries.size, 0);
    assert.deepEqual(await authStatus(setup.value), { connected: false, host: null, error: null });
  });
});

describe("keychainStore", () => {
  it("writes the token through stdin, never through argv", async () => {
    const runs: { args: string[]; stdin?: string }[] = [];
    const store = keychainStore(async (args, stdin) => {
      runs.push({ args, stdin });
      return { code: 0, stdout: "" };
    });
    await store.write(accountFor(HOST), "glpat-secret_value-1");

    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]!.args, ["-i"]);
    assert.ok(!runs[0]!.args.join(" ").includes("glpat-secret_value-1"));
    assert.equal(
      runs[0]!.stdin,
      "add-generic-password -U -a gitlab.example.com -s paseo-gitlab -w glpat-secret_value-1\n",
    );
  });

  it("refuses a value that would need quoting", async () => {
    const store = keychainStore(async () => ({ code: 0, stdout: "" }));
    await assert.rejects(store.write("gitlab.example.com", "glpat bad; rm"), /cannot be stored/);
  });
});
