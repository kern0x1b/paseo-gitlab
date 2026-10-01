import { useSyncExternalStore } from "react";
import type { DiffLine, ItemRef } from "../shared/contract";

export interface PendingComment {
  id: string;
  oldPath: string;
  newPath: string;
  lines: DiffLine[];
  body: string;
  createdAt: string;
  scope?: string;
  refs?: { baseSha: string; headSha: string; startSha: string };
}

const STORAGE_KEY = "paseo-gitlab:pending-reviews";
const EMPTY: PendingComment[] = [];
const listeners = new Set<() => void>();
let reviews: Record<string, PendingComment[]> = load();

function load(): Record<string, PendingComment[]> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PendingComment[]>) : {};
  } catch {
    return {};
  }
}

export function reviewKey(ref: Pick<ItemRef, "projectPath" | "iid">): string {
  return `${ref.projectPath}!${ref.iid}`;
}

function save(key: string, comments: PendingComment[]): void {
  const next = { ...reviews };
  if (comments.length === 0) {
    delete next[key];
  } else {
    next[key] = comments;
  }
  reviews = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(reviews));
  } catch {}
  for (const listener of listeners) {
    listener();
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addPendingComment(key: string, comment: Omit<PendingComment, "id" | "createdAt">): void {
  save(key, [...(reviews[key] ?? []), { ...comment, id: newId(), createdAt: new Date().toISOString() }]);
}

export function editPendingComment(key: string, id: string, body: string): void {
  save(
    key,
    (reviews[key] ?? []).map((comment) => (comment.id === id ? { ...comment, body } : comment)),
  );
}

export function removePendingComments(key: string, ids?: string[]): void {
  save(key, ids ? (reviews[key] ?? []).filter((comment) => !ids.includes(comment.id)) : []);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePendingComments(key: string): PendingComment[] {
  return useSyncExternalStore(
    subscribe,
    () => reviews[key] ?? EMPTY,
    () => EMPTY,
  );
}

export function endsAt(comment: PendingComment, line: DiffLine): boolean {
  const last = comment.lines[comment.lines.length - 1];
  return Boolean(
    last && last.kind === line.kind && last.oldPos === line.oldPos && last.newPos === line.newPos,
  );
}
