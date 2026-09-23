/**
 * The diff panel's file tree and the message a whole review becomes for an agent.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewMessage } from "../client/ui/code-comment";
import { buildTree, type TreeNode } from "../client/ui/tree";
import type { Detail, DiffFile, DiffLine } from "../shared/contract";

const file = (newPath: string) => ({ newPath, oldPath: newPath }) as DiffFile;

function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [`${"  ".repeat(depth)}${node.name}${node.file ? "" : "/"}`, ...outline(node.children, depth + 1)]);
}

describe("buildTree", () => {
  it("collapses single-folder chains and lists folders before files", () => {
    const tree = buildTree([
      file("services/app/src/main/B.java"),
      file("services/app/src/main/a/A.java"),
      file("services/app/src/test/T.java"),
      file("README.md"),
    ]);
    assert.deepEqual(outline(tree), [
      "services/app/src/",
      "  main/",
      "    a/",
      "      A.java",
      "    B.java",
      "  test/",
      "    T.java",
      "README.md",
    ]);
  });

  it("keeps a lone file's folders as one row", () => {
    assert.deepEqual(outline(buildTree([file("a/b/c/D.java")])), ["a/b/c/", "  D.java"]);
  });
});

describe("reviewMessage", () => {
  const line = (kind: DiffLine["kind"], newLine: number | null, oldLine: number | null, text: string) =>
    ({ kind, newLine, oldLine, oldPos: 0, newPos: 0, text }) as DiffLine;
  const detail = { reference: "g/p!7", title: "Fix it", webUrl: "https://x/g/p/-/merge_requests/7", sourceBranch: "fix" } as Detail;

  it("puts the summary first, then numbered comments with their code", () => {
    const text = reviewMessage(
      detail,
      [
        { newPath: "a.ts", lines: [line("added", 3, null, "const x = 1;")], body: "Name it better" },
        { newPath: "b.ts", lines: [line("context", 9, 9, "keep"), line("removed", null, 10, "gone")], body: "Why?" },
      ],
      "Two small things.",
    );
    assert.match(text, /^Review of g\/p!7 "Fix it" on branch fix\nhttps:\/\/x\/g\/p\/-\/merge_requests\/7\n\nTwo small things\.\n\n2 comments on the code:/);
    assert.match(text, /1\. a\.ts, line 3:\n```diff\n\+const x = 1;\n```\nName it better/);
    assert.match(text, /2\. b\.ts, lines 9–10:\n```diff\n keep\n-gone\n```\nWhy\?$/);
  });
});
