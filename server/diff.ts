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

interface RawDiff {
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
      lines.push({ kind: "hunk", oldLine: null, newLine: null, text });
    } else if (text.startsWith("+")) {
      lines.push({ kind: "added", oldLine: null, newLine: newLine++, text: text.slice(1) });
    } else if (text.startsWith("-")) {
      lines.push({ kind: "removed", oldLine: oldLine++, newLine: null, text: text.slice(1) });
    } else if (text.startsWith(" ")) {
      lines.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: text.slice(1) });
    }
    // `\ No newline at end of file` and the trailing empty split carry nothing to show.
  }
  return lines;
}

function toFile(raw: RawDiff): DiffFile {
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
