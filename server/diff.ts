import { createHash } from "node:crypto";
import type { DiffFile, DiffLine } from "../shared/contract";
import type { Connection, Fetch } from "./gitlab";
import { GitLabError } from "./gitlab";

/**
 * An MR's changes, file by file, as numbered lines a code comment can be anchored
 * to. REST rather than GraphQL: only `GET /merge_requests/:iid/diffs` returns the
 * unified diff text, paginated.
 */
const PER_PAGE = 50;
const MAX_PAGES = 10;
/** A generated or vendored file can be tens of thousands of lines; past this it is a link. */
const MAX_LINES_PER_FILE = 2000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface RawDiff {
  diff: string;
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  too_large?: boolean | null;
  collapsed?: boolean | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const text of diff.split("\n")) {
    const hunk = text.match(HUNK);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: "hunk", oldLine: null, newLine: null, oldPos: oldLine, newPos: newLine, text });
    } else if (text.startsWith("+")) {
      lines.push({
        kind: "added",
        oldLine: null,
        newLine,
        oldPos: oldLine,
        newPos: newLine,
        text: text.slice(1),
      });
      newLine += 1;
    } else if (text.startsWith("-")) {
      lines.push({
        kind: "removed",
        oldLine,
        newLine: null,
        oldPos: oldLine,
        newPos: newLine,
        text: text.slice(1),
      });
      oldLine += 1;
    } else if (text.startsWith(" ")) {
      lines.push({
        kind: "context",
        oldLine,
        newLine,
        oldPos: oldLine,
        newPos: newLine,
        text: text.slice(1),
      });
      oldLine += 1;
      newLine += 1;
    }
    // `\ No newline at end of file` and the trailing empty split carry nothing to show.
  }
  return lines;
}

export function toFile(raw: RawDiff): DiffFile {
  const lines = raw.too_large || raw.collapsed ? [] : parseUnifiedDiff(raw.diff ?? "");
  const truncated = Boolean(raw.too_large || raw.collapsed) || lines.length > MAX_LINES_PER_FILE;
  return {
    oldPath: raw.old_path,
    newPath: raw.new_path,
    newFile: raw.new_file,
    deletedFile: raw.deleted_file,
    renamedFile: raw.renamed_file,
    additions: lines.filter((line) => line.kind === "added").length,
    deletions: lines.filter((line) => line.kind === "removed").length,
    truncated,
    lines: lines.length > MAX_LINES_PER_FILE ? [] : lines,
  };
}

export async function fetchDiffs(
  connection: Connection,
  projectPath: string,
  iid: string,
  fetchImpl: Fetch = fetch,
): Promise<{ files: DiffFile[]; truncated: boolean }> {
  const files: DiffFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchImpl(
      `${connection.host}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${encodeURIComponent(iid)}/diffs?page=${page}&per_page=${PER_PAGE}`,
      {
        headers: { Authorization: `Bearer ${connection.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new GitLabError(`GitLab returned ${response.status} for the changes.`, response.status);
    }
    const batch = (await response.json()) as RawDiff[];
    files.push(...batch.map(toFile));
    if (batch.length < PER_PAGE) {
      return { files, truncated: false };
    }
  }
  return { files, truncated: true };
}

type CodeLine = Pick<DiffLine, "kind" | "oldLine" | "newLine" | "oldPos" | "newPos">;

/** GitLab's `line_code`: sha1 of the file path, then the line's old and new positions. */
export function lineCode(path: string, line: CodeLine): string {
  return `${createHash("sha1").update(path).digest("hex")}_${line.oldPos}_${line.newPos}`;
}

function rangeEnd(path: string, line: CodeLine) {
  return {
    line_code: lineCode(path, line),
    // GitLab's own frontend sends "new" for added lines and "old" for everything else.
    type: line.kind === "added" ? "new" : "old",
    old_line: line.oldLine,
    new_line: line.newLine,
  };
}

/**
 * The REST position of a code comment. A single line is anchored by its numbers;
 * a range adds `line_range`, which is what makes GitLab show "Lines 12 to 18".
 */
export function codePosition(input: {
  diffRefs: { baseSha: string; headSha: string; startSha: string };
  oldPath: string;
  newPath: string;
  start: CodeLine;
  end: CodeLine;
}): Record<string, unknown> {
  const anchor = input.end;
  const position: Record<string, unknown> = {
    position_type: "text",
    base_sha: input.diffRefs.baseSha,
    head_sha: input.diffRefs.headSha,
    start_sha: input.diffRefs.startSha,
    old_path: input.oldPath,
    new_path: input.newPath,
    old_line: anchor.kind === "added" ? null : anchor.oldLine,
    new_line: anchor.kind === "removed" ? null : anchor.newLine,
  };
  const same = input.start.oldPos === input.end.oldPos && input.start.newPos === input.end.newPos;
  if (!same) {
    position.line_range = {
      start: rangeEnd(input.newPath, input.start),
      end: rangeEnd(input.newPath, input.end),
    };
  }
  return position;
}

/** The files changed between two commits, `from` excluded and `to` included. */
export async function fetchCompare(
  connection: Connection,
  projectPath: string,
  from: string,
  to: string,
  fetchImpl: Fetch = fetch,
  mergeBase = false,
): Promise<{ files: DiffFile[]; truncated: boolean }> {
  const response = await fetchImpl(
    `${connection.host}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&straight=${!mergeBase}`,
    {
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new GitLabError(`GitLab returned ${response.status} for the comparison.`, response.status);
  }
  const body = (await response.json()) as { diffs: RawDiff[]; compare_timeout?: boolean };
  return { files: body.diffs.map(toFile), truncated: Boolean(body.compare_timeout) };
}

/** The files changed by one commit. */
export async function fetchCommitDiffs(
  connection: Connection,
  projectPath: string,
  sha: string,
  fetchImpl: Fetch = fetch,
): Promise<{ files: DiffFile[]; truncated: boolean }> {
  const files: DiffFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchImpl(
      `${connection.host}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits/${encodeURIComponent(sha)}/diff?page=${page}&per_page=${PER_PAGE}`,
      {
        headers: { Authorization: `Bearer ${connection.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new GitLabError(`GitLab returned ${response.status} for the commit.`, response.status);
    }
    const batch = (await response.json()) as RawDiff[];
    files.push(...batch.map(toFile));
    if (batch.length < PER_PAGE) {
      return { files, truncated: false };
    }
  }
  return { files, truncated: true };
}
