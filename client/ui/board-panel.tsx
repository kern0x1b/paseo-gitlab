import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  authStatusRpc,
  boardCardsRpc,
  boardColumnsRpc,
  boardsRpc,
  moveBoardCardRpc,
  searchLabelsRpc,
  searchUsersRpc,
  workspaceRpc,
  type BoardCard,
  type BoardColumn,
  type BoardFilters,
  type BoardSummary,
  type ItemRef,
} from "../../shared/contract";
import { AccountScope, useRpc } from "../account";
import { useDiffTarget } from "../diff-target";
import { AvatarStack, Button, Centered, errorText, HostContext, IconButton } from "./common";
import { ItemDetail, type Ui } from "./detail";
import { STATUS_KEY } from "./queries";
import { useStyles } from "./styles";
import { workspaceKey } from "./workspace-card";

const COLUMN_WIDTH = 300;
const COLLAPSED_WIDTH = 44;
const DRAWER_WIDTH = 520;
const SEARCH_DEBOUNCE_MS = 350;
const NO_FILTERS: BoardFilters = { search: "", assignee: null, labels: [], author: null, milestone: null };

const BOARD_CHOICE_KEY = "paseo-gitlab:board-choice";
const BOARD_FILTERS_KEY = "paseo-gitlab:board-filters";
const BOARD_COLLAPSED_KEY = "paseo-gitlab:board-collapsed";

function readStore<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? "{}") as Record<string, T>;
  } catch {
    return {};
  }
}

function writeStore<T>(key: string, id: string, value: T): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify({ ...readStore<T>(key), [id]: value }));
  } catch {
    // No storage: the choice lasts until the window closes.
  }
}

function boardKey(...parts: string[]) {
  return ["gitlab", "board", ...parts] as const;
}

function assigneeLabel(assignee: string | null, viewer: string): string {
  if (assignee === null) {
    return "Anyone";
  }
  if (assignee === "@none") {
    return "Nobody";
  }
  if (assignee === "@any") {
    return "Anybody";
  }
  return assignee === viewer ? "Me" : `@${assignee}`;
}

function overdue(dueDate: string): boolean {
  return dueDate < new Date().toISOString().slice(0, 10);
}

