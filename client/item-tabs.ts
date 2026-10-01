import { useSyncExternalStore } from "react";
import type { ItemRef } from "../shared/contract";

export interface ItemTab {
  ref: ItemRef;
  title: string | null;
}

interface WorkspaceTabs {
  tabs: ItemTab[];
  active: string | null;
}

const STORAGE_KEY = "paseo-gitlab:item-tabs";
const MAX_TABS = 12;
const EMPTY: WorkspaceTabs = { tabs: [], active: null };
const listeners = new Set<() => void>();
let state: Record<string, WorkspaceTabs> = load();

function load(): Record<string, WorkspaceTabs> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}") as Record<string, WorkspaceTabs>;
  } catch {
    return {};
  }
}

export function tabKey(ref: ItemRef): string {
  return `${ref.kind}:${ref.projectPath}:${ref.iid}`;
}

function save(workspaceId: string, next: WorkspaceTabs): void {
  state = { ...state, [workspaceId]: next };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  for (const listener of listeners) {
    listener();
  }
}

export function openItemTab(workspaceId: string, ref: ItemRef, title: string | null = null): void {
  const current = state[workspaceId] ?? EMPTY;
  const key = tabKey(ref);
  const exists = current.tabs.some((tab) => tabKey(tab.ref) === key);
  const tabs = exists ? current.tabs : [...current.tabs, { ref, title }].slice(-MAX_TABS);
  save(workspaceId, { tabs, active: key });
}

export function activateItemTab(workspaceId: string, key: string): void {
  save(workspaceId, { ...(state[workspaceId] ?? EMPTY), active: key });
}

export function closeItemTab(workspaceId: string, key: string): void {
  const current = state[workspaceId] ?? EMPTY;
  const index = current.tabs.findIndex((tab) => tabKey(tab.ref) === key);
  const tabs = current.tabs.filter((tab) => tabKey(tab.ref) !== key);
  const neighbour = tabs[Math.min(index, tabs.length - 1)];
  const active = current.active === key ? (neighbour ? tabKey(neighbour.ref) : null) : current.active;
  save(workspaceId, { tabs, active });
}

export function useItemTabs(workspaceId: string): WorkspaceTabs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state[workspaceId] ?? EMPTY,
    () => EMPTY,
  );
}
