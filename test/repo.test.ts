/**
 * The repository browser's reads and branch writes, against a fake REST endpoint.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHandlers } from "../server/handlers";

const HOST = "https://gitlab.example.com";

function fakeGitLab(respond: (url: URL, method: string) => unknown) {
  const calls: { method: string; url: URL }[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string }) => {
    const parsed = new URL(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: parsed });
    return Response.json(respond(parsed, method));
  }) as unknown as typeof fetch;
  const handlers = createHandlers({
    secrets: { read: async () => "token", write: async () => {}, remove: async () => {} },
    fetch: fetchImpl,
    readHost: () => HOST,
    writeHost() {},
    clearHost() {},
  });
  return { calls, handlers };
}

const commit = (id: string, createdAt: string) => ({
  id,
  short_id: id.slice(0, 8),
  parent_ids: ["parent"],
  title: `commit ${id}`,
  author_name: "A",
  created_at: createdAt,
  web_url: `${HOST}/c/${id}`,
});

describe("repository", () => {
  it("lists a folder with folders first and drops submodules", async () => {
    const { handlers, calls } = fakeGitLab(() => [
      { name: "b.ts", path: "src/b.ts", type: "blob" },
      { name: "lib", path: "src/lib", type: "commit" },
      { name: "z", path: "src/z", type: "tree" },
      { name: "a.ts", path: "src/a.ts", type: "blob" },
    ]);
    const tree = await handlers.repoTree({ projectPath: "g/p", ref: "main", path: "src" });
    assert.deepEqual(
      tree.entries.map((entry) => entry.name),
      ["z", "a.ts", "b.ts"],
    );
    assert.equal(calls[0]!.url.searchParams.get("path"), "src");
    assert.equal(calls[0]!.url.searchParams.get("ref"), "main");
  });

  it("lists the default branch first, then by latest commit", async () => {
    const { handlers } = fakeGitLab((url) =>
      url.pathname.endsWith("/branches")
        ? [
            {
              name: "old",
              default: false,
              protected: false,
              merged: false,
              can_push: true,
              web_url: "",
              commit: commit("1", "2026-01-01"),
            },
            {
              name: "main",
              default: true,
              protected: true,
              merged: false,
              can_push: false,
              web_url: "",
              commit: commit("2", "2025-01-01"),
            },
            {
              name: "new",
              default: false,
              protected: false,
              merged: true,
              can_push: true,
              web_url: "",
              commit: commit("3", "2026-09-01"),
            },
          ]
        : { default_branch: "main" },
    );
    const result = await handlers.branches({ projectPath: "g/p", search: "" });
    assert.deepEqual(
      result.branches.map((branch) => branch.name),
      ["main", "new", "old"],
    );
    assert.equal(result.defaultBranch, "main");
    assert.equal(result.branches[0]!.commit.parentSha, "parent");
  });

  it("creates and deletes a branch by name", async () => {
    const { handlers, calls } = fakeGitLab(() => ({ name: "feature/x" }));
    await handlers.createBranch({ projectPath: "g/p", name: "feature/x", ref: "main" });
    await handlers.deleteBranch({ projectPath: "g/p", name: "feature/x" });
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.url.searchParams.get("branch"), "feature/x");
    assert.equal(calls[1]!.method, "DELETE");
    assert.match(calls[1]!.url.pathname, /branches\/feature%2Fx$/);
  });
});

describe("accounts", () => {
  it("runs a request as the account it names and falls back to the default", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "paseo-gitlab-"));
    const state = await import("../server/state");
    state.writeHost("https://one.example.com");
    state.writeHost("https://two.example.com");
    assert.deepEqual(state.readAccounts(), {
      hosts: ["https://one.example.com", "https://two.example.com"],
      active: "https://two.example.com",
    });
    assert.equal(
      state.withAccount("https://one.example.com", () => state.readHost()),
      "https://one.example.com",
    );
    assert.equal(state.readHost(), "https://two.example.com");
    state.withAccount("https://two.example.com", () => state.clearHost());
    assert.deepEqual(state.readAccounts(), {
      hosts: ["https://one.example.com"],
      active: "https://one.example.com",
    });
  });

  it("matches a checkout's origin to a connected GitLab", async () => {
    const { hostForDirectory } = await import("../server/workspace");
    const git = async () => "git@gitlab.two.example.com:group/project.git";
    assert.equal(
      await hostForDirectory("/x", ["https://gitlab.one.example.com", "https://gitlab.two.example.com"], git),
      "https://gitlab.two.example.com",
    );
    assert.equal(await hostForDirectory("/x", ["https://gitlab.one.example.com"], git), null);
  });
});
