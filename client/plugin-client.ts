import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { ItemRef } from "../shared/contract";
import { setDiffTarget } from "./diff-target";

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

/** Shows an MR's changes in the workspace's main area, next to its agents. */
export function openDiff(workspaceId: string, target: ItemRef): void {
  setDiffTarget(workspaceId, target);
  current?.openPanel(DIFF_PANEL_ID, { workspaceId, location: "workspace" });
}
