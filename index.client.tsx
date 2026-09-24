import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startHeaderButtons } from "./client/header-buttons";
import {
  BOARD_PANEL_ID,
  DIFF_PANEL_ID,
  PANEL_ID,
  REPO_PANEL_ID,
  SETTINGS_ID,
  setPluginClient,
} from "./client/plugin-client";
import { BoardPanel } from "./client/ui/board-panel";
import { DiffPanel } from "./client/ui/diff-panel";
import { GitLabPanel } from "./client/ui/panel";
import { RepositoryPanel } from "./client/ui/repo-panel";
import { GitLabSettings } from "./client/ui/settings";
import { attachmentSearchRpc } from "./shared/contract";

const ICON = "GitMerge";

/** Client entry: the panel (explorer sidebar by default), a header button to open it, its settings screen and a Cmd+K shortcut. */
export default function contribute(client: PluginClientContext) {
  setPluginClient(client);
  const removers = [
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "GitLab",
      icon: ICON,
      context: "workspace",
      locations: ["explorer", "workspace"],
      Component: GitLabPanel,
    }),
    client.addWorkspacePanel({
      id: DIFF_PANEL_ID,
      title: "MR diff",
      icon: "FileDiff",
      context: "workspace",
      locations: ["workspace"],
      Component: DiffPanel,
    }),
    client.addWorkspacePanel({
      id: REPO_PANEL_ID,
      title: "Repository",
      icon: "FolderGit2",
      context: "workspace",
      locations: ["workspace"],
      Component: RepositoryPanel,
    }),
    client.addWorkspacePanel({
      id: BOARD_PANEL_ID,
      title: "Issue board",
      icon: "Kanban",
      context: "workspace",
      locations: ["workspace"],
      Component: BoardPanel,
    }),
    client.addSettingsScreen({ id: SETTINGS_ID, title: "GitLab", icon: ICON, Component: GitLabSettings }),
    client.addCommandCenterItem({
      id: "open-gitlab",
      title: "Open GitLab",
      icon: ICON,
      keywords: ["gitlab", "merge request", "mr", "issue", "review"],
      context: "workspace",
      onSelect: (context) => context.openPanel(PANEL_ID, { location: "explorer" }),
    }),
    client.addCommandCenterItem({
      id: "open-gitlab-repository",
      title: "GitLab repository",
      icon: "FolderGit2",
      keywords: ["gitlab", "repository", "files", "branches", "commits"],
      context: "workspace",
      onSelect: (context) => context.openPanel(REPO_PANEL_ID, { location: "workspace" }),
    }),
    client.addCommandCenterItem({
      id: "open-gitlab-board",
      title: "GitLab issue board",
      icon: "Kanban",
      keywords: ["gitlab", "board", "issues", "kanban", "todo"],
      context: "workspace",
      onSelect: (context) => context.openPanel(BOARD_PANEL_ID, { location: "workspace" }),
    }),
    startHeaderButtons(client, ICON),
    client.addAttachmentSource({
      id: "gitlab",
      title: "GitLab",
      icon: ICON,
      pickerTitle: "Attach from GitLab",
      searchPlaceholder: "!123, #45, a GitLab URL, or words",
      search: attachmentSearchRpc,
    }),
  ];
  return () => {
    for (const remove of removers) {
      remove();
    }
    setPluginClient(null);
  };
}
