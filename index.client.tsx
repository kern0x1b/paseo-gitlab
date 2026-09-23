import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PANEL_ID, SETTINGS_ID, setPluginClient } from "./client/plugin-client";
import { GitLabPanel } from "./client/ui/panel";
import { GitLabSettings } from "./client/ui/settings";

const ICON = "GitMerge";

/** Client entry: the panel (explorer sidebar by default), its settings screen and a Cmd+K shortcut. */
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
    client.addSettingsScreen({ id: SETTINGS_ID, title: "GitLab", icon: ICON, Component: GitLabSettings }),
    client.addCommandCenterItem({
      id: "open-gitlab",
      title: "Open GitLab",
      icon: ICON,
      keywords: ["gitlab", "merge request", "mr", "issue", "review"],
      context: "workspace",
      onSelect: (context) => context.openPanel(PANEL_ID, { location: "explorer" }),
    }),
  ];
  return () => {
    for (const remove of removers) {
      remove();
    }
    setPluginClient(null);
  };
}
