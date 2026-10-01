import { useSyncExternalStore } from "react";
import type { ItemRef } from "../shared/contract";

const STORAGE_KEY = "paseo-gitlab:diff-targets";

const listeners = new Set<() => void>();
let targets: Record<string, ItemRef> = load();

function load(): Record<string, ItemRef> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ItemRef>) : {};
  } catch {
    return {};
  }
}

export function setDiffTarget(workspaceId: string, target: ItemRef): void {
  targets = { ...targets, [workspaceId]: target };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(targets));
  } catch {}
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDiffTarget(workspaceId: string): ItemRef | null {
  return useSyncExternalStore(
    subscribe,
    () => targets[workspaceId] ?? null,
    () => null,
  );
}
