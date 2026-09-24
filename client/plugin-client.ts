import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { ItemRef } from "../shared/contract";
import { setDiffTarget } from "./diff-target";
import { openItemTab } from "./item-tabs";

/**
 * Panel components get host props, not the client context, but the empty state
 * needs `openSettings`. The entry stores the context here when it registers.
 */
let current: PluginClientContext | null = null;

export function setPluginClient(client: PluginClientContext | null): void {
  current = client;
}

export function openGitLabSettings(): void {
  current?.openSettings(SETTINGS_ID);
}

export const SETTINGS_ID = "gitlab";
export const PANEL_ID = "gitlab";
export const DIFF_PANEL_ID = "gitlab-diff";
export const REPO_PANEL_ID = "gitlab-repo";
export const BOARD_PANEL_ID = "gitlab-board";
export const ITEM_PANEL_ID = "gitlab-item";

/** An issue or MR in a tab of its own in the workspace's main area. */
export function openItem(workspaceId: string, ref: ItemRef, title: string | null = null): void {
  openItemTab(workspaceId, ref, title);
  current?.openPanel(ITEM_PANEL_ID, { workspaceId, location: "workspace" });
}

/** The project's issue board, in the workspace's main area. */
export function openBoard(workspaceId: string): void {
  current?.openPanel(BOARD_PANEL_ID, { workspaceId, location: "workspace" });
}

/** The project's files, commits and branches, in the workspace's main area. */
export function openRepository(workspaceId: string): void {
  current?.openPanel(REPO_PANEL_ID, { workspaceId, location: "workspace" });
}

/** Shows an MR's changes in the workspace's main area, next to its agents. */
export function openDiff(workspaceId: string, target: ItemRef): void {
  setDiffTarget(workspaceId, target);
  current?.openPanel(DIFF_PANEL_ID, { workspaceId, location: "workspace" });
}
