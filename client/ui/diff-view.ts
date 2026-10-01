import type { DiffFile, DiffLine, MergeRequestVersion } from "../../shared/contract";

export type ShownLine = DiffLine & {
  expanded?: boolean;
  folded?: boolean;
  gap?: number;
  gapSize?: number | null;
};

export const TAIL = -1;

function fileBody(fileLines: string[]): string[] {
  return fileLines.length > 0 && fileLines[fileLines.length - 1] === "" ? fileLines.slice(0, -1) : fileLines;
}

function unchanged(text: string, oldLine: number, newLine: number): ShownLine {
  return { kind: "context", oldLine, newLine, oldPos: oldLine, newPos: newLine, text, expanded: true };
}

export function withContext(
  file: Pick<DiffFile, "lines" | "newFile" | "deletedFile">,
  fileLines: string[] | null,
  open: ReadonlySet<number>,
): ShownLine[] {
  if (file.newFile || file.deletedFile) {
    return file.lines;
  }
  const body = fileLines ? fileBody(fileLines) : null;
  const shown: ShownLine[] = [];
  let lastOld = 0;
  let lastNew = 0;
  file.lines.forEach((line, index) => {
    if (line.kind === "hunk") {
      const from = lastNew + 1;
      const size = line.newPos - from;
      const shift = line.newPos - line.oldPos;
      if (size > 0 && open.has(index) && body) {
        for (let newLine = from; newLine < line.newPos; newLine += 1) {
          shown.push(unchanged(body[newLine - 1] ?? "", newLine - shift, newLine));
        }
      } else {
        shown.push({ ...line, gap: size > 0 ? index : undefined, gapSize: size > 0 ? size : 0 });
      }
      return;
    }
    shown.push(line);
    if (line.newLine != null) {
      lastNew = line.newLine;
    }
    if (line.oldLine != null) {
      lastOld = line.oldLine;
    }
  });
  const rest = body ? body.length - lastNew : null;
  if (file.lines.length > 0 && (rest === null || rest > 0)) {
    if (open.has(TAIL) && body) {
      for (let newLine = lastNew + 1; newLine <= body.length; newLine += 1) {
        shown.push(unchanged(body[newLine - 1] ?? "", lastOld + (newLine - lastNew), newLine));
      }
    } else {
      shown.push({
        kind: "hunk",
        oldLine: null,
        newLine: null,
        oldPos: lastOld + 1,
        newPos: lastNew + 1,
        text: "",
        gap: TAIL,
        gapSize: rest,
      });
    }
  }
  return shown;
}

const squeeze = (text: string) => text.replace(/\s+/g, "");

export function hideWhitespace(lines: ShownLine[]): ShownLine[] {
  const shown: ShownLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind !== "removed") {
      shown.push(line);
      index += 1;
      continue;
    }
    let removedEnd = index;
    while (lines[removedEnd]?.kind === "removed") {
      removedEnd += 1;
    }
    let addedEnd = removedEnd;
    while (lines[addedEnd]?.kind === "added") {
      addedEnd += 1;
    }
    const removed = lines.slice(index, removedEnd);
    const added = lines.slice(removedEnd, addedEnd);
    const same =
      removed.length === added.length &&
      removed.every((old, at) => squeeze(old.text) === squeeze(added[at]!.text));
    if (same) {
      removed.forEach((old, at) => {
        const next = added[at]!;
        shown.push({ ...next, kind: "context", oldLine: old.oldLine, oldPos: old.oldPos, folded: true });
      });
    } else {
      shown.push(...removed, ...added);
    }
    index = addedEnd;
  }
  return shown;
}

export type SplitRow = { full: number } | { left: number | null; right: number | null };

export function splitRows(lines: ShownLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === "hunk") {
      rows.push({ full: index });
      index += 1;
    } else if (line.kind === "context") {
      rows.push({ left: index, right: index });
      index += 1;
    } else {
      const removed: number[] = [];
      const added: number[] = [];
      while (lines[index]?.kind === "removed") {
        removed.push(index);
        index += 1;
      }
      while (lines[index]?.kind === "added") {
        added.push(index);
        index += 1;
      }
      for (let at = 0; at < Math.max(removed.length, added.length); at += 1) {
        rows.push({ left: removed[at] ?? null, right: added[at] ?? null });
      }
    }
  }
  return rows;
}

export function contentHash(file: Pick<DiffFile, "lines">): string {
  let hash = 5381;
  for (const line of file.lines) {
    const text = `${line.kind[0]}${line.text}\n`;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
    }
  }
  return (hash >>> 0).toString(36);
}

export function sinceLastReview(
  versions: MergeRequestVersion[],
  reviewedAt: string | null,
): { from: string; to: string; pushes: number } | null {
  if (!reviewedAt || versions.length < 2) {
    return null;
  }
  const seen = versions.findIndex((version) => version.createdAt <= reviewedAt);
  if (seen <= 0) {
    return null;
  }
  return { from: versions[seen]!.headSha, to: versions[0]!.headSha, pushes: seen };
}
