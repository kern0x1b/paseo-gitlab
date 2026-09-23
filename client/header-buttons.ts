import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { PANEL_ID } from "./plugin-client";

/**
 * Plugin panels are only reachable from the tab launcher and Cmd+K, which nobody
 * finds on their own. A header button in every workspace opens the panel in the
 * explorer sidebar in one click. Header buttons are registered per workspace, so
 * the set follows the workspace list.
 */
const WORKSPACE_PAGE_LIMIT = 200;

export function startHeaderButtons(client: PluginClientContext, icon: string): PluginCleanup {
  const buttons = new Map<string, PluginButtonRegistration>();
  let stopped = false;

  function add(workspaceId: string): void {
    if (stopped || buttons.has(workspaceId)) {
      return;
    }
    buttons.set(
      workspaceId,
      client.addHeaderButton({
        id: `open-gitlab-${workspaceId}`,
        workspaceId,
        button: {
          title: "GitLab",
          icon,
          behavior: {
            kind: "action",
            onPress: () => client.openPanel(PANEL_ID, { workspaceId, location: "explorer" }),
          },
        },
      }),
    );
  }

  function remove(workspaceId: string): void {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  }

  // Subscribed before the initial list so a workspace created in between is not missed.
  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") {
      add(update.workspace.id);
    } else {
      remove(update.id);
    }
  });

  void client.paseo.workspaces
    .list({ page: { limit: WORKSPACE_PAGE_LIMIT }, subscribe: {} })
    .then((result) => {
      for (const workspace of result.entries) {
        add(workspace.id);
      }
    })
    .catch(() => {
      // The panel is still in the tab launcher and Cmd+K.
    });

  return () => {
    stopped = true;
    unsubscribe();
    for (const button of buttons.values()) {
      button.remove();
    }
    buttons.clear();
  };
}
