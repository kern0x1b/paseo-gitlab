import type { Detail, DiffFile, DiffLine } from "../../shared/contract";

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

export function suggestionFor(lines: DiffLine[]): string {
  const kept = lines.filter((line) => line.kind !== "removed");
  return `\`\`\`suggestion:-${Math.max(0, kept.length - 1)}+0\n${kept.map((line) => line.text).join("\n")}\n\`\`\``;
}

export function agentMessage(
  detail: Detail,
  selection: CodeSelection,
  comment: string,
  intro: "Review comment on" | "Question about" = "Review comment on",
): string {
  const path = selection.file.newPath;
  const code = selection.lines
    .map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`)
    .join("\n");
  return [
    `${intro} ${detail.reference} "${detail.title}"`,
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
    parts.push(
      "",
      `${index + 1}. ${comment.newPath}, ${rangeLabel(comment.lines)}:`,
      "```diff",
      code,
      "```",
      comment.body,
    );
  });
  return parts.join("\n");
}
