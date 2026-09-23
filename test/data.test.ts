/**
 * Mapping GitLab's responses, the upload proxy's host check, and the small formatters.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToText, safeUrl } from "../client/html/sanitize";
import { mergeStatusLabel, shortReference, timeAgo } from "../client/ui/format";
import { fetchImage, uploadApiPath } from "../server/images";
import { parseJobLog } from "../server/log";
import { numericId, projectPathOf, toDetail, toLists, toPipeline } from "../server/queries";

const HOST = "https://gitlab.example.com";

describe("projectPathOf", () => {
  it("strips the issue or MR number from a full reference", () => {
    assert.equal(projectPathOf("group/sub/project#12"), "group/sub/project");
    assert.equal(projectPathOf("group/project!3456"), "group/project");
  });
});

describe("toLists", () => {
  const row = (reference: string, updatedAt: string) => ({
    iid: reference.split(/[#!]/)[1]!,
    title: `Title of ${reference}`,
    webUrl: `${HOST}/${reference}`,
    reference,
    updatedAt,
    userNotesCount: 0,
    headPipeline: { iid: "9", status: "FAILED" },
    labels: { nodes: [{ title: "bug", color: "#f00", textColor: "#fff" }] },
  });

  it("merges authored and assigned into one list with both roles, newest first", () => {
    const lists = toLists({
      currentUser: {
        authoredMergeRequests: {
          nodes: [row("g/p!1", "2026-09-20T00:00:00Z"), row("g/p!2", "2026-09-22T00:00:00Z")],
        },
        assignedMergeRequests: {
          nodes: [row("g/p!2", "2026-09-22T00:00:00Z"), row("g/p!3", "2026-09-21T00:00:00Z")],
        },
        reviewRequestedMergeRequests: null,
        todos: null,
      },
      assignedIssues: { nodes: [] },
      authoredIssues: { nodes: [row("g/p#7", "2026-09-01T00:00:00Z")] },
    });
    assert.deepEqual(
      lists.mergeRequests.map((item) => [item.reference, item.roles]),
      [
        ["g/p!2", ["author", "assignee"]],
        ["g/p!3", ["assignee"]],
        ["g/p!1", ["author"]],
      ],
    );
    assert.equal(lists.mergeRequests[0]?.pipelineStatus, "FAILED");
    assert.deepEqual(
      lists.issues.map((item) => [item.kind, item.projectPath, item.roles]),
      [["issue", "g/p", ["author"]]],
    );
    assert.deepEqual(lists.reviewMergeRequests, []);
  });

  it("turns to-dos on issues and MRs into openable targets and keeps the rest as links", () => {
    const lists = toLists({
      currentUser: {
        authoredMergeRequests: null,
        assignedMergeRequests: null,
        reviewRequestedMergeRequests: null,
        todos: {
          nodes: [
            {
              id: "gid://gitlab/Todo/1",
              action: "directly_addressed",
              body: "@someone please look",
              createdAt: "2026-09-23T00:00:00Z",
              targetType: "ISSUE",
              targetUrl: `${HOST}/g/p/-/issues/5#note_1`,
              author: { username: "a", name: "A" },
              target: { webUrl: `${HOST}/g/p/-/issues/5`, iid: "5", title: "Broken", reference: "g/p#5" },
            },
            {
              id: "gid://gitlab/Todo/2",
              action: "build_failed",
              body: "",
              createdAt: "2026-09-23T00:00:00Z",
              targetType: "COMMIT",
              targetUrl: `${HOST}/g/p/-/commit/abc`,
              author: null,
              target: { webUrl: `${HOST}/g/p/-/commit/abc` },
            },
          ],
        },
      },
      assignedIssues: null,
      authoredIssues: null,
    });
    assert.deepEqual(lists.todos[0]?.target, { kind: "issue", projectPath: "g/p", iid: "5" });
    assert.equal(lists.todos[0]?.title, "Broken");
    assert.equal(lists.todos[1]?.target, null);
    assert.equal(lists.todos[1]?.webUrl, `${HOST}/g/p/-/commit/abc`);
  });
});

describe("toDetail", () => {
  it("keeps threads with their notes and defaults what an issue does not have", () => {
    const detail = toDetail(
      "issue",
      {
        id: "gid://gitlab/Issue/1",
        iid: "1",
        title: "T",
        state: "opened",
        webUrl: `${HOST}/g/p/-/issues/1`,
        reference: "g/p#1",
        createdAt: "2026-09-01T00:00:00Z",
        descriptionHtml: null,
        author: null,
        discussions: {
          nodes: [
            {
              id: "gid://gitlab/Discussion/a",
              resolvable: false,
              resolved: false,
              notes: {
                nodes: [
                  {
                    id: "n1",
                    bodyHtml: "<p>hi</p>",
                    system: false,
                    createdAt: "2026-09-02T00:00:00Z",
                    author: { username: "u", name: "U" },
                  },
                ],
              },
            },
          ],
        },
      },
      "me",
    );
    assert.equal(detail.descriptionHtml, "");
    assert.deepEqual(detail.reviewers, []);
    assert.equal(detail.sourceBranch, null);
    assert.equal(detail.discussions[0]?.notes[0]?.bodyHtml, "<p>hi</p>");
  });
});

describe("uploadApiPath", () => {
  it("maps GitLab's upload paths onto the uploads API", () => {
    assert.equal(
      uploadApiPath("/-/project/69/uploads/8b317cf12025f0c88e61947796bb7397/shot.png", HOST),
      "/projects/69/uploads/8b317cf12025f0c88e61947796bb7397/shot.png",
    );
    assert.equal(
      uploadApiPath(`${HOST}/group/project/uploads/8b317cf12025f0c88e61947796bb7397/a.png`, HOST),
      "/projects/group%2Fproject/uploads/8b317cf12025f0c88e61947796bb7397/a.png",
    );
  });

  it("never sends the token to another host", async () => {
    assert.equal(
      uploadApiPath("https://evil.example.com/-/project/1/uploads/0123456789abcdef/a.png", HOST),
      null,
    );
    let called = false;
    const result = await fetchImage(
      { host: HOST, token: "t" },
      "https://evil.example.com/-/project/1/uploads/0123456789abcdef/a.png",
      (async () => {
        called = true;
        return new Response("");
      }) as unknown as typeof fetch,
    );
    assert.equal(result, null);
    assert.equal(called, false);
  });

  it("turns image bytes into a data URL whatever the content type, and anything else into null", async () => {
    const src = "/-/project/1/uploads/0123456789abcdef/a.png";
    const reply = (body: Uint8Array | string, init?: ResponseInit) =>
      (async () => new Response(body as BodyInit, init)) as unknown as typeof fetch;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    assert.equal(
      await fetchImage(
        { host: HOST, token: "t" },
        src,
        reply(png, { headers: { "content-type": "application/octet-stream" } }),
      ),
      `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    );
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>";
    assert.equal(
      await fetchImage(
        { host: HOST, token: "t" },
        src,
        reply(svg, { headers: { "content-type": "image/svg+xml" } }),
      ),
      null,
    );
    assert.equal(await fetchImage({ host: HOST, token: "t" }, src, reply("{}", { status: 404 })), null);
  });
});

describe("client helpers", () => {
  it("lets only http, https and mailto links through", () => {
    assert.equal(safeUrl("/u/someone", HOST), `${HOST}/u/someone`);
    assert.equal(safeUrl("javascript:alert(1)", HOST), null);
    assert.equal(safeUrl("data:text/html,x", HOST), null);
  });

  it("flattens HTML to text for clients without a DOM", () => {
    assert.equal(htmlToText("<p>a &amp; b</p><p>&lt;c&gt;</p>"), "a & b\n<c>");
  });

  it("formats references, ages and merge statuses", () => {
    assert.equal(shortReference("group/sub/project!12"), "project !12");
    assert.equal(timeAgo("2026-09-23T10:00:00Z", Date.parse("2026-09-23T13:30:00Z")), "3h");
    assert.equal(mergeStatusLabel("DISCUSSIONS_NOT_RESOLVED"), "Unresolved threads");
    assert.equal(mergeStatusLabel("SOMETHING_NEW"), "Something new");
  });
});

describe("toPipeline", () => {
  it("keeps stages in order, links trigger jobs to their downstream pipeline, and makes paths absolute", () => {
    const pipeline = toPipeline(
      "g/p",
      {
        id: "gid://gitlab/Ci::Pipeline/5",
        iid: "42",
        status: "FAILED",
        ref: "refs/merge-requests/7/head",
        sha: "0123456789abcdef",
        duration: 65,
        createdAt: "2026-09-23T00:00:00Z",
        finishedAt: null,
        path: "/g/p/-/pipelines/5",
        retryable: true,
        cancelable: false,
        user: null,
        detailedStatus: { label: "failed" },
        stages: {
          nodes: [
            {
              name: "test",
              status: "failed",
              jobs: {
                nodes: [
                  {
                    id: "gid://gitlab/Ci::Build/11",
                    name: "unit",
                    status: "FAILED",
                    duration: 12,
                    startedAt: null,
                    allowFailure: false,
                    manualJob: false,
                    retryable: true,
                    cancelable: false,
                    playable: false,
                    webPath: "/g/p/-/jobs/11",
                    downstreamPipeline: null,
                  },
                  {
                    id: "gid://gitlab/Ci::Bridge/12",
                    name: "trigger",
                    status: "SUCCESS",
                    duration: null,
                    startedAt: null,
                    allowFailure: false,
                    manualJob: null,
                    retryable: false,
                    cancelable: false,
                    playable: false,
                    webPath: null,
                    downstreamPipeline: { iid: "3", status: "SUCCESS", project: { fullPath: "g/child" } },
                  },
                ],
              },
            },
          ],
        },
      },
      HOST,
    );
    assert.equal(pipeline.webUrl, `${HOST}/g/p/-/pipelines/5`);
    assert.equal(pipeline.stages[0]?.jobs[0]?.webUrl, `${HOST}/g/p/-/jobs/11`);
    assert.deepEqual(pipeline.stages[0]?.jobs[1]?.downstream, {
      projectPath: "g/child",
      iid: "3",
      status: "SUCCESS",
    });
    assert.equal(numericId("gid://gitlab/Ci::Build/1042565"), "1042565");
  });
});

describe("parseJobLog", () => {
  const stamp = (text: string, continuation = false) =>
    `2026-09-23T14:09:44.898508Z 00O${continuation ? "+" : ""} ${text}`;

  it("drops runner timestamps, joins continuations and turns section markers into titles", () => {
    const raw = [
      stamp("\x1b[0KRunning with gitlab-runner\x1b[0;m"),
      stamp("section_start:1790172584:prepare_executor\r\x1b[0K"),
      stamp('\x1b[0K\x1b[36;1mPreparing the "shell" executor\x1b[0;m', true),
      stamp("\x1b[32;1mJob succeeded\x1b[0;m"),
      stamp("section_end:1790172585:prepare_executor\r\x1b[0K"),
      "",
    ].join("\n");
    const log = parseJobLog(raw);
    assert.deepEqual(log.lines, [
      { section: false, segments: [{ text: "Running with gitlab-runner", color: null, bold: false }] },
      { section: true, segments: [{ text: 'Preparing the "shell" executor', color: "cyan", bold: true }] },
      { section: false, segments: [{ text: "Job succeeded", color: "green", bold: true }] },
    ]);
  });

  it("keeps only the last drawing of a progress bar, reads plain logs, and keeps the tail when capped", () => {
    assert.deepEqual(parseJobLog("10%\r50%\r100% done\r\n").lines, [
      { section: false, segments: [{ text: "100% done", color: null, bold: false }] },
    ]);
    const capped = parseJobLog(["a", "b", "c", "d"].join("\n"), 2);
    assert.equal(capped.totalLines, 4);
    assert.deepEqual(
      capped.lines.map((line) => line.segments[0]?.text),
      ["c", "d"],
    );
  });
});

describe("role filters", () => {
  const item = (reference: string, roles: ("author" | "assignee")[]) =>
    ({ reference, roles }) as unknown as import("../shared/contract").ListItem;

  it("keeps only the chosen role, and defaults to assigned unless that would be empty", async () => {
    const { byRole, defaultRoleFilter } = await import("../client/ui/filters");
    const items = [item("a", ["author"]), item("b", ["author", "assignee"]), item("c", ["assignee"])];
    assert.deepEqual(
      byRole(items, "assignee").map((entry) => entry.reference),
      ["b", "c"],
    );
    assert.deepEqual(
      byRole(items, "author").map((entry) => entry.reference),
      ["a", "b"],
    );
    assert.equal(byRole(items, "all").length, 3);
    assert.equal(defaultRoleFilter(items), "assignee");
    assert.equal(defaultRoleFilter([item("a", ["author"])]), "all");
  });
});
