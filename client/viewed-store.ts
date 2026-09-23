import { useSyncExternalStore } from "react";

/**
 * Files you marked "Viewed" in an MR's diff, per MR, each with a fingerprint of
 * the diff you saw: when a push changes the file, the mark lapses by itself.
 * Also when you last reviewed the MR from here, for "changes since your review".
 */
const VIEWED_KEY = "paseo-gitlab:viewed";
const REVIEWED_KEY = "paseo-gitlab:reviewed-at";
const EMPTY: Record<string, string> = {};
const listeners = new Set<() => void>();

function load<T>(key: string): Record<string, T> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

let viewed: Record<string, Record<string, string>> = load(VIEWED_KEY);
let reviewedAt: Record<string, string> = load(REVIEWED_KEY);

function persist(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // No storage: the marks last until the window closes.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setViewed(review: string, file: string, hash: string | null): void {
  const marks = { ...(viewed[review] ?? {}) };
  if (hash) {
    marks[file] = hash;
  } else {
    delete marks[file];
  }
  viewed = { ...viewed, [review]: marks };
  persist(VIEWED_KEY, viewed);
}

export function markReviewed(review: string): void {
  reviewedAt = { ...reviewedAt, [review]: new Date().toISOString() };
  persist(REVIEWED_KEY, reviewedAt);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewed(review: string): Record<string, string> {
  return useSyncExternalStore(
    subscribe,
    () => viewed[review] ?? EMPTY,
    () => EMPTY,
  );
}

export function useReviewedAt(review: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => reviewedAt[review] ?? null,
    () => null,
  );
}
