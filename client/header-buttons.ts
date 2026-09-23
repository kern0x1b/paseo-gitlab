import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { authStatusRpc, clientLogRpc, listsRpc, type Lists } from "../shared/contract";
import { PANEL_ID } from "./plugin-client";

/**
 * Plugin panels are only reachable from the tab launcher and Cmd+K, which nobody
 * finds on their own. A header button in every workspace opens the panel in the
 * explorer sidebar in one click, and its label counts what is waiting on you:
 * review requests and to-dos, plus a mark when one of your MRs has a failed
 * pipeline. Header buttons are registered per workspace, so the set follows the
 * workspace list.
 */
const WORKSPACE_PAGE_LIMIT = 200;
const REFRESH_INTERVAL_MS = 60_000;

interface Badge {
  label: string | undefined;
  title: string;
}

export function badgeFor(lists: Lists | null): Badge {
  if (!lists) {
    return { label: undefined, title: "GitLab" };
  }
  const reviews = lists.reviewMergeRequests.length;
  const todos = lists.todos.length;
  const failed = lists.mergeRequests.filter((item) => item.pipelineStatus === "FAILED").length;
  const parts = [
    reviews ? `${reviews} ${reviews === 1 ? "review" : "reviews"}` : null,
    todos ? `${todos} ${todos === 1 ? "to-do" : "to-dos"}` : null,
    failed ? `${failed} failed ${failed === 1 ? "pipeline" : "pipelines"}` : null,
  ].filter(Boolean);
  const waiting = reviews + todos;
  const label = [waiting ? String(waiting) : null, failed ? "✕" : null].filter(Boolean).join(" ") || undefined;
  return { label, title: parts.length ? `GitLab — ${parts.join(", ")}` : "GitLab" };
}

export function startHeaderButtons(client: PluginClientContext, icon: string): PluginCleanup {
  const buttons = new Map<string, PluginButtonRegistration>();
  let badge: Badge = badgeFor(null);
  let stopped = false;

  const report = (message: string) => void client.rpc(clientLogRpc, { message }).catch(() => {});

  function register(workspaceId: string): PluginButtonRegistration {
    return client.addHeaderButton({
      // Button ids must match /^[a-z][a-z0-9-]*$/; the host keys them by workspace already.
      id: "open-gitlab",
      workspaceId,
      button: {
        title: badge.title,
        icon,
        ...(badge.label ? { label: badge.label } : {}),
        behavior: {
          kind: "action",
          onPress: () => client.openPanel(PANEL_ID, { workspaceId, location: "explorer" }),
        },
      },
    });
  }

  function add(workspaceId: string): void {
    if (stopped || buttons.has(workspaceId)) {
      return;
    }
    try {
      buttons.set(workspaceId, register(workspaceId));
    } catch (error) {
      report(`header button for ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function remove(workspaceId: string): void {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  }

  function applyBadge(next: Badge): void {
    const hadLabel = badge.label !== undefined;
    badge = next;
    for (const [workspaceId, button] of buttons) {
      if (hadLabel && !next.label) {
        // A patch cannot take a label away; register the icon-only button again.
        button.remove();
        buttons.set(workspaceId, register(workspaceId));
      } else {
        button.update({ title: next.title, ...(next.label ? { label: next.label } : {}) });
      }
    }
  }

  async function refresh(): Promise<void> {
    try {
      const status = await client.rpc(authStatusRpc, {});
      applyBadge(badgeFor(status.connected ? await client.rpc(listsRpc, {}) : null));
    } catch {
      // Keeps the last badge; the panel shows the error when opened.
    }
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
    .catch((error: unknown) => {
      report(`header buttons: listing workspaces failed: ${error instanceof Error ? error.message : String(error)}`);
    });

  void refresh();
  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    for (const button of buttons.values()) {
      button.remove();
    }
    buttons.clear();
  };
}
