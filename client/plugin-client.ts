import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { ItemRef } from "../shared/contract";
import { setDiffTarget } from "./diff-target";
import { openItemTab } from "./item-tabs";

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

export function openItem(workspaceId: string, ref: ItemRef, title: string | null = null): void {
  openItemTab(workspaceId, ref, title);
  current?.openPanel(ITEM_PANEL_ID, { workspaceId, location: "workspace" });
}

export function openBoard(workspaceId: string): void {
  current?.openPanel(BOARD_PANEL_ID, { workspaceId, location: "workspace" });
}

export function openRepository(workspaceId: string): void {
  current?.openPanel(REPO_PANEL_ID, { workspaceId, location: "workspace" });
}

export function openDiff(workspaceId: string, target: ItemRef): void {
  setDiffTarget(workspaceId, target);
  current?.openPanel(DIFF_PANEL_ID, { workspaceId, location: "workspace" });
}
