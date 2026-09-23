/**
 * The review writes that go over REST, and grouping awards into reaction chips.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHandlers, discussionHash } from "../server/handlers";
import { toReactions } from "../server/queries";

const HOST = "https://gitlab.example.com";

function restRecorder() {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({
      method: init?.method ?? "GET",
      path: url.replace(`${HOST}/api/v4`, ""),
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(init?.method === "DELETE" ? "" : "{}", { status: init?.method === "DELETE" ? 204 : 200 });
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

const MR = { projectPath: "g/p", iid: "7" };
const BASE = "/projects/g%2Fp/merge_requests/7";

describe("review over REST", () => {
  it("approves and revokes on the MR's approve endpoints", async () => {
    const { calls, handlers } = restRecorder();
    await handlers.mergeRequestAction({ kind: "mr", ...MR, action: "approve" });
    await handlers.mergeRequestAction({ kind: "mr", ...MR, action: "unapprove" });
    await handlers.mergeRequestAction({ kind: "mr", ...MR, action: "rebase" });
    assert.deepEqual(
      calls.map((call) => `${call.method} ${call.path}`),
      [`POST ${BASE}/approve`, `POST ${BASE}/unapprove`, `PUT ${BASE}/rebase`],
    );
  });

  it("saves a code comment draft with GitLab's REST position, and a reply draft by discussion hash", async () => {
    const { calls, handlers } = restRecorder();
    await handlers.addDraft({
      ...MR,
      body: "rename",
      code: { diffRefs: { baseSha: "b", headSha: "h", startSha: "s" }, oldPath: "a", newPath: "a", oldLine: 4, newLine: 4 },
    });
    await handlers.addDraft({ ...MR, body: "agreed", discussionId: "gid://gitlab/Discussion/abc123" });
    assert.deepEqual(calls[0]?.body, {
      note: "rename",
      position: {
        position_type: "text",
        base_sha: "b",
        head_sha: "h",
        start_sha: "s",
        old_path: "a",
        new_path: "a",
        old_line: 4,
        new_line: 4,
      },
    });
    assert.deepEqual(calls[1]?.body, { note: "agreed", in_reply_to_discussion_id: "abc123" });
    assert.equal(discussionHash("gid://gitlab/Discussion/abc123"), "abc123");
  });

  it("publishes the drafts before approving, never the other way round", async () => {
    const { calls, handlers } = restRecorder();
    await handlers.submitReview({ ...MR, approve: true });
    await handlers.submitReview({ ...MR, approve: false });
    assert.deepEqual(
      calls.map((call) => `${call.method} ${call.path}`),
      [`POST ${BASE}/draft_notes/bulk_publish`, `POST ${BASE}/approve`, `POST ${BASE}/draft_notes/bulk_publish`],
    );
  });

  it("applies a suggestion by its numeric id", async () => {
    const { calls, handlers } = restRecorder();
    await handlers.applySuggestion({ id: "gid://gitlab/Suggestion/42" });
    assert.equal(`${calls[0]?.method} ${calls[0]?.path}`, "PUT /suggestions/42/apply");
  });
});

describe("toReactions", () => {
  it("groups awards by emoji with the people who gave them", () => {
    assert.deepEqual(
      toReactions({
        nodes: [
          { name: "thumbsup", emoji: "👍", user: { username: "a" } },
          { name: "tada", emoji: "🎉", user: { username: "b" } },
          { name: "thumbsup", emoji: "👍", user: { username: "c" } },
        ],
      }),
      [
        { name: "thumbsup", emoji: "👍", users: ["a", "c"] },
        { name: "tada", emoji: "🎉", users: ["b"] },
      ],
    );
  });
});