function Choice({
  title,
  selected,
  onPress,
  ui,
}: {
  title: string;
  selected: boolean;
  onPress: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        styles.row,
        { gap: 8 },
        pressed ? styles.listRowPressed : null,
      ]}
    >
      <Text style={[styles.text, { flex: 1, fontWeight: selected ? "600" : "400" }]} numberOfLines={1}>
        {title}
      </Text>
      {selected ? <Icon name="Check" size={14} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

function AssigneePicker({
  open,
  onClose,
  projectPath,
  viewer,
  value,
  onChange,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  viewer: string;
  value: string | null;
  onChange: (assignee: string | null) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const searchUsers = useRpc(searchUsersRpc);
  const [search, setSearch] = useState("");
  const users = useQuery({
    queryKey: boardKey("users", projectPath, search.trim()),
    queryFn: () => searchUsers({ projectPath, search: search.trim() }),
    enabled: open && search.trim().length > 0,
  });
  const pick = (next: string | null) => {
    onChange(next);
    onClose();
  };
  return (
    <Modal title="Assignee" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <Choice title="Anyone" selected={value === null} onPress={() => pick(null)} ui={ui} />
        <Choice title="Me" selected={value === viewer} onPress={() => pick(viewer)} ui={ui} />
        <Choice title="Nobody" selected={value === "@none"} onPress={() => pick("@none")} ui={ui} />
        <Choice title="Anybody" selected={value === "@any"} onPress={() => pick("@any")} ui={ui} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search people…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
        />
        {users.data?.users.map((user) => (
          <Choice
            key={user.username}
            title={`${user.name} @${user.username}`}
            selected={value === user.username}
            onPress={() => pick(user.username)}
            ui={ui}
          />
        ))}
      </Modal.Content>
    </Modal>
  );
}

function LabelPicker({
  open,
  onClose,
  projectPath,
  value,
  onChange,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  value: string[];
  onChange: (labels: string[]) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const searchLabels = useRpc(searchLabelsRpc);
  const [search, setSearch] = useState("");
  const labels = useQuery({
    queryKey: boardKey("labels", projectPath, search.trim()),
    queryFn: () => searchLabels({ projectPath, search: search.trim() }),
    enabled: open,
  });
  const toggle = (title: string) =>
    onChange(value.includes(title) ? value.filter((entry) => entry !== title) : [...value, title]);
  return (
    <Modal title="Labels" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <Text style={styles.small}>Cards that carry every label you pick.</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search labels…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          autoFocus
        />
        {labels.isPending ? <Text style={styles.small}>Loading…</Text> : null}
        {labels.data?.labels.map((label) => {
          const checked = value.includes(label.title);
          return (
            <Pressable
              key={label.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => toggle(label.title)}
              style={({ pressed }) => [
                styles.listRow,
                styles.row,
                { gap: 8 },
                pressed ? styles.listRowPressed : null,
              ]}
            >
              <View style={{ flex: 1, flexDirection: "row" }}>
                <View style={[styles.badge, { backgroundColor: label.color }]}>
                  <Text style={[styles.badgeLabel, { color: label.textColor }]} numberOfLines={1}>
                    {label.title}
                  </Text>
                </View>
              </View>
              {checked ? <Icon name="Check" size={14} color={theme.colors.accent} /> : null}
            </Pressable>
          );
        })}
        <View style={styles.row}>
          <View style={styles.spacer} />
          {value.length > 0 ? (
            <Button label="Clear" onPress={() => onChange([])} styles={styles} theme={theme} />
          ) : null}
          <Button label="Done" primary onPress={onClose} styles={styles} theme={theme} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function CardView({
  card,
  onOpen,
  onMove,
  ui,
}: {
  card: BoardCard;
  onOpen: () => void;
  onMove: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const late = card.dueDate ? overdue(card.dueDate) : false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={card.title}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        { padding: 10, gap: 6 },
        pressed ? { backgroundColor: theme.colors.surface2 } : null,
      ]}
    >
      <View style={[styles.row, { alignItems: "flex-start", gap: 6 }]}>
        {card.confidential ? <Icon name="EyeOff" size={13} color={theme.colors.statusWarning} /> : null}
        <Text style={[styles.listTitle, { flex: 1, fontWeight: "600" }]} numberOfLines={3}>
          {card.title}
        </Text>
        <IconButton
          icon="EllipsisVertical"
          label="Move to another list"
          onPress={onMove}
          theme={theme}
          styles={styles}
        />
      </View>
      {card.labels.length > 0 ? (
        <View style={styles.chips}>
          {card.labels.map((label) => (
            <View key={label.title} style={[styles.badge, { backgroundColor: label.color }]}>
              <Text style={[styles.badgeLabel, { color: label.textColor }]} numberOfLines={1}>
                {label.title}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={[styles.row, { gap: 10, flexWrap: "wrap" }]}>
        <Text style={styles.small}>#{card.iid}</Text>
        {card.milestone ? (
          <View style={[styles.row, { gap: 3, flexShrink: 1 }]}>
            <Icon name="Clock" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.small} numberOfLines={1}>
              {card.milestone}
            </Text>
          </View>
        ) : null}
        {card.dueDate ? (
          <View style={[styles.row, { gap: 3 }]}>
            <Icon
              name="Calendar"
              size={11}
              color={late ? theme.colors.statusDanger : theme.colors.foregroundMuted}
            />
            <Text style={[styles.small, late ? { color: theme.colors.statusDanger } : null]}>
              {card.dueDate}
            </Text>
          </View>
        ) : null}
        {card.userNotesCount > 0 ? <Text style={styles.small}>💬 {card.userNotesCount}</Text> : null}
        <View style={styles.spacer} />
        <AvatarStack people={card.assignees} styles={styles} />
      </View>
    </Pressable>
  );
}

function Column({
  column,
  filters,
  collapsed,
  height,
  onToggle,
  onOpen,
  onMove,
  ui,
}: {
  column: BoardColumn;
  filters: BoardFilters;
  collapsed: boolean;
  /** The board's height, measured: columns run the full height and scroll their own cards. */
  height: number;
  onToggle: () => void;
  onOpen: (card: BoardCard) => void;
  onMove: (card: BoardCard, from: BoardColumn) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readCards = useRpc(boardCardsRpc);
  const cards = useInfiniteQuery({
    queryKey: boardKey("cards", column.id, JSON.stringify(filters)),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => readCards({ columnId: column.id, after: pageParam, filters }),
    getNextPageParam: (last) => (last.hasNextPage ? last.endCursor : undefined),
    enabled: !collapsed,
  });
  const count = cards.data?.pages[0]?.count ?? column.issuesCount;
  const title = column.label ? (
    <View style={[styles.badge, { backgroundColor: column.label.color }]}>
      <Text
        style={[styles.badgeLabel, { color: column.label.textColor, fontWeight: "600" }]}
        numberOfLines={1}
      >
        {column.title}
      </Text>
    </View>
  ) : (
    <Text style={[styles.text, { fontWeight: "600" }]} numberOfLines={1}>
      {column.title}
    </Text>
  );
  const frame = {
    width: collapsed ? COLLAPSED_WIDTH : COLUMN_WIDTH,
    height: height > 0 ? height : undefined,
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    borderTopWidth: 3,
    borderTopColor: column.label?.color ?? theme.colors.border,
  };
  if (collapsed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Expand ${column.title}`}
        onPress={onToggle}
        style={[frame, { alignItems: "center", paddingVertical: 10, gap: 8 }]}
      >
        <Icon name="ChevronsLeftRight" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.small}>{count}</Text>
        <Text
          style={[
            styles.small,
            { transform: [{ rotate: "90deg" }], width: 140, textAlign: "center", marginTop: 60 },
          ]}
          numberOfLines={1}
        >
          {column.title}
        </Text>
      </Pressable>
    );
  }
  const loaded = cards.data?.pages.flatMap((page) => page.cards) ?? [];
  return (
    <View style={frame}>
      <View style={[styles.row, { gap: 6, paddingHorizontal: 10, paddingVertical: 8 }]}>
        <IconButton
          icon="ChevronDown"
          label={`Collapse ${column.title}`}
          onPress={onToggle}
          theme={theme}
          styles={styles}
        />
        <View style={{ flexShrink: 1 }}>{title}</View>
        <View style={styles.spacer} />
        <Icon name="StickyNote" size={12} color={theme.colors.foregroundMuted} />
        <Text style={styles.small}>{count}</Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 10, gap: 8 }}
      >
        {cards.isPending ? <Text style={[styles.small, { padding: 6 }]}>Loading…</Text> : null}
        {cards.isError ? <Text style={[styles.error, { padding: 6 }]}>{errorText(cards.error)}</Text> : null}
        {cards.isSuccess && loaded.length === 0 ? (
          <Text style={[styles.small, { padding: 6 }]}>No issues.</Text>
        ) : null}
        {loaded.map((card) => (
          <CardView
            key={card.reference}
            card={card}
            onOpen={() => onOpen(card)}
            onMove={() => onMove(card, column)}
            ui={ui}
          />
        ))}
        {cards.hasNextPage ? (
          <Button
            label="Load more"
            busy={cards.isFetchingNextPage}
            onPress={() => void cards.fetchNextPage()}
            styles={styles}
            theme={theme}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function MoveModal({
  moving,
  columns,
  onClose,
  onMove,
  ui,
}: {
  moving: { card: BoardCard; from: BoardColumn } | null;
  columns: BoardColumn[];
  onClose: () => void;
  onMove: (to: BoardColumn) => void;
  ui: Ui;
}) {
  const { styles } = ui;
  return (
    <Modal
      title="Move to list"
      open={moving !== null}
      onOpenChange={(next) => (next ? undefined : onClose())}
    >
      <Modal.Content>
        {moving ? (
          <Text style={styles.small} numberOfLines={2}>
            #{moving.card.iid} {moving.card.title}
          </Text>
        ) : null}
        {columns
          .filter((column) => column.id !== moving?.from.id)
          .map((column) => (
            <Choice
              key={column.id}
              title={column.title}
              selected={false}
              onPress={() => onMove(column)}
              ui={ui}
            />
          ))}
      </Modal.Content>
    </Modal>
  );
}

function IssueBoard({ projectPath, viewer, ui }: { projectPath: string; viewer: string; ui: Ui }) {
  const { styles, theme } = ui;
  const toast = useToast();
  const queryClient = useQueryClient();
  const readBoards = useRpc(boardsRpc);
  const readColumns = useRpc(boardColumnsRpc);
  const moveCard = useRpc(moveBoardCardRpc);
  const boards = useQuery({
    queryKey: boardKey("list", projectPath),
    queryFn: () => readBoards({ projectPath }),
  });
  const [chosenBoard, setChosenBoard] = useState<string | null>(
    () => readStore<string>(BOARD_CHOICE_KEY)[projectPath] ?? null,
  );
  const board: BoardSummary | null =
    boards.data?.boards.find((entry) => entry.id === chosenBoard) ?? boards.data?.boards[0] ?? null;
  const columns = useQuery({
    queryKey: boardKey("columns", board?.id ?? ""),
    queryFn: () => readColumns({ projectPath, boardId: board!.id }),
    enabled: board !== null,
  });
  const [filters, setFiltersState] = useState<BoardFilters>(NO_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState<"board" | "assignee" | "labels" | null>(null);
  const [moving, setMoving] = useState<{ card: BoardCard; from: BoardColumn } | null>(null);
  const [opened, setOpened] = useState<ItemRef | null>(null);
  const [boardHeight, setBoardHeight] = useState(0);

  // Filters and folded columns are remembered per board, like GitLab keeps them in the URL.
  useEffect(() => {
    if (!board) {
      return;
    }
    const saved = readStore<BoardFilters>(BOARD_FILTERS_KEY)[board.id] ?? NO_FILTERS;
    setFiltersState(saved);
    setSearchText(saved.search);
    setCollapsed(readStore<Record<string, boolean>>(BOARD_COLLAPSED_KEY)[board.id] ?? {});
  }, [board?.id]);
  const setFilters = (next: BoardFilters) => {
    setFiltersState(next);
    if (board) {
      writeStore(BOARD_FILTERS_KEY, board.id, next);
    }
  };
  useEffect(() => {
    if (searchText === filters.search) {
      return;
    }
    const timer = setTimeout(() => setFilters({ ...filters, search: searchText }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["gitlab", "board"] });
  const move = async (to: BoardColumn) => {
    if (!moving || !board) {
      return;
    }
    const { card, from } = moving;
    setMoving(null);
    try {
      await moveCard({
        projectPath: card.projectPath,
        iid: card.iid,
        boardId: board.id,
        fromColumnId: from.id,
        toColumnId: to.id,
      });
      toast.show(`Moved #${card.iid} to ${to.title}`, { variant: "success" });
    } catch (error) {
      toast.error(errorText(error));
    }
    refresh();
  };

  if (boards.isPending) {
    return (
      <Centered styles={styles}>
        <Text style={styles.muted}>Loading boards…</Text>
      </Centered>
    );
  }
  if (boards.isError) {
    return (
      <Centered styles={styles}>
        <Text style={styles.error}>{errorText(boards.error)}</Text>
        <Button label="Retry" onPress={() => void boards.refetch()} styles={styles} theme={theme} />
      </Centered>
    );
  }
  if (!board) {
    return (
      <Centered styles={styles}>
        <Text style={styles.muted}>{projectPath} has no issue boards yet.</Text>
      </Centered>
    );
  }

  const chip = (icon: string, text: string, onPress: () => void, active: boolean, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.badge,
        styles.row,
        { gap: 4, paddingVertical: 5 },
        active ? { borderColor: theme.colors.accent } : null,
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Icon name={icon} size={12} color={active ? theme.colors.accent : theme.colors.foregroundMuted} />
      <Text style={styles.badgeLabel} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1 }}>
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View style={[styles.row, { gap: 10 }]}>
            <Text style={[styles.title, { flexShrink: 1 }]} numberOfLines={1}>
              {projectPath}
            </Text>
            {chip("Kanban", board.name, () => setPicking("board"), false, "Switch board")}
            <View style={styles.spacer} />
            <IconButton icon="RefreshCw" label="Refresh" onPress={refresh} theme={theme} styles={styles} />
            <IconButton
              icon="ExternalLink"
              label="Open the board in GitLab"
              onPress={() => void openExternalUrl(board.webUrl)}
              theme={theme}
              styles={styles}
            />
          </View>
          <View style={[styles.row, { gap: 8, flexWrap: "wrap" }]}>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search issues…"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={[styles.input, { flex: 1, minWidth: 180, minHeight: 0, paddingVertical: 6 }]}
            />
            {chip(
              "User",
              `Assignee: ${assigneeLabel(filters.assignee, viewer)}`,
              () => setPicking("assignee"),
              filters.assignee !== null,
              "Filter by assignee",
            )}
            {chip(
              "Tag",
              filters.labels.length > 0 ? `Labels ${filters.labels.length}` : "Labels",
              () => setPicking("labels"),
              filters.labels.length > 0,
              "Filter by labels",
            )}
            {filters.labels.map((title) => (
              <Pressable
                key={title}
                accessibilityRole="button"
                accessibilityLabel={`Stop filtering by ${title}`}
                onPress={() =>
                  setFilters({ ...filters, labels: filters.labels.filter((entry) => entry !== title) })
                }
                style={[styles.badge, styles.row, { gap: 4 }]}
              >
                <Text style={styles.badgeLabel}>{title}</Text>
                <Icon name="X" size={11} color={theme.colors.foregroundMuted} />
              </Pressable>
            ))}
            {filters.search || filters.assignee !== null || filters.labels.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSearchText("");
                  setFilters(NO_FILTERS);
                }}
              >
                <Text style={[styles.small, { color: theme.colors.accent }]}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {columns.isPending ? (
          <Centered styles={styles}>
            <Text style={styles.muted}>Loading the board…</Text>
          </Centered>
        ) : columns.isError ? (
          <Centered styles={styles}>
            <Text style={styles.error}>{errorText(columns.error)}</Text>
          </Centered>
        ) : (
          <View style={{ flex: 1 }} onLayout={(event) => setBoardHeight(event.nativeEvent.layout.height)}>
            <ScrollView
              horizontal
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12, gap: 12, alignItems: "flex-start" }}
            >
              {columns.data.columns.map((column) => {
                const folded = collapsed[column.id] ?? column.collapsed;
                return (
                  <Column
                    key={column.id}
                    column={column}
                    filters={filters}
                    collapsed={folded}
                    height={boardHeight - 24}
                    onToggle={() => {
                      const next = { ...collapsed, [column.id]: !folded };
                      setCollapsed(next);
                      writeStore(BOARD_COLLAPSED_KEY, board.id, next);
                    }}
                    onOpen={(card) =>
                      setOpened({ kind: "issue", projectPath: card.projectPath, iid: card.iid })
                    }
                    onMove={(card, from) => setMoving({ card, from })}
                    ui={ui}
                  />
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
      {opened ? (
        <View style={{ width: DRAWER_WIDTH, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}>
          <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
            <ItemDetail
              key={`${opened.projectPath}:${opened.iid}`}
              itemRef={opened}
              onBack={() => {
                setOpened(null);
                refresh();
              }}
              onOpenPipeline={(ref) =>
                void openExternalUrl(`${ui.host}/${ref.projectPath}/-/pipelines/${ref.iid}`)
              }
              onOpenChanges={() => {}}
              ui={ui}
            />
          </ScrollView>
        </View>
      ) : null}
      <Modal
        title="Switch board"
        open={picking === "board"}
        onOpenChange={(next) => (next ? undefined : setPicking(null))}
      >
        <Modal.Content>
          {boards.data.boards.map((entry) => (
            <Choice
              key={entry.id}
              title={entry.name}
              selected={entry.id === board.id}
              onPress={() => {
                setChosenBoard(entry.id);
                writeStore(BOARD_CHOICE_KEY, projectPath, entry.id);
                setPicking(null);
              }}
              ui={ui}
            />
          ))}
        </Modal.Content>
      </Modal>
      <AssigneePicker
        open={picking === "assignee"}
        onClose={() => setPicking(null)}
        projectPath={projectPath}
        viewer={viewer}
        value={filters.assignee}
        onChange={(assignee) => setFilters({ ...filters, assignee })}
        ui={ui}
      />
      <LabelPicker
        open={picking === "labels"}
        onClose={() => setPicking(null)}
        projectPath={projectPath}
        value={filters.labels}
        onChange={(labels) => setFilters({ ...filters, labels })}
        ui={ui}
      />
      <MoveModal
        moving={moving}
        columns={columns.data?.columns ?? []}
        onClose={() => setMoving(null)}
        onMove={(to) => void move(to)}
        ui={ui}
      />
    </View>
  );
}

function BoardPanelContent({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme);
  const readStatus = useRpc(authStatusRpc);
  const readWorkspace = useRpc(workspaceRpc);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => readStatus({}), staleTime: 5 * 60_000 });
  const workspace = useQuery({
    queryKey: workspaceKey(directory ?? ""),
    queryFn: () => readWorkspace({ directory: directory ?? "" }),
    enabled: Boolean(directory) && status.data?.connected === true,
  });
  const target = useDiffTarget(workspaceId);
  const host = status.data?.connected ? status.data.host : "";
  const ui: Ui = { theme, styles, host, workspaceId };
  // The workspace's own project, or the one of the MR last opened in the diff panel.
  const projectPath = workspace.data?.checkout?.projectPath ?? target?.projectPath ?? null;

  let body: React.ReactNode;
  if (status.isPending || (workspace.isPending && workspace.fetchStatus !== "idle")) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Loading…</Text>
      </Centered>
    );
  } else if (!status.data?.connected) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Connect GitLab in Settings → GitLab first.</Text>
      </Centered>
    );
  } else if (!projectPath) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>This workspace is not a checkout of a project on {host}.</Text>
      </Centered>
    );
  } else {
    body = (
      <IssueBoard key={projectPath} projectPath={projectPath} viewer={status.data.user.username} ui={ui} />
    );
  }
  return (
    <HostContext.Provider value={host}>
      <View style={styles.screen}>{body}</View>
    </HostContext.Provider>
  );
}

/** The project's issue board in the main area: its columns, cards and filters, as GitLab shows them. */
export function BoardPanel(props: PluginWorkspacePanelProps) {
  return (
    <AccountScope workspaceId={props.workspaceId}>
      <BoardPanelContent {...props} />
    </AccountScope>
  );
}
