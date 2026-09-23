import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, ScrollView as NativeScrollView, Text, View } from "react-native";
import {
  authStatusRpc,
  commitsRpc,
  detailRpc,
  diffsRpc,
  fileLinesRpc,
  listsRpc,
  scopedDiffsRpc,
  versionsRpc,
  workspaceRpc,
  type DiffFile,
  type ItemRef,
} from "../../shared/contract";
import { setDiffTarget, useDiffTarget } from "../diff-target";
import {
  addPendingComment,
  editPendingComment,
  removePendingComments,
  reviewKey,
  usePendingComments,
} from "../review-store";
import { setViewed, useReviewedAt, useViewed } from "../viewed-store";
import { diffsKey, FileDiff, fileKey, type DiffView } from "./changes";
import { agentMessage, type CodeSelection } from "./code-comment";
import { Button, Centered, errorText, HostContext, IconButton } from "./common";
import { ProjectContext } from "./composer-tools";
import { useNoteActions, type Ui } from "./detail";
import { contentHash, sinceLastReview } from "./diff-view";
import { shortReference, timeAgo } from "./format";
import { detailKey, LISTS_KEY, STATUS_KEY } from "./queries";
import { SubmitReview } from "./submit-review";
import { buildTree, type TreeNode } from "./tree";
import { useStyles, type Styles } from "./styles";
import { workspaceKey } from "./workspace-card";
import { preferredAgent, useWorkspaceAgents } from "./workspace-agents";

const TREE_WIDTH = { initial: 300, min: 180, max: 640 };
const TREE_WIDTH_KEY = "paseo-gitlab:tree-width";
const DETAIL_REFRESH_MS = 30_000;
const WRAP_KEY = "paseo-gitlab:wrap-lines";

function storedTreeWidth(): number {
  const raw = Number(globalThis.localStorage?.getItem(TREE_WIDTH_KEY));
  return Number.isFinite(raw) && raw >= TREE_WIDTH.min && raw <= TREE_WIDTH.max ? raw : TREE_WIDTH.initial;
}

/**
 * A thin handle between the tree and the diff; drag it to make the tree wider or narrower.
 * On the web it listens to pointer events itself and turns text selection off while
 * dragging: without that the browser selects every row the pointer passes over.
 */
