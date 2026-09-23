import type { Detail, DiffFile, DiffLine } from "../../shared/contract";

/** The selected lines of one file, first to last as shown. */
export interface CodeSelection {
  file: DiffFile;
  lines: DiffLine[];
}

export function lineNumber(line: DiffLine): number | null {
  return line.newLine ?? line.oldLine;
}

export function rangeLabel(lines: DiffLine[]): string {
  const first = lineNumber(lines[0]!);
  const last = lineNumber(lines[lines.length - 1]!);
  return first === last ? `line ${first}` : `lines ${first}–${last}`;
}

/**
 * GitLab's suggestion block for the selection: the new side of the lines, with
 * `-N+0` reaching up from the anchor (the last line) to the first.
 */
export function suggestionFor(lines: DiffLine[]): string {
  const kept = lines.filter((line) => line.kind !== "removed");
  return `\`\`\`suggestion:-${Math.max(0, kept.length - 1)}+0\n${kept.map((line) => line.text).join("\n")}\n\`\`\``;
}

/** The message an agent gets for a comment made in the diff: where, what the code is, and what you said. */
export function agentMessage(detail: Detail, selection: CodeSelection, comment: string): string {
  const path = selection.file.newPath;
  const code = selection.lines
    .map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`)
    .join("\n");
  return [
    `Review comment on ${detail.reference} "${detail.title}"`,
    detail.webUrl,
    `File ${path}, ${rangeLabel(selection.lines)}${detail.sourceBranch ? ` (branch ${detail.sourceBranch})` : ""}:`,
    "```diff",
    code,
    "```",
    "",
    comment,
  ].join("\n");
}

export interface ReviewComment {
  newPath: string;
  lines: DiffLine[];
  body: string;
}

/** A whole review for an agent: the MR, an optional summary, then every comment with its code. */
export function reviewMessage(detail: Detail, comments: ReviewComment[], summary: string): string {
  const parts = [
    `Review of ${detail.reference} "${detail.title}"${detail.sourceBranch ? ` on branch ${detail.sourceBranch}` : ""}`,
    detail.webUrl,
  ];
  if (summary.trim()) {
    parts.push("", summary.trim());
  }
  parts.push("", `${comments.length} ${comments.length === 1 ? "comment" : "comments"} on the code:`);
  comments.forEach((comment, index) => {
    const code = comment.lines
      .map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`)
      .join("\n");
    parts.push("", `${index + 1}. ${comment.newPath}, ${rangeLabel(comment.lines)}:`, "```diff", code, "```", comment.body);
  });
  return parts.join("\n");
}
