import assert from "node:assert/strict";
import test from "node:test";
import { parseUnifiedDiff } from "../server/diff";
import {
  contentHash,
  hideWhitespace,
  sinceLastReview,
  splitRows,
  TAIL,
  withContext,
} from "../client/ui/diff-view";

const file = (diff: string) => ({ lines: parseUnifiedDiff(diff), newFile: false, deletedFile: false });
const source = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);

test("a closed gap says how many lines it hides, and the tail is offered", () => {
  const diff = file("@@ -4,2 +4,2 @@\n line 4\n-old 5\n+line 5\n");
  const shown = withContext(diff, null, new Set());
  assert.equal(shown[0]!.gap, 0);
  assert.equal(shown[0]!.gapSize, 3);
  const tail = shown[shown.length - 1]!;
  assert.equal(tail.gap, TAIL);
  assert.equal(tail.gapSize, null);
});

test("an open gap is filled from the file with both line numbers", () => {
  const diff = file("@@ -3,2 +4,2 @@\n line 4\n-old\n+line 5\n");
  const shown = withContext(diff, [...source, ""], new Set([0, TAIL]));
  assert.deepEqual(
    shown.slice(0, 3).map((line) => [line.oldLine, line.newLine, line.text, line.expanded]),
    [
      [0, 1, "line 1", true],
      [1, 2, "line 2", true],
      [2, 3, "line 3", true],
    ],
  );
  const last = shown[shown.length - 1]!;
  assert.deepEqual([last.oldLine, last.newLine, last.text], [11, 12, "line 12"]);
  assert.equal(shown.filter((line) => line.kind === "hunk").length, 0);
});

test("once the file is known, no tail is offered when the diff reaches its end", () => {
  const diff = file("@@ -11,2 +11,2 @@\n line 11\n-old\n+line 12\n");
  const shown = withContext(diff, source, new Set());
  assert.equal(
    shown.some((line) => line.gap === TAIL),
    false,
  );
});

test("a new file has nothing to expand", () => {
  const diff = { ...file("@@ -0,0 +1,1 @@\n+hello\n"), newFile: true };
  assert.equal(withContext(diff, null, new Set()).length, 2);
});

test("whitespace-only changes fold into unchanged lines, real ones stay", () => {
  const lines = parseUnifiedDiff("@@ -1,3 +1,3 @@\n-  a(1)\n-b\n+    a(1)\n+ b\n-c\n+d\n");
  const shown = hideWhitespace(lines);
  assert.deepEqual(
    shown.map((line) => [line.kind, line.folded ?? false, line.oldLine, line.newLine]),
    [
      ["hunk", false, null, null],
      ["context", true, 1, 1],
      ["context", true, 2, 2],
      ["removed", false, 3, null],
      ["added", false, null, 3],
    ],
  );
});

test("side by side pairs removed lines with the added ones", () => {
  const lines = parseUnifiedDiff("@@ -1,3 +1,2 @@\n x\n-a\n-b\n+c\n");
  assert.deepEqual(splitRows(lines), [
    { full: 0 },
    { left: 1, right: 1 },
    { left: 2, right: 4 },
    { left: 3, right: null },
  ]);
});

test("the content hash changes with the diff", () => {
  const one = contentHash({ lines: parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b\n") });
  assert.equal(one, contentHash({ lines: parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b\n") }));
  assert.notEqual(one, contentHash({ lines: parseUnifiedDiff("@@ -1 +1 @@\n-a\n+c\n") }));
});

test("since your last review: from the head you saw to the newest", () => {
  const version = (id: string, createdAt: string) => ({
    id,
    headSha: `h${id}`,
    baseSha: "b",
    startSha: "s",
    createdAt,
  });
  const versions = [version("3", "2026-09-03"), version("2", "2026-09-02"), version("1", "2026-09-01")];
  assert.deepEqual(sinceLastReview(versions, "2026-09-01T12:00"), { from: "h1", to: "h3", pushes: 2 });
  assert.equal(sinceLastReview(versions, "2026-09-04"), null);
  assert.equal(sinceLastReview(versions, null), null);
  assert.equal(sinceLastReview(versions, "2026-08-01"), null);
});
