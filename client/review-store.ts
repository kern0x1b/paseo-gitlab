import { useSyncExternalStore } from "react";
import type { DiffLine, ItemRef } from "../shared/contract";

/**
 * Comments you are collecting on an MR's diff before deciding where they go: to
 * one of your agents, or to GitLab as a review. Kept on this machine, per MR, so
 * a reload or a detour to another MR does not lose them.
 */
export interface PendingComment {
  id: string;
  oldPath: string;
  newPath: string;
  /** The selected lines, first to last, as the diff showed them. */
  lines: DiffLine[];
  body: string;
  createdAt: string;
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
  } catch {
    // No storage: the review lasts until the window closes.
  }
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

/** Whether a pending comment ends on this diff line, which is where it is shown. */
export function endsAt(comment: PendingComment, line: DiffLine): boolean {
  const last = comment.lines[comment.lines.length - 1];
  return Boolean(last && last.kind === line.kind && last.oldPos === line.oldPos && last.newPos === line.newPos);
}
