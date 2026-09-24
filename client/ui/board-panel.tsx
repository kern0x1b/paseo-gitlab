import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  addBoardColumnRpc,
  authStatusRpc,
  boardCardsRpc,
  boardColumnsRpc,
  boardsRpc,
  createBoardCardRpc,
  createBoardRpc,
  deleteBoardRpc,
  milestonesRpc,
  moveBoardCardRpc,
  removeBoardColumnRpc,
  searchLabelsRpc,
  searchUsersRpc,
  updateBoardRpc,
  workspaceRpc,
  type BoardCard,
  type BoardColumn,
  type BoardFilters,
  type BoardSummary,
  type ItemRef,
} from "../../shared/contract";
import { AccountScope, useRpc } from "../account";
import { useDiffTarget } from "../diff-target";
import { openItem } from "../plugin-client";
import { AvatarStack, Button, Centered, ConfirmButton, errorText, HostContext, IconButton } from "./common";
import { ItemDetail, type Ui } from "./detail";
import { STATUS_KEY } from "./queries";
import { useStyles } from "./styles";
import { workspaceKey } from "./workspace-card";

const COLUMN_WIDTH = 300;
const COLLAPSED_WIDTH = 44;
const DRAWER_WIDTH = 520;
const SEARCH_DEBOUNCE_MS = 350;
const NO_FILTERS: BoardFilters = { search: "", assignee: null, labels: [], author: null, milestone: null };
/** What a dragged card carries; a private type, so drops from anywhere else are ignored. */
const DRAG_TYPE = "application/x-paseo-gitlab-card";

const BOARD_CHOICE_KEY = "paseo-gitlab:board-choice";
const BOARD_FILTERS_KEY = "paseo-gitlab:board-filters";
const BOARD_COLLAPSED_KEY = "paseo-gitlab:board-collapsed";

type DragPayload = { id: string; iid: string; projectPath: string; fromColumnId: string };

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

function personLabel(value: string | null, viewer: string, anyone: string): string {
  if (value === null) {
    return anyone;
  }
  if (value === "@none") {
    return "Nobody";
  }
  if (value === "@any") {
    return "Anybody";
  }
  return value === viewer ? "Me" : `@${value}`;
}

const MILESTONE_WILDCARDS: { value: string | null; title: string }[] = [
  { value: null, title: "Any" },
  { value: "@none", title: "No milestone" },
  { value: "@any", title: "Any milestone" },
  { value: "@started", title: "Started" },
  { value: "@upcoming", title: "Upcoming" },
];

function milestoneLabel(value: string | null): string {
  return MILESTONE_WILDCARDS.find((entry) => entry.value === value)?.title ?? value ?? "Any";
}

function overdue(dueDate: string): boolean {
  return dueDate < new Date().toISOString().slice(0, 10);
}

