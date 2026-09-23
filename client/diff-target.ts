import { useSyncExternalStore } from "react";
import type { ItemRef } from "../shared/contract";

/**
 * Paseo opens a plugin panel by id alone, with no arguments, so the diff panel
 * learns which MR to show from here: the GitLab panel writes the target, then
 * opens the diff panel of the same workspace, which reads it. Where comments go
 * is kept the same way, per workspace, and both survive a reload.
 */
export type CommentDestination =
  | { kind: "agent"; agentId: string | null }
  | { kind: "gitlab"; asDraft: boolean };

interface WorkspaceDiffState {
  target: ItemRef | null;
  destination: CommentDestination;
}

const STORAGE_KEY = "paseo-gitlab:diff-state";
const DEFAULT_STATE: WorkspaceDiffState = { target: null, destination: { kind: "agent", agentId: null } };

const listeners = new Set<() => void>();
let states: Record<string, WorkspaceDiffState> = load();

function load(): Record<string, WorkspaceDiffState> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WorkspaceDiffState>) : {};
  } catch {
    return {};
  }
}

function update(workspaceId: string, patch: Partial<WorkspaceDiffState>): void {
  states = { ...states, [workspaceId]: { ...(states[workspaceId] ?? DEFAULT_STATE), ...patch } };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch {
    // Private mode or no storage: the choice lasts until the window closes.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setDiffTarget(workspaceId: string, target: ItemRef): void {
  update(workspaceId, { target });
}

export function setCommentDestination(workspaceId: string, destination: CommentDestination): void {
  update(workspaceId, { destination });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceDiffState(workspaceId: string): WorkspaceDiffState {
  return useSyncExternalStore(
    subscribe,
    () => states[workspaceId] ?? DEFAULT_STATE,
    () => DEFAULT_STATE,
  );
}
