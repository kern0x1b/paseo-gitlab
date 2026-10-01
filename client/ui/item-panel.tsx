import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { authStatusRpc, detailRpc, type ItemRef, type Job, type PipelineRef } from "../../shared/contract";
import { AccountScope, useRpc } from "../account";
import { activateItemTab, closeItemTab, tabKey, useItemTabs, type ItemTab } from "../item-tabs";
import { openDiff } from "../plugin-client";
import { Centered, HostContext } from "./common";
import { ItemDetail, type Ui } from "./detail";
import { shortReference } from "./format";
import { JobLogView, PipelineView } from "./pipeline";
import { detailKey, STATUS_KEY } from "./queries";
import { useStyles } from "./styles";

type Screen =
  | { kind: "pipeline"; ref: PipelineRef }
  | { kind: "job"; projectPath: string; job: Job; pipelineIid: string | null };

function TabTitle({
  tab,
  active,
  onPress,
  onClose,
  ui,
}: {
  tab: ItemTab;
  active: boolean;
  onPress: () => void;
  onClose: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readDetail = useRpc(detailRpc);
  const detail = useQuery({
    queryKey: detailKey(tab.ref),
    queryFn: () => readDetail(tab.ref),
    staleTime: 60_000,
  });
  const title = detail.data?.title ?? tab.title ?? `${tab.ref.kind === "mr" ? "!" : "#"}${tab.ref.iid}`;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          gap: 6,
          maxWidth: 260,
          paddingLeft: 10,
          paddingRight: 4,
          paddingVertical: 6,
          borderRadius: 6,
          backgroundColor: active ? theme.colors.surface2 : "transparent",
        },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <Icon
        name={tab.ref.kind === "mr" ? "GitMerge" : "CircleDot"}
        size={13}
        color={active ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <Text
        style={[
          styles.small,
          { color: active ? theme.colors.foreground : theme.colors.foregroundMuted, flexShrink: 1 },
        ]}
        numberOfLines={1}
      >
        {detail.data ? `${shortReference(detail.data.reference)} ${title}` : title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${title}`}
        onPress={onClose}
        hitSlop={6}
        style={{ padding: 2 }}
      >
        <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
      </Pressable>
    </Pressable>
  );
}

function TabBody({ itemRef, onClose, ui }: { itemRef: ItemRef; onClose: () => void; ui: Ui }) {
  const [stack, setStack] = useState<Screen[]>([]);
  const top = stack[stack.length - 1];
  const push = (screen: Screen) => setStack((current) => [...current, screen]);
  const back = () => setStack((current) => current.slice(0, -1));
  if (top?.kind === "pipeline") {
    return (
      <PipelineView
        key={`${top.ref.projectPath}:${top.ref.iid}`}
        pipelineRef={top.ref}
        onBack={back}
        onOpenLog={(projectPath, job, pipelineIid) => push({ kind: "job", projectPath, job, pipelineIid })}
        onOpenPipeline={(ref) => push({ kind: "pipeline", ref })}
        ui={ui}
      />
    );
  }
  if (top?.kind === "job") {
    return (
      <JobLogView
        key={top.job.id}
        projectPath={top.projectPath}
        job={top.job}
        pipelineIid={top.pipelineIid}
        onBack={back}
        ui={ui}
      />
    );
  }
  return (
    <ItemDetail
      itemRef={itemRef}
      onBack={onClose}
      onOpenPipeline={(ref) => push({ kind: "pipeline", ref })}
      onOpenChanges={() => openDiff(ui.workspaceId, itemRef)}
      ui={ui}
    />
  );
}

function ItemPanelContent({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme);
  const readStatus = useRpc(authStatusRpc);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => readStatus({}), staleTime: 5 * 60_000 });
  const { tabs, active } = useItemTabs(workspaceId);
  const host = status.data?.connected ? status.data.host : "";
  const ui: Ui = { theme, styles, host, workspaceId };
  const current = tabs.find((tab) => tabKey(tab.ref) === active) ?? tabs[tabs.length - 1] ?? null;

  let body: React.ReactNode;
  if (status.isPending) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Connecting to GitLab…</Text>
      </Centered>
    );
  } else if (!status.data?.connected) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Connect GitLab in Settings → GitLab first.</Text>
      </Centered>
    );
  } else if (!current) {
    body = (
      <Centered styles={styles}>
        <Text style={[styles.muted, { textAlign: "center" }]}>
          Open an issue or a merge request with the tab icon in its header, in the GitLab panel or on the
          board.
        </Text>
      </Centered>
    );
  } else {
    body = (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.scroll, { maxWidth: 1100, width: "100%", alignSelf: "center" }]}
      >
        <TabBody
          key={tabKey(current.ref)}
          itemRef={current.ref}
          onClose={() => closeItemTab(workspaceId, tabKey(current.ref))}
          ui={ui}
        />
      </ScrollView>
    );
  }
  return (
    <HostContext.Provider value={host}>
      <View style={styles.screen}>
        {tabs.length > 0 && status.data?.connected ? (
          <ScrollView
            horizontal
            style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
            contentContainerStyle={{ gap: 4, paddingHorizontal: 8, paddingVertical: 6 }}
          >
            {tabs.map((tab) => {
              const key = tabKey(tab.ref);
              return (
                <TabTitle
                  key={key}
                  tab={tab}
                  active={key === tabKey(current?.ref ?? tab.ref) && current !== null}
                  onPress={() => activateItemTab(workspaceId, key)}
                  onClose={() => closeItemTab(workspaceId, key)}
                  ui={ui}
                />
              );
            })}
          </ScrollView>
        ) : null}
        {body}
      </View>
    </HostContext.Provider>
  );
}

export function ItemPanel(props: PluginWorkspacePanelProps) {
  return (
    <AccountScope workspaceId={props.workspaceId}>
      <ItemPanelContent {...props} />
    </AccountScope>
  );
}
