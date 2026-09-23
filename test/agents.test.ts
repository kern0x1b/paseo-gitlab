/**
 * The pieces behind the agent hand-off, the @GitLab picker, the workspace card and
 * the header badge.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { badgeFor } from "../client/header-buttons";
import type { Detail, Lists } from "../shared/contract";
import { agentPrompt, itemContext } from "../server/agent-context";
import { parseReference } from "../server/queries";
import { parseRemote, readCheckout } from "../server/workspace";

const HOST = "https://gitlab.example.com";

describe("parseRemote", () => {
  it("reads scp-style, ssh and https remotes", () => {
    assert.deepEqual(parseRemote("git@gitlab.example.com:group/sub/project.git"), {
      hostname: "gitlab.example.com",
      path: "group/sub/project",
    });
    assert.deepEqual(parseRemote("ssh://git@gitlab.example.com:2222/group/project.git"), {
      hostname: "gitlab.example.com",
      path: "group/project",
    });
    assert.deepEqual(parseRemote("https://gitlab.example.com/group/project"), {
      hostname: "gitlab.example.com",
      path: "group/project",
    });
  });

  it("finds the checkout only on the connected host and a real branch", async () => {
    const git = (answers: Record<string, string | null>) => async (_dir: string, args: string[]) =>
      answers[args.join(" ")] ?? null;
    assert.deepEqual(
      await readCheckout(
        "/w",
        HOST,
        git({
          "rev-parse --abbrev-ref HEAD": "feature",
          "remote get-url origin": "git@gitlab.example.com:g/p.git",
        }),
      ),
      { branch: "feature", projectPath: "g/p" },
    );
    assert.equal(
      await readCheckout(
        "/w",
        HOST,
        git({ "rev-parse --abbrev-ref HEAD": "feature", "remote get-url origin": "git@github.com:g/p.git" }),
      ),
      null,
    );
    assert.equal(
      await readCheckout(
        "/w",
        HOST,
        git({
          "rev-parse --abbrev-ref HEAD": "HEAD",
          "remote get-url origin": "git@gitlab.example.com:g/p.git",
        }),
      ),
      null,
    );
  });
});

describe("parseReference", () => {
  it("resolves references and URLs, bare numbers against the default project", () => {
    assert.deepEqual(parseReference("!12", HOST, "g/p"), {
      kind: "item",
      ref: { kind: "mr", projectPath: "g/p", iid: "12" },
    });
    assert.deepEqual(parseReference("other/x#3", HOST, "g/p"), {
      kind: "item",
      ref: { kind: "issue", projectPath: "other/x", iid: "3" },
    });
    assert.deepEqual(parseReference(`${HOST}/g/p/-/merge_requests/9#note_1`, HOST, null), {
      kind: "item",
      ref: { kind: "mr", projectPath: "g/p", iid: "9" },
    });
    assert.deepEqual(parseReference(`${HOST}/g/p/-/jobs/77`, HOST, null), {
      kind: "job",
      projectPath: "g/p",
      jobId: "gid://gitlab/Ci::Build/77",
    });
    assert.equal(parseReference("https://elsewhere.example.com/g/p/-/issues/1", HOST, null), null);
    assert.equal(parseReference("some words", HOST, "g/p"), null);
    assert.equal(parseReference("#3", HOST, null), null);
  });
});

describe("badgeFor", () => {
  const lists = (reviews: number, todos: number, failed: number) =>
    ({
      reviewMergeRequests: Array.from({ length: reviews }, () => ({})),
      todos: Array.from({ length: todos }, () => ({})),
      mergeRequests: Array.from({ length: failed }, () => ({ pipelineStatus: "FAILED" })),
      issues: [],
    }) as unknown as Lists;

  it("counts what waits on you and marks failed pipelines", () => {
    assert.deepEqual(badgeFor(lists(2, 1, 1)), {
      label: "3 ✕",
      title: "GitLab — 2 reviews, 1 to-do, 1 failed pipeline",
    });
    assert.deepEqual(badgeFor(lists(0, 0, 0)), { label: undefined, title: "GitLab" });
    assert.deepEqual(badgeFor(null), { label: undefined, title: "GitLab" });
  });
});

describe("agent context", () => {
  const detail = (description: string): Detail =>
    ({
      kind: "mr",
      reference: "g/p!7",
      title: "Fix it",
      webUrl: `${HOST}/g/p/-/merge_requests/7`,
      sourceBranch: "fix",
      targetBranch: "main",
      pipelineStatus: "FAILED",
      description,
      discussions: [
        {
          id: "d1",
          resolvable: true,
          resolved: false,
          notes: [
            {
              body: "Rename this",
              author: { username: "rev" },
              position: { path: "a.ts", newLine: 3, oldLine: null },
              system: false,
            },
            { body: "Done?", author: { username: "me" }, position: null, system: false },
          ],
        },
        {
          id: "d2",
          resolvable: true,
          resolved: true,
          notes: [{ body: "old", author: null, position: null, system: false }],
        },
      ],
    }) as unknown as Detail;

  it("lists only unresolved threads with their file and line, and the failed job logs", () => {
    const text = agentPrompt(detail("Why"), [
      {
        name: "unit",
        stage: "test",
        log: {
          lines: [{ section: false, segments: [{ text: "boom", color: "red", bold: false }] }],
          totalLines: 1,
        },
      },
    ]);
    assert.match(text, /^Please address the 1 unresolved review thread and fix the failing job below\./);
    assert.match(text, /1\. \(a\.ts:3\) @rev: Rename this\n {3}↳ @me: Done\?/);
    assert.doesNotMatch(text, /old/);
    assert.match(text, /Failed job "unit" \(stage test\)[\s\S]*boom/);
  });

  it("cuts a huge description and points at the full one", () => {
    const text = itemContext(detail("x".repeat(20_000)), []);
    assert.ok(text.length < 10_000);
    assert.match(
      text,
      /truncated; the full description is at https:\/\/gitlab\.example\.com\/g\/p\/-\/merge_requests\/7/,
    );
  });
});
