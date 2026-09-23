import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { chooseAccount, useAccount } from "../account";
import type { Styles } from "./styles";

/** "@you · gitlab.example.com": which GitLab this panel shows, and a way to pick another. */
export function AccountSwitch({
  username,
  ui,
}: {
  username: string;
  ui: { theme: PluginTheme; styles: Styles };
}) {
  const { styles, theme } = ui;
  const { hosts, account, fromRemote, workspaceId } = useAccount();
  const [open, setOpen] = useState(false);
  const label = `@${username}${hosts.length > 1 && account ? ` · ${new URL(account).host}` : ""}`;
  if (hosts.length < 2 || !workspaceId) {
    return (
      <Text style={styles.muted} numberOfLines={1}>
        {label}
      </Text>
    );
  }
  const pick = (host: string | null) => {
    chooseAccount(workspaceId, host);
    setOpen(false);
  };
  const option = (host: string | null, title: string, description: string, selected: boolean) => (
    <Pressable
      key={host ?? "remote"}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => pick(host)}
      style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
    >
      <View style={[styles.row, { gap: 8 }]}>
        <Text style={[styles.text, { flex: 1, fontWeight: selected ? "600" : "400" }]} numberOfLines={1}>
          {title}
        </Text>
        {selected ? <Icon name="Check" size={14} color={theme.colors.accent} /> : null}
      </View>
      <Text style={styles.small}>{description}</Text>
    </Pressable>
  );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose the GitLab account for this workspace"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, { gap: 2, flexShrink: 1 }, pressed ? { opacity: 0.7 } : null]}
      >
        <Text style={styles.muted} numberOfLines={1}>
          {label}
        </Text>
        <Icon name="ChevronDown" size={12} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Modal title="GitLab account for this workspace" open={open} onOpenChange={setOpen}>
        <Modal.Content>
          {fromRemote
            ? option(
                null,
                `Follow origin · ${new URL(fromRemote).host}`,
                "The GitLab this checkout pushes to.",
                false,
              )
            : null}
          {hosts.map((host) =>
            option(
              host,
              new URL(host).host,
              host === fromRemote ? "This checkout's origin" : host,
              host === account,
            ),
          )}
        </Modal.Content>
      </Modal>
    </>
  );
}
