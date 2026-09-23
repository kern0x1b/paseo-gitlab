import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startHeaderButtons } from "./client/header-buttons";
import { DIFF_PANEL_ID, PANEL_ID, SETTINGS_ID, setPluginClient } from "./client/plugin-client";
import { DiffPanel } from "./client/ui/diff-panel";
import { GitLabPanel } from "./client/ui/panel";
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
    client.addSettingsScreen({ id: SETTINGS_ID, title: "GitLab", icon: ICON, Component: GitLabSettings }),
    client.addCommandCenterItem({
      id: "open-gitlab",
      title: "Open GitLab",
      icon: ICON,
      keywords: ["gitlab", "merge request", "mr", "issue", "review"],
      context: "workspace",
      onSelect: (context) => context.openPanel(PANEL_ID, { location: "explorer" }),
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
