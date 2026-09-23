/**
 * Composer references, search variables, saved queries and uploads.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { trailingToken } from "../client/ui/tokens";
import { formatSize } from "../client/ui/format";
import { createHandlers } from "../server/handlers";
import { referenceVariables, searchVariables } from "../server/queries";

const HOST = "https://gitlab.example.com";

describe("trailingToken", () => {
  it("finds the mention or reference being typed at the end", () => {
    assert.deepEqual(trailingToken("thanks @ole"), { trigger: "@", term: "ole", start: 7 });
    assert.deepEqual(trailingToken("see #"), { trigger: "#", term: "", start: 4 });
    assert.deepEqual(trailingToken("!46"), { trigger: "!", term: "46", start: 0 });
    assert.equal(trailingToken("mail me@example.com"), null);
    assert.equal(trailingToken("done @someone "), null);
  });
});

describe("search variables", () => {
  const base = { projectPath: "g/p", search: "", label: "", author: "", assignee: "" };

  it("drops empty filters, strips @, splits labels and maps merged issues to closed", () => {
    assert.deepEqual(searchVariables({ ...base, kind: "issue", state: "merged", label: "bug, ui", author: "@me", assignee: "you" }), {
      path: "g/p",
      search: null,
      state: "closed",
      label: ["bug", "ui"],
      author: "me",
      assignee: ["you"],
    });
    assert.deepEqual(searchVariables({ ...base, kind: "mr", state: "all", search: " gaps ", assignee: "you" }), {
      path: "g/p",
      search: "gaps",
      state: null,
      label: null,
      author: null,
      assignee: "you",
    });
  });

  it("looks a number up by iid and anything else by title", () => {
    assert.deepEqual(referenceVariables("g/p", "46577"), { path: "g/p", search: null, iids: ["46577"] });
    assert.deepEqual(referenceVariables("g/p", "gap"), { path: "g/p", search: "gap", iids: null });
  });
});

function handlersWith(fetchImpl: typeof fetch) {
  return createHandlers({
    secrets: { read: async () => "token", write: async () => {}, remove: async () => {} },
    fetch: fetchImpl,
    readHost: () => HOST,
    writeHost() {},
    clearHost() {},
  });
}

describe("saved queries", () => {
  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "paseo-gitlab-queries-"));
  });

  it("saves, lists and deletes", () => {
    const handlers = handlersWith(fetch);
    const query = { kind: "mr" as const, projectPath: "g/p", search: "", state: "opened" as const, label: "", author: "me", assignee: "" };
    const { queries } = handlers.saveQuery({ ...query, name: "Mine" });
    assert.equal(queries.length, 1);
    assert.equal(queries[0]?.name, "Mine");
    assert.deepEqual(handlers.savedQueries().queries, queries);
    assert.deepEqual(handlers.deleteQuery({ id: queries[0]!.id }).queries, []);
  });
});

describe("upload", () => {
  it("sends the file as multipart to the project's uploads and returns its Markdown", async () => {
    let seen: { url: string; file: File | null } | null = null;
    const handlers = handlersWith((async (url: string, init?: { body?: FormData }) => {
      seen = { url, file: (init?.body?.get("file") as File | null) ?? null };
      return Response.json({ markdown: "![shot](/uploads/abc/shot.png)" }, { status: 201 });
    }) as unknown as typeof fetch);
    const result = await handlers.upload({
      projectPath: "g/p",
      filename: "shot.png",
      contentType: "image/png",
      base64: Buffer.from([1, 2, 3]).toString("base64"),
    });
    assert.equal(result.markdown, "![shot](/uploads/abc/shot.png)");
    assert.equal(seen!.url, `${HOST}/api/v4/projects/g%2Fp/uploads`);
    assert.equal(seen!.file?.name, "shot.png");
    assert.equal(seen!.file?.size, 3);
  });
});

describe("formatSize", () => {
  it("picks a readable unit", () => {
    assert.equal(formatSize(512), "512 B");
    assert.equal(formatSize(2048), "2 KB");
    assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");
  });
});
