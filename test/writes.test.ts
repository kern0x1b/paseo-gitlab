/**
 * Which GitLab mutation each write turns into, against a fake GraphQL endpoint,
 * and the diff parser that numbers the lines code comments are anchored to.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnifiedDiff } from "../server/diff";
import { createHandlers } from "../server/handlers";

const HOST = "https://gitlab.example.com";

function recordingGitLab() {
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const fetchImpl = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { query: string; variables: Record<string, unknown> };
    const operation = body.query.match(/(?:mutation|query)\s+(\w+)/)?.[1] ?? "?";
    calls.push({ operation, variables: body.variables });
    // Every mutation in the plugin reads only `errors` from its payload.
    const field = body.query.match(/\{\s*(\w+)\s*\(input/)?.[1] ?? "result";
    return Response.json({ data: { [field]: { errors: [] } } });
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

const ISSUE = { kind: "issue" as const, projectPath: "g/p", iid: "5" };
const MR = { kind: "mr" as const, projectPath: "g/p", iid: "7" };

describe("comments", () => {
  it("starts a thread with createDiscussion, and a plain comment or reply with createNote", async () => {
    const { calls, handlers } = recordingGitLab();
    await handlers.addNote({ noteableId: "gid://gitlab/Issue/1", body: "a", mode: "thread" });
    await handlers.addNote({ noteableId: "gid://gitlab/Issue/1", body: "b", mode: "comment" });
    await handlers.addNote({
      noteableId: "gid://gitlab/Issue/1",
      body: "c",
      discussionId: "gid://gitlab/Discussion/x",
      mode: "thread",
    });
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["PaseoGitLabCreateDiscussion", "PaseoGitLabCreateNote", "PaseoGitLabCreateNote"],
    );
    assert.equal(calls[2]?.variables.discussionId, "gid://gitlab/Discussion/x");
  });

  it("anchors a code comment to the MR's commits and both paths", async () => {
    const { calls, handlers } = recordingGitLab();
    await handlers.addDiffNote({
      noteableId: "gid://gitlab/MergeRequest/1",
      body: "why?",
      diffRefs: { baseSha: "b", headSha: "h", startSha: "s" },
      oldPath: "old.ts",
      newPath: "new.ts",
      oldLine: null,
      newLine: 12,
    });
    assert.deepEqual(calls[0]?.variables.position, {
      baseSha: "b",
      headSha: "h",
      startSha: "s",
      paths: { oldPath: "old.ts", newPath: "new.ts" },
      oldLine: null,
      newLine: 12,
    });
  });
});

describe("editing", () => {
  it("closes and reopens with each type's own state values", async () => {
    const { calls, handlers } = recordingGitLab();
    await handlers.updateItem({ ...ISSUE, state: "close" });
    await handlers.updateItem({ ...MR, state: "reopen" });
    assert.equal(calls[0]?.operation, "PaseoGitLabUpdateIssue");
    assert.equal(calls[0]?.variables.stateEvent, "CLOSE");
    assert.equal(calls[1]?.operation, "PaseoGitLabUpdateMergeRequest");
    assert.equal(calls[1]?.variables.state, "OPEN");
  });

  it("toggles draft without touching the title, and skips the update when only draft changes", async () => {
    const { calls, handlers } = recordingGitLab();
    await handlers.updateItem({ ...MR, draft: false });
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["PaseoGitLabSetDraft"],
    );
  });

  it("sets labels through updateIssue for issues and mergeRequestSetLabels for MRs", async () => {
    const { calls, handlers } = recordingGitLab();
    await handlers.setLabels({ ...ISSUE, labelIds: ["gid://gitlab/ProjectLabel/1"] });
    await handlers.setLabels({ ...MR, labelIds: [] });
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["PaseoGitLabUpdateIssue", "PaseoGitLabSetMergeRequestLabels"],
    );
  });

  it("replaces assignees and reviewers, and refuses reviewers on an issue", async () => {
    const { calls, handlers } = recordingGitLab();
    await handlers.setPeople({ ...MR, field: "reviewers", usernames: ["a", "b"] });
    await handlers.setPeople({ ...ISSUE, field: "assignees", usernames: [] });
    assert.deepEqual(
      calls.map((call) => [call.operation, call.variables.usernames]),
      [
        ["PaseoGitLabMergeRequestReviewers", ["a", "b"]],
        ["PaseoGitLabIssueAssignees", []],
      ],
    );
    await assert.rejects(handlers.setPeople({ ...ISSUE, field: "reviewers", usernames: [] }), /no reviewers/);
  });
});

describe("parseUnifiedDiff", () => {
  it("numbers context, added and removed lines from the hunk header", () => {
    const lines = parseUnifiedDiff(
      [
        "@@ -10,3 +10,3 @@ class A",
        " keep",
        "-old",
        "+new",
        " tail",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    );
    assert.deepEqual(
      lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text]),
      [
        ["hunk", null, null, "@@ -10,3 +10,3 @@ class A"],
        ["context", 10, 10, "keep"],
        ["removed", 11, null, "old"],
        ["added", null, 11, "new"],
        ["context", 12, 12, "tail"],
      ],
    );
  });
});
