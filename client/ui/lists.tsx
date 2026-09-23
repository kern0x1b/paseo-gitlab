import type { PluginTheme } from "@getpaseo/plugin";
import React, { Fragment, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { ItemRef, ListItem, Lists } from "../../shared/contract";
import { Badge, Labels, PipelineDot } from "./common";
import { mergeStatusLabel, shortReference, timeAgo } from "./format";
import type { Styles } from "./styles";

type TabId = "issues" | "authored" | "review";

const TABS: { id: TabId; label: string; pick: (lists: Lists) => ListItem[]; empty: string }[] = [
  { id: "issues", label: "Issues", pick: (lists) => lists.issues, empty: "No open issues assigned to you." },
  {
    id: "authored",
    label: "My MRs",
    pick: (lists) => lists.authoredMergeRequests,
    empty: "You have no open merge requests.",
  },
  {
    id: "review",
    label: "Review",
    pick: (lists) => lists.reviewMergeRequests,
    empty: "Nobody is waiting for your review.",
  },
];

function Row({
  item,
  onOpen,
  theme,
  styles,
}: {
  item: ListItem;
  onOpen: (ref: ItemRef) => void;
  theme: PluginTheme;
  styles: Styles;
}) {
  const mergeStatus = item.kind === "mr" ? mergeStatusLabel(item.mergeStatus) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.reference} ${item.title}`}
      onPress={() => onOpen({ kind: item.kind, projectPath: item.projectPath, iid: item.iid })}
      style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
    >
      <View style={styles.row}>
        <PipelineDot status={item.pipelineStatus} theme={theme} styles={styles} />
        <Text style={styles.muted} numberOfLines={1}>
          {shortReference(item.reference)}
        </Text>
        {item.draft ? <Badge label="Draft" styles={styles} /> : null}
        {item.confidential ? (
          <Badge label="Confidential" styles={styles} color={theme.colors.statusWarning} />
        ) : null}
        <View style={styles.spacer} />
        <Text style={styles.small}>
          {item.userNotesCount > 0 ? `💬 ${item.userNotesCount} · ` : ""}
          {timeAgo(item.updatedAt)}
        </Text>
      </View>
      <Text style={styles.listTitle} numberOfLines={2}>
        {item.title}
      </Text>
      {mergeStatus && item.mergeStatus !== "DRAFT_STATUS" ? (
        <Text style={styles.small}>{mergeStatus}</Text>
      ) : null}
      <Labels labels={item.labels} styles={styles} />
    </Pressable>
  );
}

export function ItemLists({
  lists,
  onOpen,
  theme,
  styles,
}: {
  lists: Lists;
  onOpen: (ref: ItemRef) => void;
  theme: PluginTheme;
  styles: Styles;
}) {
  // Review requests are what someone else is blocked on, so they win the first look when there are any.
  const [tab, setTab] = useState<TabId>(() =>
    lists.reviewMergeRequests.length > 0 ? "review" : lists.issues.length > 0 ? "issues" : "authored",
  );
  const current = TABS.find((candidate) => candidate.id === tab) ?? TABS[0]!;
  const items = current.pick(lists);

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((candidate) => {
          const active = candidate.id === tab;
          return (
            <Pressable
              key={candidate.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(candidate.id)}
              style={[styles.tab, active ? styles.tabActive : null]}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
                {candidate.label} {candidate.pick(lists).length}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.card}>
        {items.length === 0 ? (
          <View style={styles.cardBody}>
            <Text style={styles.muted}>{current.empty}</Text>
          </View>
        ) : (
          items.map((item, index) => (
            <Fragment key={`${item.kind}:${item.reference}`}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <Row item={item} onOpen={onOpen} theme={theme} styles={styles} />
            </Fragment>
          ))
        )}
      </View>
    </View>
  );
}