function Splitter({ width, onChange, ui }: { width: number; onChange: (width: number) => void; ui: Ui }) {
  const start = useRef(width);
  const [dragging, setDragging] = useState(false);
  const clamp = (next: number) => Math.min(TREE_WIDTH.max, Math.max(TREE_WIDTH.min, next));
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = width;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => onChange(clamp(start.current + gesture.dx)),
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [width, onChange],
  );
  const onPointerDown = (event: { clientX: number; preventDefault: () => void }) => {
    event.preventDefault();
    const originX = event.clientX;
    const originWidth = width;
    const body = document.body.style;
    const previous = { userSelect: body.userSelect, cursor: body.cursor };
    body.userSelect = "none";
    body.cursor = "col-resize";
    globalThis.getSelection?.()?.removeAllRanges();
    setDragging(true);
    const move = (next: PointerEvent) => onChange(clamp(originWidth + next.clientX - originX));
    const stop = () => {
      body.userSelect = previous.userSelect;
      body.cursor = previous.cursor;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const handlers =
    Platform.OS === "web"
      ? ({
          onPointerDown: (event: { nativeEvent: PointerEvent }) => onPointerDown(event.nativeEvent),
        } as object)
      : responder.panHandlers;
  return (
    <View
      {...handlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Resize the file tree"
      style={[
        { width: 6, marginLeft: -3, marginRight: -3, zIndex: 2 },
        Platform.OS === "web"
          ? ({ cursor: "col-resize", touchAction: "none", userSelect: "none" } as object)
          : null,
      ]}
    >
      <View
        style={{
          width: dragging ? 2 : 1,
          alignSelf: "center",
          flex: 1,
          backgroundColor: dragging ? ui.theme.colors.accent : ui.theme.colors.border,
        }}
      />
    </View>
  );
}

function Counts({ file, styles, ui }: { file: DiffFile; styles: Styles; ui: Ui }) {
  return (
    <>
      <Text style={[styles.small, { color: ui.theme.colors.statusSuccess }]}>+{file.additions}</Text>
      <Text style={[styles.small, { color: ui.theme.colors.statusDanger }]}>−{file.deletions}</Text>
    </>
  );
}

type FileFilter = "all" | "unviewed" | "commented";

/** The changed files, as GitLab's file browser shows them: a folder tree or a flat list, with a filter. */
function FileBrowser({
  files,
  active,
  onSelect,
  pendingByFile,
  threadsByFile,
  viewed,
  width,
  ui,
}: {
  files: DiffFile[];
  width: number;
  active: string | null;
  onSelect: (file: DiffFile) => void;
  pendingByFile: Map<string, number>;
  threadsByFile: Map<string, number>;
  viewed: ReadonlySet<string>;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const [asTree, setAsTree] = useState(true);
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<FileFilter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const notesOn = (file: DiffFile) =>
    (pendingByFile.get(fileKey(file)) ?? 0) + (threadsByFile.get(fileKey(file)) ?? 0);
  const needle = filter.trim().toLowerCase();
  const shown = files.filter(
    (file) =>
      (!needle || file.newPath.toLowerCase().includes(needle)) &&
      (only === "all" || (only === "unviewed" ? !viewed.has(fileKey(file)) : notesOn(file) > 0)),
  );
  const tree = useMemo(() => buildTree(shown), [shown]);

  const fileRow = (file: DiffFile, label: string, depth: number) => {
    const key = fileKey(file);
    const selected = key === active;
    const notes = notesOn(file);
    const seen = viewed.has(key);
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={file.newPath}
        onPress={() => onSelect(file)}
        style={({ pressed }) => [
          styles.row,
          { paddingVertical: 4, paddingRight: 8, paddingLeft: 8 + depth * 14, borderRadius: 6, gap: 6 },
          selected ? { backgroundColor: theme.colors.surface2 } : pressed ? styles.listRowPressed : null,
        ]}
      >
        <Text
          style={[
            styles.text,
            { flex: 1, fontSize: 12 },
            seen ? { color: theme.colors.foregroundMuted } : null,
            file.deletedFile
              ? { textDecorationLine: "line-through", color: theme.colors.foregroundMuted }
              : null,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {notes > 0 ? <Text style={styles.small}>💬{notes}</Text> : null}
        {seen ? (
          <Icon name="Check" size={12} color={theme.colors.foregroundMuted} />
        ) : (
          <Counts file={file} styles={styles} ui={ui} />
        )}
      </Pressable>
    );
  };

  const node = (entry: TreeNode, depth: number): React.ReactNode => {
    if (entry.file) {
      return fileRow(entry.file, entry.name, depth);
    }
    const closed = collapsed.has(entry.path);
    return (
      <View key={`dir:${entry.path}`}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !closed }}
          onPress={() =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(entry.path)) {
                next.delete(entry.path);
              } else {
                next.add(entry.path);
              }
              return next;
            })
          }
          style={[styles.row, { paddingVertical: 4, paddingLeft: 8 + depth * 14, gap: 6 }]}
        >
          <Text style={styles.small}>{closed ? "▸" : "▾"}</Text>
          <Text style={[styles.muted, { flex: 1, fontSize: 12 }]} numberOfLines={1}>
            {entry.name}
          </Text>
        </Pressable>
        {closed ? null : entry.children.map((child) => node(child, depth + 1))}
      </View>
    );
  };

  const segmented = <T extends string | boolean>(
    options: { id: T; label: string; description: string }[],
    value: T,
    onChange: (next: T) => void,
  ) => (
    <View style={styles.tabs}>
      {options.map((option) => (
        <Pressable
          key={String(option.id)}
          accessibilityRole="tab"
          accessibilityLabel={option.description}
          accessibilityState={{ selected: value === option.id }}
          onPress={() => onChange(option.id)}
          style={[styles.tab, { paddingHorizontal: 8 }, value === option.id ? styles.tabActive : null]}
        >
          <Text style={styles.small}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={{ width }}>
      <View style={{ padding: 10, gap: 8 }}>
        <View style={styles.row}>
          <Text style={[styles.text, { fontWeight: "600", flex: 1 }]}>
            Files {shown.length === files.length ? files.length : `${shown.length}/${files.length}`}
          </Text>
          {segmented(
            [
              { id: false, label: "List", description: "Show as a list" },
              { id: true, label: "Tree", description: "Show as a tree" },
            ],
            asTree,
            setAsTree,
          )}
        </View>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter files…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.input, { minHeight: 0, paddingVertical: 6 }]}
        />
        {segmented<FileFilter>(
          [
            { id: "all", label: "All", description: "Show every file" },
            { id: "unviewed", label: "Unviewed", description: "Show the files you have not marked viewed" },
            {
              id: "commented",
              label: "Commented",
              description: "Show the files with threads or your comments",
            },
          ],
          only,
          setOnly,
        )}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 16 }}>
        {asTree ? tree.map((entry) => node(entry, 0)) : shown.map((file) => fileRow(file, file.newPath, 0))}
        {shown.length === 0 ? <Text style={[styles.small, { padding: 8 }]}>No file matches.</Text> : null}
      </ScrollView>
    </View>
  );
}