/** The DOM node behind a React Native view, on the web; drag and drop is wired to it directly. */
function domNode(ref: React.RefObject<View | null>): HTMLElement | null {
  return Platform.OS === "web" ? (ref.current as unknown as HTMLElement | null) : null;
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

/** Assignee or author: a fixed choice or anyone found by name. */
function PersonPicker({
  open,
  onClose,
  title,
  projectPath,
  viewer,
  value,
  wildcards,
  onChange,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  projectPath: string;
  viewer: string;
  value: string | null;
  wildcards: { value: string | null; title: string }[];
  onChange: (value: string | null) => void;
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
    <Modal title={title} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        {wildcards.map((entry) => (
          <Choice
            key={String(entry.value)}
            title={entry.title}
            selected={value === entry.value}
            onPress={() => pick(entry.value)}
            ui={ui}
          />
        ))}
        <Choice title="Me" selected={value === viewer} onPress={() => pick(viewer)} ui={ui} />
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

function MilestonePicker({
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
  value: string | null;
  onChange: (value: string | null) => void;
  ui: Ui;
}) {
  const { styles } = ui;
  const readMilestones = useRpc(milestonesRpc);
  const milestones = useQuery({
    queryKey: boardKey("milestones", projectPath),
    queryFn: () => readMilestones({ projectPath }),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const pick = (next: string | null) => {
    onChange(next);
    onClose();
  };
  return (
    <Modal title="Milestone" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        {MILESTONE_WILDCARDS.map((entry) => (
          <Choice
            key={String(entry.value)}
            title={entry.title}
            selected={value === entry.value}
            onPress={() => pick(entry.value)}
            ui={ui}
          />
        ))}
        {milestones.isPending ? <Text style={styles.small}>Loading milestones…</Text> : null}
        {milestones.data?.milestones.map((milestone) => (
          <Choice
            key={milestone.id}
            title={milestone.dueDate ? `${milestone.title} · ${milestone.dueDate}` : milestone.title}
            selected={value === milestone.title}
            onPress={() => pick(milestone.title)}
            ui={ui}
          />
        ))}
      </Modal.Content>
    </Modal>
  );
}

type PickedLabel = { id: string; title: string; color: string; textColor: string };

/** Labels found by name: several for the filter, or one for a new list. */
function LabelPicker({
  open,
  onClose,
  title,
  projectPath,
  value,
  exclude = [],
  onChange,
  onPick,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  projectPath: string;
  value: string[];
  exclude?: string[];
  onChange?: (labels: string[]) => void;
  onPick?: (label: PickedLabel) => void;
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
  const press = (label: PickedLabel) => {
    if (onPick) {
      onPick(label);
      onClose();
      return;
    }
    onChange?.(
      value.includes(label.title) ? value.filter((entry) => entry !== label.title) : [...value, label.title],
    );
  };
  return (
    <Modal title={title} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        {onChange ? <Text style={styles.small}>Cards that carry every label you pick.</Text> : null}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search labels…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          autoFocus
        />
        {labels.isPending ? <Text style={styles.small}>Loading…</Text> : null}
        {labels.data?.labels
          .filter((label) => !exclude.includes(label.title))
          .map((label) => {
            const checked = value.includes(label.title);
            return (
              <Pressable
                key={label.id}
                accessibilityRole={onPick ? "button" : "checkbox"}
                accessibilityState={onPick ? undefined : { checked }}
                onPress={() => press(label)}
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
        {onChange ? (
          <View style={styles.row}>
            <View style={styles.spacer} />
            {value.length > 0 ? (
              <Button label="Clear" onPress={() => onChange([])} styles={styles} theme={theme} />
            ) : null}
            <Button label="Done" primary onPress={onClose} styles={styles} theme={theme} />
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function CardView({
  card,
  columnId,
  dropBefore,
  onOpen,
  onMove,
  ui,
}: {
  card: BoardCard;
  columnId: string;
  /** A dragged card would land right above this one. */
  dropBefore: boolean;
  onOpen: () => void;
  onMove: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const ref = useRef<View | null>(null);
  const [dragging, setDragging] = useState(false);
  const late = card.dueDate ? overdue(card.dueDate) : false;

  useEffect(() => {
    const node = domNode(ref);
    if (!node) {
      return;
    }
    node.draggable = true;
    node.dataset.cardId = card.id;
    const payload: DragPayload = {
      id: card.id,
      iid: card.iid,
      projectPath: card.projectPath,
      fromColumnId: columnId,
    };
    const onStart = (event: DragEvent) => {
      event.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(payload));
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
      setDragging(true);
    };
    const onEnd = () => setDragging(false);
    node.addEventListener("dragstart", onStart);
    node.addEventListener("dragend", onEnd);
    return () => {
      node.removeEventListener("dragstart", onStart);
      node.removeEventListener("dragend", onEnd);
    };
  }, [card.id, card.iid, card.projectPath, columnId]);

  return (
    <View ref={ref} style={[{ gap: 4 }, dragging ? { opacity: 0.4 } : null]}>
      {dropBefore ? (
        <View style={{ height: 3, borderRadius: 2, backgroundColor: theme.colors.accent }} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={card.title}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.card,
          { padding: 10, gap: 6 },
          Platform.OS === "web" ? ({ cursor: "grab" } as object) : null,
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
    </View>
  );
}

/** A new issue typed at the top of a column; it gets the column's label, or none in Open. */
function NewCard({
  column,
  projectPath,
  onDone,
  ui,
}: {
  column: BoardColumn;
  projectPath: string;
  onDone: (created: ItemRef | null) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const toast = useToast();
  const createCard = useRpc(createBoardCardRpc);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim()) {
      return;
    }
    setBusy(true);
    try {
      const created = await createCard({
        projectPath,
        title: title.trim(),
        labelId: column.label?.id ?? null,
      });
      toast.show(`Created #${created.iid}`, { variant: "success" });
      onDone(created);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.card, { padding: 10, gap: 8 }]}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Issue title"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.input}
        autoFocus
        onSubmitEditing={() => void submit()}
      />
      <View style={styles.row}>
        <View style={styles.spacer} />
        <Button label="Cancel" onPress={() => onDone(null)} styles={styles} theme={theme} />
        <Button
          label="Create issue"
          primary
          busy={busy}
          disabled={!title.trim()}
          onPress={() => void submit()}
          styles={styles}
          theme={theme}
        />
      </View>
    </View>
  );
}

function Column({
  column,
  projectPath,
  filters,
  collapsed,
  height,
  onToggle,
  onOpen,
  onMove,
  onDrop,
  onRemove,
  onCreated,
  ui,
}: {
  column: BoardColumn;
  projectPath: string;
  filters: BoardFilters;
  collapsed: boolean;
  /** The board's height, measured: columns run the full height and scroll their own cards. */
  height: number;
  onToggle: () => void;
  onOpen: (card: BoardCard) => void;
  onMove: (card: BoardCard, from: BoardColumn) => void;
  onDrop: (payload: DragPayload, to: BoardColumn, beforeId: string | null, lastId: string | null) => void;
  onRemove: () => void;
  onCreated: (created: ItemRef) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readCards = useRpc(boardCardsRpc);
  const ref = useRef<View | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [over, setOver] = useState<{ before: string | null } | null>(null);
  const cards = useInfiniteQuery({
    queryKey: boardKey("cards", column.id, JSON.stringify(filters)),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => readCards({ columnId: column.id, after: pageParam, filters }),
    getNextPageParam: (last) => (last.hasNextPage ? last.endCursor : undefined),
    enabled: !collapsed,
  });
  const loaded = cards.data?.pages.flatMap((page) => page.cards) ?? [];
  const lastId = loaded[loaded.length - 1]?.id ?? null;
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const lastRef = useRef(lastId);
  lastRef.current = lastId;

  // The column takes drops: the card lands above the one under the pointer, or at the end.
  useEffect(() => {
    const node = domNode(ref);
    if (!node) {
      return;
    }
    const cardUnder = (event: DragEvent) =>
      (event.target as Element | null)?.closest?.("[data-card-id]")?.getAttribute("data-card-id") ?? null;
    const onOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const before = cardUnder(event);
      setOver((current) => (current?.before === before ? current : { before }));
    };
    const onLeave = (event: DragEvent) => {
      if (!node.contains(event.relatedTarget as Node | null)) {
        setOver(null);
      }
    };
    const onDropEvent = (event: DragEvent) => {
      const raw = event.dataTransfer?.getData(DRAG_TYPE);
      setOver(null);
      if (!raw) {
        return;
      }
      event.preventDefault();
      try {
        dropRef.current(JSON.parse(raw) as DragPayload, column, cardUnder(event), lastRef.current);
      } catch {
        // Not a card from this board.
      }
    };
    node.addEventListener("dragover", onOver);
    node.addEventListener("dragleave", onLeave);
    node.addEventListener("drop", onDropEvent);
    return () => {
      node.removeEventListener("dragover", onOver);
      node.removeEventListener("dragleave", onLeave);
      node.removeEventListener("drop", onDropEvent);
    };
  }, [column]);

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
    borderWidth: over ? 1 : 0,
    borderColor: theme.colors.accent,
  };
  if (collapsed) {
    return (
      <Pressable
        ref={ref}
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
  return (
    <View ref={ref} style={frame}>
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
        {column.listType !== "closed" ? (
          <IconButton
            icon="Plus"
            label={`New issue in ${column.title}`}
            onPress={() => setAdding(true)}
            theme={theme}
            styles={styles}
          />
        ) : null}
        {column.listType === "label" ? (
          <IconButton
            icon="EllipsisVertical"
            label={`${column.title} list actions`}
            onPress={() => setMenu(true)}
            theme={theme}
            styles={styles}
          />
        ) : null}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 10, gap: 8 }}
      >
        {adding ? (
          <NewCard
            column={column}
            projectPath={projectPath}
            onDone={(created) => {
              setAdding(false);
              if (created) {
                onCreated(created);
              }
            }}
            ui={ui}
          />
        ) : null}
        {cards.isPending ? <Text style={[styles.small, { padding: 6 }]}>Loading…</Text> : null}
        {cards.isError ? <Text style={[styles.error, { padding: 6 }]}>{errorText(cards.error)}</Text> : null}
        {cards.isSuccess && loaded.length === 0 ? (
          <Text style={[styles.small, { padding: 6 }]}>{over ? "Drop here" : "No issues."}</Text>
        ) : null}
        {loaded.map((card) => (
          <CardView
            key={card.reference}
            card={card}
            columnId={column.id}
            dropBefore={over?.before === card.id}
            onOpen={() => onOpen(card)}
            onMove={() => onMove(card, column)}
            ui={ui}
          />
        ))}
        {over && over.before === null && loaded.length > 0 ? (
          <View style={{ height: 3, borderRadius: 2, backgroundColor: theme.colors.accent }} />
        ) : null}
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
      <Modal title={`${column.title} list`} open={menu} onOpenChange={setMenu}>
        <Modal.Content>
          <Text style={styles.small}>
            Removing the list keeps its issues and their label; only the column goes from this board.
          </Text>
          <View style={styles.row}>
            <View style={styles.spacer} />
            <ConfirmButton
              label="Remove list"
              title={`Remove the ${column.title} list?`}
              message={`The ${column.title} column is removed from the board for everyone. Issues keep the label.`}
              confirmLabel="Remove list"
              onConfirm={() => {
                setMenu(false);
                onRemove();
              }}
              styles={styles}
              theme={theme}
            />
          </View>
        </Modal.Content>
      </Modal>
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

/** The board switcher: every board of the project, a new one, and renaming or deleting this one. */
function BoardsModal({
  open,
  onClose,
  projectPath,
  boards,
  current,
  onPick,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  boards: BoardSummary[];
  current: BoardSummary;
  onPick: (board: BoardSummary) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const toast = useToast();
  const queryClient = useQueryClient();
  const createBoard = useRpc(createBoardRpc);
  const updateBoard = useRpc(updateBoardRpc);
  const deleteBoard = useRpc(deleteBoardRpc);
  const [mode, setMode] = useState<"list" | "create" | "rename">("list");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => queryClient.invalidateQueries({ queryKey: boardKey("list", projectPath) });
  const close = () => {
    setMode("list");
    setName("");
    onClose();
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const shown = boards.filter((board) => board.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Modal title="Boards" open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <Modal.Content>
        {mode === "list" ? (
          <>
            {boards.length > 6 ? (
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search boards…"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
              />
            ) : null}
            {shown.map((board) => (
              <Choice
                key={board.id}
                title={board.name}
                selected={board.id === current.id}
                onPress={() => {
                  onPick(board);
                  close();
                }}
                ui={ui}
              />
            ))}
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              <Button
                label="New board"
                primary
                onPress={() => setMode("create")}
                styles={styles}
                theme={theme}
              />
              <Button
                label={`Rename ${current.name}`}
                onPress={() => {
                  setName(current.name);
                  setMode("rename");
                }}
                styles={styles}
                theme={theme}
              />
              {boards.length > 1 ? (
                <ConfirmButton
                  label={`Delete ${current.name}`}
                  title={`Delete the ${current.name} board?`}
                  message="The board and its lists go for everyone on the project. Issues and labels stay as they are."
                  confirmLabel="Delete board"
                  busy={busy}
                  onConfirm={() =>
                    void run(async () => {
                      await deleteBoard({ boardId: current.id });
                      toast.show(`Deleted ${current.name}`, { variant: "success" });
                      const next = boards.find((board) => board.id !== current.id);
                      if (next) {
                        onPick(next);
                      }
                      await reload();
                      close();
                    })
                  }
                  styles={styles}
                  theme={theme}
                />
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Text style={styles.small}>
              {mode === "create"
                ? "A new board starts with Open and Closed; add a list for each label you want as a column."
                : "Everyone on the project sees the new name."}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Board name"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
              autoFocus
            />
            <View style={styles.row}>
              <View style={styles.spacer} />
              <Button label="Cancel" onPress={() => setMode("list")} styles={styles} theme={theme} />
              <Button
                label={mode === "create" ? "Create board" : "Save"}
                primary
                busy={busy}
                disabled={!name.trim()}
                onPress={() =>
                  void run(async () => {
                    if (mode === "create") {
                      const created = await createBoard({ projectPath, name: name.trim() });
                      toast.show(`Created ${created.name}`, { variant: "success" });
                      onPick(created);
                    } else {
                      await updateBoard({ boardId: current.id, name: name.trim() });
                      toast.show("Board renamed", { variant: "success" });
                    }
                    await reload();
                    close();
                  })
                }
                styles={styles}
                theme={theme}
              />
            </View>
          </>
        )}
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
  const addColumn = useRpc(addBoardColumnRpc);
  const removeColumn = useRpc(removeBoardColumnRpc);
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
  const [picking, setPicking] = useState<
    "board" | "assignee" | "author" | "milestone" | "labels" | "list" | null
  >(null);
  const [moving, setMoving] = useState<{ card: BoardCard; from: BoardColumn } | null>(null);
  const [opened, setOpened] = useState<ItemRef | null>(null);
  const [boardHeight, setBoardHeight] = useState(0);

  // Filters and folded columns are remembered per board, like GitLab keeps them in the URL.
  useEffect(() => {
    if (!board) {
      return;
    }
    const saved = { ...NO_FILTERS, ...readStore<Partial<BoardFilters>>(BOARD_FILTERS_KEY)[board.id] };
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
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast.show(done, { variant: "success" });
    } catch (error) {
      toast.error(errorText(error));
    }
    refresh();
  };
  const moveTo = (
    card: { iid: string; projectPath: string },
    fromId: string,
    to: BoardColumn,
    place: { moveBeforeId?: string; moveAfterId?: string },
  ) =>
    act(
      () =>
        moveCard({
          projectPath: card.projectPath,
          iid: card.iid,
          boardId: board!.id,
          fromColumnId: fromId,
          toColumnId: to.id,
          ...place,
        }),
      `Moved #${card.iid} to ${to.title}`,
    );
  const drop = (payload: DragPayload, to: BoardColumn, beforeId: string | null, lastId: string | null) => {
    if (beforeId === payload.id) {
      return;
    }
    if (beforeId) {
      void moveTo(payload, payload.fromColumnId, to, { moveBeforeId: beforeId });
    } else if (lastId && lastId !== payload.id) {
      void moveTo(payload, payload.fromColumnId, to, { moveAfterId: lastId });
    } else if (payload.fromColumnId !== to.id) {
      void moveTo(payload, payload.fromColumnId, to, {});
    }
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
  const filtered =
    Boolean(filters.search) ||
    filters.assignee !== null ||
    filters.author !== null ||
    filters.milestone !== null ||
    filters.labels.length > 0;
  const columnLabels = (columns.data?.columns ?? []).flatMap((column) =>
    column.label ? [column.label.title] : [],
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch board"
              onPress={() => setPicking("board")}
              style={({ pressed }) => [
                styles.row,
                {
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1,
                },
              ]}
            >
              <Icon name="Kanban" size={14} color={theme.colors.foreground} />
              <Text style={[styles.text, { fontWeight: "600" }]} numberOfLines={1}>
                {board.name}
              </Text>
              <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
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
              `Assignee: ${personLabel(filters.assignee, viewer, "Anyone")}`,
              () => setPicking("assignee"),
              filters.assignee !== null,
              "Filter by assignee",
            )}
            {chip(
              "UserPen",
              `Author: ${personLabel(filters.author, viewer, "Anyone")}`,
              () => setPicking("author"),
              filters.author !== null,
              "Filter by author",
            )}
            {chip(
              "Clock",
              `Milestone: ${milestoneLabel(filters.milestone)}`,
              () => setPicking("milestone"),
              filters.milestone !== null,
              "Filter by milestone",
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
            {filtered ? (
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
                    projectPath={projectPath}
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
                    onDrop={drop}
                    onRemove={() =>
                      void act(
                        () => removeColumn({ columnId: column.id }),
                        `Removed the ${column.title} list`,
                      )
                    }
                    onCreated={(created) => {
                      refresh();
                      setOpened(created);
                    }}
                    ui={ui}
                  />
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a list"
                onPress={() => setPicking("list")}
                style={({ pressed }) => [
                  styles.row,
                  {
                    gap: 6,
                    width: 180,
                    padding: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderColor: theme.colors.border,
                    backgroundColor: pressed ? theme.colors.surface1 : "transparent",
                  },
                ]}
              >
                <Icon name="Plus" size={14} color={theme.colors.foregroundMuted} />
                <Text style={styles.muted}>Add list</Text>
              </Pressable>
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
              onOpenInTab={() => openItem(ui.workspaceId, opened)}
              ui={ui}
            />
          </ScrollView>
        </View>
      ) : null}
      <BoardsModal
        open={picking === "board"}
        onClose={() => setPicking(null)}
        projectPath={projectPath}
        boards={boards.data.boards}
        current={board}
        onPick={(next) => {
          setChosenBoard(next.id);
          writeStore(BOARD_CHOICE_KEY, projectPath, next.id);
        }}
        ui={ui}
      />
      <PersonPicker
        open={picking === "assignee"}
        onClose={() => setPicking(null)}
        title="Assignee"
        projectPath={projectPath}
        viewer={viewer}
        value={filters.assignee}
        wildcards={[
          { value: null, title: "Anyone" },
          { value: "@none", title: "Nobody" },
          { value: "@any", title: "Anybody" },
        ]}
        onChange={(assignee) => setFilters({ ...filters, assignee })}
        ui={ui}
      />
      <PersonPicker
        open={picking === "author"}
        onClose={() => setPicking(null)}
        title="Author"
        projectPath={projectPath}
        viewer={viewer}
        value={filters.author}
        wildcards={[{ value: null, title: "Anyone" }]}
        onChange={(author) => setFilters({ ...filters, author })}
        ui={ui}
      />
      <MilestonePicker
        open={picking === "milestone"}
        onClose={() => setPicking(null)}
        projectPath={projectPath}
        value={filters.milestone}
        onChange={(milestone) => setFilters({ ...filters, milestone })}
        ui={ui}
      />
      <LabelPicker
        open={picking === "labels"}
        onClose={() => setPicking(null)}
        title="Labels"
        projectPath={projectPath}
        value={filters.labels}
        onChange={(labels) => setFilters({ ...filters, labels })}
        ui={ui}
      />
      <LabelPicker
        open={picking === "list"}
        onClose={() => setPicking(null)}
        title="Add a list for label"
        projectPath={projectPath}
        value={[]}
        exclude={columnLabels}
        onPick={(label) =>
          void act(() => addColumn({ boardId: board.id, labelId: label.id }), `Added the ${label.title} list`)
        }
        ui={ui}
      />
      <MoveModal
        moving={moving}
        columns={columns.data?.columns ?? []}
        onClose={() => setMoving(null)}
        onMove={(to) => {
          const current = moving;
          setMoving(null);
          if (current) {
            void moveTo(current.card, current.from.id, to, {});
          }
        }}
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
