/**
 * Comments on diff lines: GitLab's position for one line and for a range, and the
 * message an agent gets instead.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentMessage, rangeLabel, suggestionFor } from "../client/ui/code-comment";
import type { Detail, DiffFile } from "../shared/contract";
import { codePosition, lineCode, parseUnifiedDiff } from "../server/diff";

const lines = parseUnifiedDiff(
  ["@@ -10,3 +10,4 @@", " keep", "-old", "+new one", "+new two", " tail"].join("\n"),
);
const [, keep, removed, addedOne, addedTwo] = lines;
const refs = { baseSha: "b", headSha: "h", startSha: "s" };

describe("line positions", () => {
  it("counts both sides for every line, as GitLab's line_code needs", () => {
    assert.deepEqual(
      lines.map((line) => [line.kind, line.oldPos, line.newPos]),
      [
        ["hunk", 10, 10],
        ["context", 10, 10],
        ["removed", 11, 11],
        ["added", 12, 11],
        ["added", 12, 12],
        ["context", 12, 13],
      ],
    );
    assert.match(lineCode("a.ts", addedOne!), /^[0-9a-f]{40}_12_11$/);
  });
});

describe("codePosition", () => {
  it("anchors one line by its numbers and adds no range", () => {
    const position = codePosition({
      diffRefs: refs,
      oldPath: "a.ts",
      newPath: "a.ts",
      start: addedOne!,
      end: addedOne!,
    });
    assert.equal(position.new_line, 11);
    assert.equal(position.old_line, null);
    assert.equal(position.line_range, undefined);
  });

  it("anchors a range at its last line and describes both ends", () => {
    const position = codePosition({
      diffRefs: refs,
      oldPath: "a.ts",
      newPath: "a.ts",
      start: keep!,
      end: addedTwo!,
    });
    assert.equal(position.new_line, 12);
    assert.deepEqual(position.line_range, {
      start: { line_code: lineCode("a.ts", keep!), type: "old", old_line: 10, new_line: 10 },
      end: { line_code: lineCode("a.ts", addedTwo!), type: "new", old_line: null, new_line: 12 },
    });
    const onRemoved = codePosition({
      diffRefs: refs,
      oldPath: "a.ts",
      newPath: "a.ts",
      start: removed!,
      end: removed!,
    });
    assert.equal(onRemoved.old_line, 11);
    assert.equal(onRemoved.new_line, null);
  });
});

describe("agent comments", () => {
  const file = { newPath: "src/a.ts", oldPath: "src/a.ts" } as DiffFile;
  const detail = {
    reference: "g/p!7",
    title: "Fix it",
    webUrl: "https://gitlab.example.com/g/p/-/merge_requests/7",
    sourceBranch: "fix",
  } as Detail;

  it("carries the file, the lines, the code with its diff marks and the comment", () => {
    const text = agentMessage(detail, { file, lines: [keep!, removed!, addedOne!] }, "Why remove this?");
    assert.match(text, /^Review comment on g\/p!7 "Fix it"/);
    assert.match(text, /File src\/a\.ts, lines 10–11 \(branch fix\):/);
    assert.match(text, /```diff\n keep\n-old\n\+new one\n```\n\nWhy remove this\?$/);
  });

  it("labels single lines and ranges, and builds a suggestion over the kept lines", () => {
    assert.equal(rangeLabel([addedOne!]), "line 11");
    assert.equal(rangeLabel([keep!, addedTwo!]), "lines 10–12");
    assert.equal(
      suggestionFor([removed!, addedOne!, addedTwo!]),
      "```suggestion:-1+0\nnew one\nnew two\n```",
    );
  });
});
