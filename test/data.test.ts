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
import { projectPathOf, toDetail, toLists } from "../server/queries";

const HOST = "https://gitlab.example.com";

describe("projectPathOf", () => {
  it("strips the issue or MR number from a full reference", () => {
    assert.equal(projectPathOf("group/sub/project#12"), "group/sub/project");
    assert.equal(projectPathOf("group/project!3456"), "group/project");
  });
});

describe("toLists", () => {
  it("maps issues and both MR lists, tolerating missing connections", () => {
    const lists = toLists({
      currentUser: {
        authoredMergeRequests: {
          nodes: [
            {
              iid: "7",
              title: "Fix it",
              webUrl: `${HOST}/g/p/-/merge_requests/7`,
              reference: "g/p!7",
              updatedAt: "2026-09-23T10:00:00Z",
              userNotesCount: 2,
              draft: true,
              detailedMergeStatus: "DRAFT_STATUS",
              headPipeline: { status: "FAILED" },
              labels: { nodes: [{ title: "bug", color: "#f00", textColor: "#fff" }] },
            },
          ],
        },
        reviewRequestedMergeRequests: null,
      },
      issues: { nodes: [] },
    });
    assert.equal(lists.issues.length, 0);
    assert.equal(lists.reviewMergeRequests.length, 0);
    assert.deepEqual(lists.authoredMergeRequests[0], {
      kind: "mr",
      projectPath: "g/p",
      iid: "7",
      reference: "g/p!7",
      title: "Fix it",
      webUrl: `${HOST}/g/p/-/merge_requests/7`,
      updatedAt: "2026-09-23T10:00:00Z",
      userNotesCount: 2,
      labels: [{ title: "bug", color: "#f00", textColor: "#fff" }],
      draft: true,
      confidential: false,
      pipelineStatus: "FAILED",
      mergeStatus: "DRAFT_STATUS",
    });
  });
});

describe("toDetail", () => {
  it("keeps threads with their notes and defaults what an issue does not have", () => {
    const detail = toDetail("issue", {
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
    });
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
      await fetchImage({ host: HOST, token: "t" }, src, reply(png, { headers: { "content-type": "application/octet-stream" } })),
      `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    );
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>";
    assert.equal(await fetchImage({ host: HOST, token: "t" }, src, reply(svg, { headers: { "content-type": "image/svg+xml" } })), null);
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
