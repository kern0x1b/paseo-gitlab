import type { PluginClientContext } from "@getpaseo/plugin/client";

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
