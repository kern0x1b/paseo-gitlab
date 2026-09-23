import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { Fragment, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { todoDoneRpc, type ItemRef, type ListItem, type Lists, type Todo } from "../../shared/contract";
import { Badge, errorText, IconButton, Labels, PipelineDot } from "./common";
import { byRole, defaultRoleFilter, ROLE_FILTERS, type RoleFilter } from "./filters";
import { humanize, mergeStatusLabel, shortReference, timeAgo } from "./format";
import { LISTS_KEY } from "./queries";
import { SearchPanel } from "./search";
import type { Styles } from "./styles";

type TabId = "todos" | "issues" | "mrs" | "review" | "search";

type Ui = { theme: PluginTheme; styles: Styles };

const TODO_ACTIONS: Record<string, string> = {
  assigned: "assigned you",
  mentioned: "mentioned you",
  directly_addressed: "addressed you",
  build_failed: "pipeline failed",
  marked: "to-do you added",
  approval_required: "needs your approval",
  unmergeable: "can no longer merge",
  review_requested: "requested your review",
  review_submitted: "reviewed",
  merge_train_removed: "removed from the merge train",
  member_access_requested: "requested access",
};

function todoAction(action: string): string {
  return TODO_ACTIONS[action] ?? humanize(action).toLowerCase();
}

export function ItemRow({ item, onOpen, ui }: { item: ListItem; onOpen: (ref: ItemRef) => void; ui: Ui }) {
  const { styles, theme } = ui;
  const mergeStatus = item.kind === "mr" ? mergeStatusLabel(item.mergeStatus) : null;
  // Only worth saying when it is not the obvious one: yours as author, but assigned to someone else.
  const authorOnly = item.roles.length > 0 && !item.roles.includes("assignee");
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
        {authorOnly ? <Badge label="Not assigned to you" styles={styles} /> : null}
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

function TodoRow({
  todo,
  onOpen,
  onDone,
  busy,
  ui,
}: {
  todo: Todo;
  onOpen: (ref: ItemRef) => void;
  onDone: () => void;
  busy: boolean;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const open = () => {
    if (todo.target) {
      onOpen(todo.target);
    } else if (todo.webUrl) {
      void openExternalUrl(todo.webUrl);
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${todo.reference ?? ""} ${todo.title}`}
      onPress={open}
      style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
    >
      <View style={styles.row}>
        <Text style={styles.muted} numberOfLines={1}>
          {todo.author ? `@${todo.author.username} ` : ""}
          {todoAction(todo.action)}
        </Text>
        <View style={styles.spacer} />
        <Text style={styles.small}>{timeAgo(todo.createdAt)}</Text>
        <IconButton
          icon="Check"
          label="Mark as done"
          onPress={onDone}
          disabled={busy}
          theme={theme}
          styles={styles}
        />
      </View>
      <Text style={styles.listTitle} numberOfLines={2}>
        {todo.reference ? `${shortReference(todo.reference)} · ` : ""}
        {todo.title}
      </Text>
      {todo.body && todo.body !== todo.title ? (
        <Text style={styles.small} numberOfLines={2}>
          {todo.body}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Todos({ todos, onOpen, ui }: { todos: Todo[]; onOpen: (ref: ItemRef) => void; ui: Ui }) {
  const markDone = useRpc(todoDoneRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const done = useMutation({
    mutationFn: (id: string) => markDone({ id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: LISTS_KEY }),
    onError: (error) => toast.error(errorText(error)),
  });
  return (
    <>
      {todos.map((todo, index) => (
        <Fragment key={todo.id}>
          {index > 0 ? <View style={ui.styles.divider} /> : null}
          <TodoRow
            todo={todo}
            onOpen={onOpen}
            onDone={() => done.mutate(todo.id)}
            busy={done.isPending && done.variables === todo.id}
            ui={ui}
          />
        </Fragment>
      ))}
    </>
  );
}

const TABS: { id: TabId; label: string; count: (lists: Lists) => number; empty: string }[] = [
  { id: "todos", label: "To-Do", count: (lists) => lists.todos.length, empty: "No pending to-dos." },
  {
    id: "issues",
    label: "Issues",
    count: (lists) => lists.issues.length,
    empty: "No open issues assigned to you or filed by you.",
  },
  {
    id: "mrs",
    label: "My MRs",
    count: (lists) => lists.mergeRequests.length,
    empty: "You have no open merge requests.",
  },
  {
    id: "review",
    label: "Review",
    count: (lists) => lists.reviewMergeRequests.length,
    empty: "Nobody is waiting for your review.",
  },
  { id: "search", label: "Search", count: () => -1, empty: "" },
];

function firstTab(lists: Lists): TabId {
  // Whatever someone else is blocked on wins the first look.
  if (lists.reviewMergeRequests.length > 0) {
    return "review";
  }
  if (lists.todos.length > 0) {
    return "todos";
  }
  return lists.mergeRequests.length > 0 ? "mrs" : "issues";
}

export function ItemLists({ lists, onOpen, ui }: { lists: Lists; onOpen: (ref: ItemRef) => void; ui: Ui }) {
  const { styles } = ui;
  const [tab, setTab] = useState<TabId>(() => firstTab(lists));
  const current = TABS.find((candidate) => candidate.id === tab) ?? TABS[0]!;
  const [roleFilter, setRoleFilter] = useState<Record<"issues" | "mrs", RoleFilter>>(() => ({
    issues: defaultRoleFilter(lists.issues),
    mrs: defaultRoleFilter(lists.mergeRequests),
  }));
  const filterable = tab === "issues" || tab === "mrs" ? tab : null;
  const unfiltered = tab === "issues" ? lists.issues : tab === "mrs" ? lists.mergeRequests : lists.reviewMergeRequests;
  const items = filterable ? byRole(unfiltered, roleFilter[filterable]) : unfiltered;
  const empty = tab === "todos" ? lists.todos.length === 0 : items.length === 0;
  const defaultProject =
    lists.mergeRequests[0]?.projectPath ?? lists.issues[0]?.projectPath ?? lists.reviewMergeRequests[0]?.projectPath ?? "";
  const emptyText = filterable
    ? (ROLE_FILTERS.find((filter) => filter.id === roleFilter[filterable])?.empty ?? current.empty)
    : current.empty;

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
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]} numberOfLines={1}>
                {candidate.label}
                {candidate.count(lists) >= 0 ? ` ${candidate.count(lists)}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {filterable ? (
        <View style={[styles.row, { flexWrap: "wrap" }]} accessibilityRole="radiogroup">
          {ROLE_FILTERS.map((filter) => {
            const active = roleFilter[filterable] === filter.id;
            return (
              <Pressable
                key={filter.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setRoleFilter((current) => ({ ...current, [filterable]: filter.id }))}
                style={[styles.badge, active ? { backgroundColor: ui.theme.colors.accent } : null]}
              >
                <Text style={[styles.badgeLabel, active ? { color: ui.theme.colors.accentForeground } : null]}>
                  {filter.label} {byRole(unfiltered, filter.id).length}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {tab === "search" ? <SearchPanel defaultProject={defaultProject} onOpen={onOpen} ui={ui} /> : null}
      {tab === "search" ? null : (
      <View style={styles.card}>
        {empty ? (
          <View style={styles.cardBody}>
            <Text style={styles.muted}>{emptyText}</Text>
          </View>
        ) : tab === "todos" ? (
          <Todos todos={lists.todos} onOpen={onOpen} ui={ui} />
        ) : (
          items.map((item, index) => (
            <Fragment key={`${item.kind}:${item.reference}`}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <ItemRow item={item} onOpen={onOpen} ui={ui} />
            </Fragment>
          ))
        )}
      </View>
      )}
    </View>
  );
}