function MergeRequestPicker({
  open,
  onClose,
  onPick,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ref: ItemRef) => void;
  ui: Ui;
}) {
  const { styles } = ui;
  const readLists = useRpc(listsRpc);
  const lists = useQuery({ queryKey: LISTS_KEY, queryFn: () => readLists({}), enabled: open });
  const items = lists.data ? [...lists.data.mergeRequests, ...lists.data.reviewMergeRequests] : [];
  return (
    <Modal title="Show the changes of" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        {lists.isPending ? <Text style={styles.muted}>Loading…</Text> : null}
        {items.map((item) => (
          <Pressable
            key={item.reference}
            accessibilityRole="button"
            onPress={() => {
              onPick({ kind: "mr", projectPath: item.projectPath, iid: item.iid });
              onClose();
            }}
            style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
          >
            <Text style={styles.small}>{shortReference(item.reference)}</Text>
            <Text style={styles.listTitle} numberOfLines={2}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </Modal.Content>
    </Modal>
  );
}

/** Which of the MR's changes the panel shows. */
type Scope =
  | { kind: "mr" }
  | { kind: "compare"; from: string; to: string; label: string }
  | { kind: "commit"; sha: string; parentSha: string | null; label: string };

function scopeId(scope: Scope): string {
  return scope.kind === "mr"
    ? "mr"
    : scope.kind === "compare"
      ? `compare:${scope.from}..${scope.to}`
      : `commit:${scope.sha}`;
}

/** The commits a comment on this scope's diff is anchored to, when they differ from the MR's own. */
function scopeRefs(scope: Scope): { baseSha: string; headSha: string; startSha: string } | null {
  if (scope.kind === "compare") {
    return { baseSha: scope.from, startSha: scope.from, headSha: scope.to };
  }
  if (scope.kind === "commit" && scope.parentSha) {
    return { baseSha: scope.parentSha, startSha: scope.parentSha, headSha: scope.sha };
  }
  return null;
}

function ScopeRow({
  title,
  description,
  selected,
  onPress,
  ui,
}: {
  title: string;
  description: string;
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
      style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
    >
      <View style={[styles.row, { gap: 8 }]}>
        <Text style={[styles.text, { flex: 1, fontWeight: selected ? "600" : "400" }]} numberOfLines={1}>
          {title}
        </Text>
        {selected ? <Icon name="Check" size={14} color={theme.colors.accent} /> : null}
      </View>
      <Text style={styles.small} numberOfLines={1}>
        {description}
      </Text>
    </Pressable>
  );
}

/** "Compare": the whole MR, what came since your last review, one push, or one commit. */
function ScopePicker({
  open,
  onClose,
  target,
  scope,
  onPick,
  since,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  target: ItemRef;
  scope: Scope;
  onPick: (scope: Scope) => void;
  since: { from: string; to: string; pushes: number } | null;
  ui: Ui;
}) {
  const { styles } = ui;
  const readVersions = useRpc(versionsRpc);
  const readCommits = useRpc(commitsRpc);
  const ref = { projectPath: target.projectPath, iid: target.iid };
  const versions = useQuery({
    queryKey: versionsKey(target),
    queryFn: () => readVersions(ref),
    enabled: open,
  });
  const commits = useQuery({
    queryKey: ["gitlab", "commits", target.projectPath, target.iid],
    queryFn: () => readCommits(ref),
    enabled: open,
  });
  const current = scopeId(scope);
  const choose = (next: Scope) => {
    onPick(next);
    onClose();
  };
  const pushes = versions.data?.versions ?? [];
  return (
    <Modal title="Show changes" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <ScopeRow
          title="All changes"
          description="Everything this merge request changes against its target branch"
          selected={current === "mr"}
          onPress={() => choose({ kind: "mr" })}
          ui={ui}
        />
        {since ? (
          <ScopeRow
            title="Since your last review"
            description={`${since.pushes} ${since.pushes === 1 ? "push" : "pushes"} after the one you reviewed`}
            selected={current === `compare:${since.from}..${since.to}`}
            onPress={() =>
              choose({ kind: "compare", from: since.from, to: since.to, label: "Since your last review" })
            }
            ui={ui}
          />
        ) : null}
        {pushes.length > 1 ? <Text style={styles.sectionTitle}>Pushes</Text> : null}
        {pushes.length > 1
          ? pushes.map((version, index) => {
              const previous = pushes[index + 1];
              const from = previous?.headSha ?? version.baseSha;
              const number = pushes.length - index;
              const next: Scope = { kind: "compare", from, to: version.headSha, label: `Push ${number}` };
              return (
                <ScopeRow
                  key={version.id}
                  title={`Push ${number}${index === 0 ? " · latest" : ""}`}
                  description={`${version.headSha.slice(0, 8)} · ${timeAgo(version.createdAt)}${previous ? "" : " · the first version"}`}
                  selected={current === scopeId(next)}
                  onPress={() => choose(next)}
                  ui={ui}
                />
              );
            })
          : null}
        <Text style={styles.sectionTitle}>Commits</Text>
        {commits.isPending ? <Text style={styles.small}>Loading commits…</Text> : null}
        {commits.isError ? <Text style={styles.error}>{errorText(commits.error)}</Text> : null}
        {commits.data?.commits.map((commit) => {
          const next: Scope = {
            kind: "commit",
            sha: commit.sha,
            parentSha: commit.parentSha,
            label: commit.shortSha,
          };
          return (
            <ScopeRow
              key={commit.sha}
              title={commit.title}
              description={`${commit.shortSha} · ${commit.author} · ${timeAgo(commit.createdAt)}`}
              selected={current === scopeId(next)}
              onPress={() => choose(next)}
              ui={ui}
            />
          );
        })}
      </Modal.Content>
    </Modal>
  );
}

function versionsKey(target: ItemRef) {
  return ["gitlab", "versions", target.projectPath, target.iid] as const;
}

const VIEW_KEY = "paseo-gitlab:diff-view";

function storedView(): DiffView {
  try {
    const raw = globalThis.localStorage?.getItem(VIEW_KEY);
    if (raw) {
      return JSON.parse(raw) as DiffView;
    }
    return { wrap: globalThis.localStorage?.getItem(WRAP_KEY) === "true" };
  } catch {
    return {};
  }
}

const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous file"],
  ["v", "Mark the file viewed and go to the next one"],
  ["s", "Side by side"],
  ["w", "Wrap long lines"],
  ["x", "Hide whitespace changes"],
  ["t", "Show or hide the file tree"],
];

function Toggle({
  label,
  checked,
  disabled,
  onChange,
  ui,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[styles.row, { gap: 10, paddingVertical: 4 }, disabled ? { opacity: 0.5 } : null]}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          borderWidth: 1.5,
          alignItems: "center",
          justifyContent: "center",
          borderColor: checked ? theme.colors.accent : theme.colors.foregroundMuted,
          backgroundColor: checked ? theme.colors.accent : "transparent",
        }}
      >
        {checked ? <Icon name="Check" size={11} color={theme.colors.accentForeground} /> : null}
      </View>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

function ViewOptions({
  open,
  onClose,
  view,
  onChange,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  view: DiffView;
  onChange: (view: DiffView) => void;
  ui: Ui;
}) {
  const { styles } = ui;
  return (
    <Modal title="Diff view" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <Toggle
          label="Side by side"
          checked={Boolean(view.split)}
          onChange={(split) => onChange({ ...view, split })}
          ui={ui}
        />
        <Toggle
          label="Wrap long lines"
          checked={Boolean(view.wrap || view.split)}
          disabled={view.split}
          onChange={(wrap) => onChange({ ...view, wrap })}
          ui={ui}
        />
        <Toggle
          label="Hide whitespace changes"
          checked={Boolean(view.hideWhitespace)}
          onChange={(hideWhitespace) => onChange({ ...view, hideWhitespace })}
          ui={ui}
        />
        {Platform.OS === "web" ? (
          <>
            <Text style={styles.sectionTitle}>Keyboard</Text>
            {SHORTCUTS.map(([keys, action]) => (
              <View key={keys} style={[styles.row, { gap: 12 }]}>
                <Text style={[styles.small, { width: 48, fontWeight: "600" }]}>{keys}</Text>
                <Text style={styles.small}>{action}</Text>
              </View>
            ))}
          </>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

/**
 * Keys for the diff, on the web only and only after you last clicked inside it,
 * so typing j into an agent's composer or clicking another panel is left alone.
 */
function useDiffKeys(root: React.RefObject<View | null>, onKey: (key: string) => boolean) {
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }
    let inside = false;
    const element = () => root.current as unknown as HTMLElement | null;
    const onPointer = (event: PointerEvent) => {
      inside = Boolean(element()?.contains(event.target as Node));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !inside ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !element()?.offsetParent ||
        (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      ) {
        return;
      }
      if (handler.current(event.key)) {
        event.preventDefault();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [root]);
}

function ReviewDiff({ target, ui, onPickOther }: { target: ItemRef; ui: Ui; onPickOther: () => void }) {
  const { styles, theme } = ui;
  const paseo = usePaseo();
  const toast = useToast();
  const readDetail = useRpc(detailRpc);
  const readDiffs = useRpc(diffsRpc);
  const readScoped = useRpc(scopedDiffsRpc);
  const readVersions = useRpc(versionsRpc);
  const readFileLines = useRpc(fileLinesRpc);
  const readWorkspace = useRpc(workspaceRpc);
  const directory = useWorkspace(ui.workspaceId, (workspace) => workspace.directory);
  const [scope, setScope] = useState<Scope>({ kind: "mr" });
  const scopeKey = scopeId(scope);
  // Refreshed so a reviewer's new comments show up under their lines without reopening.
  const detail = useQuery({
    queryKey: detailKey(target),
    queryFn: () => readDetail(target),
    refetchInterval: DETAIL_REFRESH_MS,
  });
  const diffs = useQuery({
    queryKey:
      scope.kind === "mr" ? diffsKey(target) : ["gitlab", "diffs", target.projectPath, target.iid, scopeKey],
    queryFn: () =>
      scope.kind === "mr"
        ? readDiffs({ projectPath: target.projectPath, iid: target.iid })
        : scope.kind === "compare"
          ? readScoped({ kind: "compare", projectPath: target.projectPath, from: scope.from, to: scope.to })
          : readScoped({ kind: "commit", projectPath: target.projectPath, sha: scope.sha }),
  });
  const versions = useQuery({
    queryKey: versionsKey(target),
    queryFn: () => readVersions({ projectPath: target.projectPath, iid: target.iid }),
    staleTime: DETAIL_REFRESH_MS,
  });
  const workspace = useQuery({
    queryKey: workspaceKey(directory ?? ""),
    queryFn: () => readWorkspace({ directory: directory ?? "" }),
    enabled: Boolean(directory),
  });
  const agents = useWorkspaceAgents(ui.workspaceId);
  const actions = useNoteActions(target, detail.data);
  const review = reviewKey(target);
  const allPending = usePendingComments(review);
  const pending = allPending.filter((comment) => (comment.scope ?? "mr") === scopeKey);
  const viewedMarks = useViewed(review);
  const localReviewAt = useReviewedAt(review);
  const [treeOpen, setTreeOpen] = useState(true);
  const [view, setViewState] = useState<DiffView>(storedView);
  const setView = (next: DiffView) => {
    setViewState(next);
    try {
      globalThis.localStorage?.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      // No storage: the choice lasts until the window closes.
    }
  };
  const [treeWidth, setTreeWidthState] = useState(storedTreeWidth);
  const setTreeWidth = useMemo(
    () => (next: number) => {
      setTreeWidthState(next);
      try {
        globalThis.localStorage?.setItem(TREE_WIDTH_KEY, String(Math.round(next)));
      } catch {
        // No storage: the width lasts until the window closes.
      }
    },
    [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [viewOptions, setViewOptions] = useState(false);
  // Files opened or closed by hand; the rest are open unless marked viewed.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<View | null>(null);
  const scroll = useRef<NativeScrollView | null>(null);
  const offsets = useRef(new Map<string, number>());

  const files = diffs.data?.files ?? [];
  const hashes = useMemo(() => new Map(files.map((file) => [fileKey(file), contentHash(file)])), [files]);
  const viewedKey = (file: DiffFile) => `${scopeKey}\0${fileKey(file)}`;
  const viewed = useMemo(
    () =>
      new Set(
        files.filter((file) => viewedMarks[viewedKey(file)] === hashes.get(fileKey(file))).map(fileKey),
      ),
    [files, viewedMarks, hashes, scopeKey],
  );
  const pendingByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of pending) {
      const key = `${comment.oldPath}\0${comment.newPath}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [pending]);
  const threads = scope.kind === "mr" ? (detail.data?.discussions ?? []) : [];
  const threadsByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) {
      const count = threads.filter((discussion) => {
        const path = discussion.notes[0]?.position?.path;
        return path === file.newPath || path === file.oldPath;
      }).length;
      if (count) {
        counts.set(fileKey(file), count);
      }
    }
    return counts;
  }, [files, threads]);

  // Your last review: the later of a review sent from here and your last note on the MR.
  const lastNoteAt = (detail.data?.discussions ?? [])
    .flatMap((discussion) => discussion.notes)
    .filter((note) => !note.system && note.author?.username === detail.data?.viewer)
    .reduce<string | null>(
      (latest, note) => (!latest || note.createdAt > latest ? note.createdAt : latest),
      null,
    );
  const reviewedAt = [localReviewAt, lastNoteAt].filter(Boolean).sort().pop() ?? null;
  const since = sinceLastReview(versions.data?.versions ?? [], reviewedAt);
  const ownsBranch =
    workspace.data?.checkout?.projectPath === target.projectPath &&
    workspace.data.checkout.branch === detail.data?.sourceBranch;

  const isExpanded = (file: DiffFile) => toggled.get(fileKey(file)) ?? !viewed.has(fileKey(file));
  const setExpanded = (file: DiffFile, open: boolean) =>
    setToggled((current) => new Map(current).set(fileKey(file), open));
  const markViewed = (file: DiffFile, value: boolean) => {
    setViewed(review, viewedKey(file), value ? (hashes.get(fileKey(file)) ?? null) : null);
    setExpanded(file, !value);
  };
  const select = (file: DiffFile) => {
    const key = fileKey(file);
    setActive(key);
    setExpanded(file, true);
    const y = offsets.current.get(key);
    if (y !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }
  };

  useDiffKeys(root, (key) => {
    const at = files.findIndex((file) => fileKey(file) === active);
    const step = (by: number) => {
      const next =
        files[Math.min(files.length - 1, Math.max(0, (at < 0 ? (by > 0 ? -1 : files.length) : at) + by))];
      if (next) {
        select(next);
      }
    };
    switch (key) {
      case "j":
        step(1);
        return true;
      case "k":
        step(-1);
        return true;
      case "v": {
        const file = files[at < 0 ? 0 : at];
        if (file) {
          const value = !viewed.has(fileKey(file));
          markViewed(file, value);
          const next = value
            ? files.slice(at + 1).find((candidate) => !viewed.has(fileKey(candidate)))
            : null;
          if (next) {
            select(next);
          }
        }
        return true;
      }
      case "s":
        setView({ ...view, split: !view.split });
        return true;
      case "w":
        setView({ ...view, wrap: !view.wrap });
        return true;
      case "x":
        setView({ ...view, hideWhitespace: !view.hideWhitespace });
        return true;
      case "t":
        setTreeOpen((value) => !value);
        return true;
      default:
        return false;
    }
  });

  if (detail.isPending || diffs.isPending) {
    return (
      <Centered styles={styles}>
        <Text style={styles.muted}>Loading the changes…</Text>
      </Centered>
    );
  }
  if (detail.isError || diffs.isError) {
    return (
      <Centered styles={styles}>
        <Text style={styles.error}>{errorText(detail.error ?? diffs.error)}</Text>
        <View style={styles.row}>
          {scope.kind !== "mr" ? (
            <Button
              label="All changes"
              onPress={() => setScope({ kind: "mr" })}
              styles={styles}
              theme={theme}
            />
          ) : null}
          <Button
            label="Retry"
            onPress={() => {
              void detail.refetch();
              void diffs.refetch();
            }}
            styles={styles}
            theme={theme}
          />
        </View>
      </Centered>
    );
  }

  const data = detail.data;
  const refs = scopeRefs(scope);
  const headSha =
    scope.kind === "mr" ? data.diffRefs?.headSha : scope.kind === "compare" ? scope.to : scope.sha;
  const canComment = scope.kind === "mr" || refs !== null;
  const loadFile = (file: DiffFile) =>
    headSha && !file.deletedFile
      ? () =>
          readFileLines({ projectPath: target.projectPath, path: file.newPath, ref: headSha }).then(
            (result) => result.lines,
          )
      : undefined;
  const ask = async (selection: CodeSelection, body: string) => {
    const agent = preferredAgent(ui.workspaceId, agents.data);
    if (!agent) {
      throw new Error("There is no agent in this workspace to ask. Start one first.");
    }
    try {
      await paseo.agents.ref(agent.id).send(agentMessage(data, selection, body, "Question about"));
      toast.show(`Asked ${agent.title}`, { variant: "success" });
    } catch (error) {
      toast.error(errorText(error));
      throw error;
    }
  };
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <ProjectContext.Provider value={target.projectPath}>
      <View ref={root} style={{ flex: 1 }}>
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 4,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View style={[styles.row, { gap: 8 }]}>
            <IconButton
              icon={treeOpen ? "PanelLeftClose" : "PanelLeftOpen"}
              label={treeOpen ? "Hide the file tree" : "Show the file tree"}
              onPress={() => setTreeOpen((value) => !value)}
              theme={theme}
              styles={styles}
            />
            <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
              {data.title}
            </Text>
            <Button
              label={allPending.length > 0 ? `Your review · ${allPending.length}` : "Your review"}
              primary={allPending.length > 0}
              disabled={allPending.length === 0}
              onPress={() => setSubmitting(true)}
              styles={styles}
              theme={theme}
            />
          </View>
          <View style={[styles.row, { gap: 6, paddingLeft: 34 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose which changes to show"
              onPress={() => setPicking(true)}
              style={({ pressed }) => [styles.row, { gap: 2 }, pressed ? { opacity: 0.7 } : null]}
            >
              <Text style={[styles.small, { color: theme.colors.foreground, fontWeight: "600" }]}>
                {scope.kind === "mr" ? "All changes" : scope.label}
              </Text>
              <Icon name="ChevronDown" size={12} color={theme.colors.foregroundMuted} />
            </Pressable>
            <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
              {"  ·  "}
              {[
                shortReference(data.reference),
                `${data.sourceBranch} → ${data.targetBranch}`,
                `${files.length} files`,
              ].join("  ·  ")}
              {"  ·  "}
              <Text style={{ color: theme.colors.statusSuccess }}>+{additions}</Text>{" "}
              <Text style={{ color: theme.colors.statusDanger }}>−{deletions}</Text>
              {"  ·  "}
              {viewed.size}/{files.length} viewed
            </Text>
            <IconButton
              icon="SlidersHorizontal"
              label="Diff view options"
              onPress={() => setViewOptions(true)}
              active={Boolean(view.split || view.hideWhitespace)}
              theme={theme}
              styles={styles}
            />
            <IconButton
              icon="ArrowLeftRight"
              label="Show another merge request"
              onPress={onPickOther}
              theme={theme}
              styles={styles}
            />
            <IconButton
              icon="ExternalLink"
              label="Open the changes in GitLab"
              onPress={() => void openExternalUrl(`${data.webUrl}/diffs`)}
              theme={theme}
              styles={styles}
            />
          </View>
        </View>
        {since && scope.kind === "mr" ? (
          <View
            style={[
              styles.row,
              { gap: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: theme.colors.surface1 },
            ]}
          >
            <Icon name="GitCommitHorizontal" size={14} color={theme.colors.accent} />
            <Text style={[styles.small, { flex: 1 }]}>
              {since.pushes} new {since.pushes === 1 ? "push" : "pushes"} since your last review
            </Text>
            <Button
              label="Show only those"
              onPress={() =>
                setScope({ kind: "compare", from: since.from, to: since.to, label: "Since your last review" })
              }
              styles={styles}
              theme={theme}
            />
          </View>
        ) : null}
        {diffs.data.truncated ? (
          <Text style={[styles.small, { paddingHorizontal: 16, paddingTop: 6 }]}>
            GitLab cut this diff short; the rest is in GitLab.
          </Text>
        ) : null}
        <View style={{ flex: 1, flexDirection: "row" }}>
          {treeOpen ? (
            <>
              <FileBrowser
                files={files}
                active={active}
                onSelect={select}
                pendingByFile={pendingByFile}
                threadsByFile={threadsByFile}
                viewed={viewed}
                width={treeWidth}
                ui={ui}
              />
              <Splitter width={treeWidth} onChange={setTreeWidth} ui={ui} />
            </>
          ) : null}
          <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
            {files.length === 0 ? <Text style={styles.muted}>No file changes here.</Text> : null}
            {files.map((file) => {
              const key = fileKey(file);
              return (
                <View
                  key={`${scopeKey}:${key}`}
                  onLayout={(event) => offsets.current.set(key, event.nativeEvent.layout.y)}
                >
                  <FileDiff
                    file={file}
                    threads={threads}
                    changesUrl={`${data.webUrl}/diffs`}
                    canComment={canComment}
                    canSuggest={scope.kind === "mr" && data.canPush}
                    expanded={isExpanded(file)}
                    onToggle={() => setExpanded(file, !isExpanded(file))}
                    actions={actions}
                    handlers={{
                      stack: {
                        add: (selection, body) =>
                          addPendingComment(review, {
                            oldPath: selection.file.oldPath,
                            newPath: selection.file.newPath,
                            lines: selection.lines,
                            body,
                            ...(scope.kind === "mr" ? {} : { scope: scopeKey, ...(refs ? { refs } : {}) }),
                          }),
                        edit: (id, body) => editPendingComment(review, id, body),
                        remove: (id) => removePendingComments(review, [id]),
                        ask,
                      },
                    }}
                    pending={pending.filter(
                      (comment) => comment.oldPath === file.oldPath && comment.newPath === file.newPath,
                    )}
                    viewer={{ username: data.viewer, name: data.viewer }}
                    view={view}
                    viewed={{ value: viewed.has(key), onChange: (value) => markViewed(file, value) }}
                    loadFile={loadFile(file)}
                    ui={ui}
                  />
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
      <SubmitReview
        open={submitting}
        onClose={() => setSubmitting(false)}
        detail={data}
        comments={allPending}
        reviewId={review}
        workspaceId={ui.workspaceId}
        ownsBranch={ownsBranch}
        ui={ui}
      />
      <ScopePicker
        open={picking}
        onClose={() => setPicking(false)}
        target={target}
        scope={scope}
        onPick={setScope}
        since={since}
        ui={ui}
      />
      <ViewOptions
        open={viewOptions}
        onClose={() => setViewOptions(false)}
        view={view}
        onChange={setView}
        ui={ui}
      />
    </ProjectContext.Provider>
  );
}

/**
 * An MR's changes in the workspace's main area, next to its agents: a file tree
 * on the left, every file's diff on the right, and comments collected into a
 * review that is then sent to one of your agents or published to GitLab.
 */
export function DiffPanel({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme);
  const readStatus = useRpc(authStatusRpc);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => readStatus({}), staleTime: 5 * 60_000 });
  const target = useDiffTarget(workspaceId);
  const [picking, setPicking] = useState(false);
  const host = status.data?.connected ? status.data.host : "";
  const ui: Ui = { theme, styles, host, workspaceId };

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
  } else if (!target) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.text}>Pick a merge request to review its changes here.</Text>
        <Button
          label="Choose a merge request"
          primary
          onPress={() => setPicking(true)}
          styles={styles}
          theme={theme}
        />
      </Centered>
    );
  } else {
    body = (
      <ReviewDiff
        key={`${target.projectPath}:${target.iid}`}
        target={target}
        ui={ui}
        onPickOther={() => setPicking(true)}
      />
    );
  }

  return (
    <HostContext.Provider value={host}>
      <View style={styles.screen}>{body}</View>
      <MergeRequestPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(ref) => setDiffTarget(workspaceId, ref)}
        ui={ui}
      />
    </HostContext.Provider>
  );
}
