import { useSyncExternalStore } from "react";
import type { ItemRef } from "../shared/contract";

/**
 * Paseo opens a plugin panel by id alone, with no arguments, so the diff panel
 * learns which MR to show from here: the GitLab panel writes the target, then
 * opens the diff panel of the same workspace, which reads it. Survives a reload.
 */
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
  } catch {
    // No storage: the choice lasts until the window closes.
  }
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
