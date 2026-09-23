import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, ScrollView as NativeScrollView, Text, View } from "react-native";
import { authStatusRpc, detailRpc, diffsRpc, listsRpc, type DiffFile, type ItemRef } from "../../shared/contract";
import { setDiffTarget, useDiffTarget } from "../diff-target";
import { addPendingComment, editPendingComment, removePendingComments, reviewKey, usePendingComments } from "../review-store";
import { diffsKey, FileDiff, fileKey } from "./changes";
import { Button, Centered, errorText, HostContext, IconButton } from "./common";
import { ProjectContext } from "./composer-tools";
import { useNoteActions, type Ui } from "./detail";
import { shortReference } from "./format";
import { detailKey, LISTS_KEY, STATUS_KEY } from "./queries";
import { SubmitReview } from "./submit-review";
import { buildTree, type TreeNode } from "./tree";
import { useStyles, type Styles } from "./styles";

const MONO = Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "Menlo" });
const TREE_WIDTH = { initial: 300, min: 180, max: 640 };
const TREE_WIDTH_KEY = "paseo-gitlab:tree-width";
const DETAIL_REFRESH_MS = 30_000;
const WRAP_KEY = "paseo-gitlab:wrap-lines";

function storedTreeWidth(): number {
  const raw = Number(globalThis.localStorage?.getItem(TREE_WIDTH_KEY));
  return Number.isFinite(raw) && raw >= TREE_WIDTH.min && raw <= TREE_WIDTH.max ? raw : TREE_WIDTH.initial;
}

/** A thin handle between the tree and the diff; drag it to make the tree wider or narrower. */
function Splitter({ width, onChange, ui }: { width: number; onChange: (width: number) => void; ui: Ui }) {
  const start = useRef(width);
  const [dragging, setDragging] = useState(false);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = width;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) =>
          onChange(Math.min(TREE_WIDTH.max, Math.max(TREE_WIDTH.min, start.current + gesture.dx))),
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [width, onChange],
  );
  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Resize the file tree"
      style={[
        { width: 6, marginLeft: -3, marginRight: -3, zIndex: 2 },
        Platform.OS === "web" ? ({ cursor: "col-resize" } as object) : null,
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

/** The changed files, as GitLab's file browser shows them: a folder tree or a flat list, with a filter. */
function FileBrowser({ files, active, onSelect, pendingByFile, threadsByFile, width, ui }: {
  files: DiffFile[];
  width: number;
  active: string | null;
  onSelect: (file: DiffFile) => void;
  pendingByFile: Map<string, number>;
  threadsByFile: Map<string, number>;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const [asTree, setAsTree] = useState(true);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const shown = filter.trim()
    ? files.filter((file) => file.newPath.toLowerCase().includes(filter.trim().toLowerCase()))
    : files;
  const tree = useMemo(() => buildTree(shown), [shown]);

  const fileRow = (file: DiffFile, label: string, depth: number) => {
    const key = fileKey(file);
    const selected = key === active;
    const notes = (pendingByFile.get(key) ?? 0) + (threadsByFile.get(key) ?? 0);
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
            file.deletedFile ? { textDecorationLine: "line-through", color: theme.colors.foregroundMuted } : null,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {notes > 0 ? <Text style={styles.small}>💬{notes}</Text> : null}
        <Counts file={file} styles={styles} ui={ui} />
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

  return (
    <View style={{ width }}>
      <View style={{ padding: 10, gap: 8 }}>
        <View style={styles.row}>
          <Text style={[styles.text, { fontWeight: "600", flex: 1 }]}>Files {files.length}</Text>
          <View style={styles.tabs}>
            {[
              { id: false, icon: "List", label: "Show as a list" },
              { id: true, icon: "FolderTree", label: "Show as a tree" },
            ].map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="tab"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: asTree === option.id }}
                onPress={() => setAsTree(option.id)}
                style={[styles.tab, { paddingHorizontal: 8 }, asTree === option.id ? styles.tabActive : null]}
              >
                <Text style={styles.small}>{option.id ? "Tree" : "List"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter files…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.input, { minHeight: 0, paddingVertical: 6 }]}
        />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 16 }}>
        {asTree ? tree.map((entry) => node(entry, 0)) : shown.map((file) => fileRow(file, file.newPath, 0))}
      </ScrollView>
    </View>
  );
}

function MergeRequestPicker({ open, onClose, onPick, ui }: {
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

function ReviewDiff({ target, ui, onPickOther }: { target: ItemRef; ui: Ui; onPickOther: () => void }) {
  const { styles, theme } = ui;
  const readDetail = useRpc(detailRpc);
  const readDiffs = useRpc(diffsRpc);
  // Refreshed so a reviewer's new comments show up under their lines without reopening.
  const detail = useQuery({
    queryKey: detailKey(target),
    queryFn: () => readDetail(target),
    refetchInterval: DETAIL_REFRESH_MS,
  });
  const diffs = useQuery({
    queryKey: diffsKey(target),
    queryFn: () => readDiffs({ projectPath: target.projectPath, iid: target.iid }),
  });
  const actions = useNoteActions(target, detail.data);
  const review = reviewKey(target);
  const pending = usePendingComments(review);
  const [treeOpen, setTreeOpen] = useState(true);
  const [wrap, setWrapState] = useState(() => globalThis.localStorage?.getItem(WRAP_KEY) === "true");
  const toggleWrap = () =>
    setWrapState((current) => {
      try {
        globalThis.localStorage?.setItem(WRAP_KEY, String(!current));
      } catch {
        // No storage: the choice lasts until the window closes.
      }
      return !current;
    });
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const scroll = useRef<NativeScrollView | null>(null);
  const offsets = useRef(new Map<string, number>());

  const files = diffs.data?.files ?? [];
  const pendingByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of pending) {
      const key = `${comment.oldPath}\0${comment.newPath}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [pending]);
  const threadsByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) {
      const count = (detail.data?.discussions ?? []).filter((discussion) => {
        const path = discussion.notes[0]?.position?.path;
        return path === file.newPath || path === file.oldPath;
      }).length;
      if (count) {
        counts.set(fileKey(file), count);
      }
    }
    return counts;
  }, [files, detail.data]);

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
        <Button
          label="Retry"
          onPress={() => {
            void detail.refetch();
            void diffs.refetch();
          }}
          styles={styles}
          theme={theme}
        />
      </Centered>
    );
  }

  const data = detail.data;
  const select = (file: DiffFile) => {
    const key = fileKey(file);
    setActive(key);
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    const y = offsets.current.get(key);
    if (y !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }
  };

  return (
    <ProjectContext.Provider value={target.projectPath}>
      <View style={{ flex: 1 }}>
        <View
          style={[
            styles.row,
            {
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              gap: 10,
              flexWrap: "wrap",
            },
          ]}
        >
          <IconButton
            icon={treeOpen ? "PanelLeftClose" : "PanelLeftOpen"}
            label={treeOpen ? "Hide the file tree" : "Show the file tree"}
            onPress={() => setTreeOpen((value) => !value)}
            theme={theme}
            styles={styles}
          />
          <Text style={styles.muted}>{shortReference(data.reference)}</Text>
          <Text style={[styles.title, { flex: 1, minWidth: 200 }]} numberOfLines={1}>
            {data.title}
          </Text>
          <Text style={[styles.small, { fontFamily: MONO, flexShrink: 1 }]} numberOfLines={1}>
            {data.sourceBranch} → {data.targetBranch}
          </Text>
          <Button
            label={wrap ? "Wrap lines ✓" : "Wrap lines"}
            onPress={toggleWrap}
            styles={styles}
            theme={theme}
          />
          <Button label="Other MR" onPress={onPickOther} styles={styles} theme={theme} />
          <IconButton
            icon="ExternalLink"
            label="Open the changes in GitLab"
            onPress={() => void openExternalUrl(`${data.webUrl}/diffs`)}
            theme={theme}
            styles={styles}
          />
          <Button
            label={pending.length > 0 ? `Your review · ${pending.length}` : "Your review"}
            primary={pending.length > 0}
            disabled={pending.length === 0}
            onPress={() => setSubmitting(true)}
            styles={styles}
            theme={theme}
          />
        </View>
        <View style={{ flex: 1, flexDirection: "row" }}>
          {treeOpen ? (
            <>
              <FileBrowser
                files={files}
                active={active}
                onSelect={select}
                pendingByFile={pendingByFile}
                threadsByFile={threadsByFile}
                width={treeWidth}
                ui={ui}
              />
              <Splitter width={treeWidth} onChange={setTreeWidth} ui={ui} />
            </>
          ) : null}
          <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={styles.small}>
              Click a line to comment, then another to select a range. Comments collect in your review until you submit it.
            </Text>
            {files.map((file) => {
              const key = fileKey(file);
              return (
                <View key={key} onLayout={(event) => offsets.current.set(key, event.nativeEvent.layout.y)}>
                  <FileDiff
                    file={file}
                    detail={data}
                    expanded={!collapsed.has(key)}
                    onToggle={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(key)) {
                          next.delete(key);
                        } else {
                          next.add(key);
                        }
                        return next;
                      })
                    }
                    actions={actions}
                    handlers={{
                      stack: {
                        add: (selection, body) =>
                          addPendingComment(review, {
                            oldPath: selection.file.oldPath,
                            newPath: selection.file.newPath,
                            lines: selection.lines,
                            body,
                          }),
                        edit: (id, body) => editPendingComment(review, id, body),
                        remove: (id) => removePendingComments(review, [id]),
                      },
                    }}
                    pending={pending.filter((comment) => comment.oldPath === file.oldPath && comment.newPath === file.newPath)}
                    viewer={{ username: data.viewer, name: data.viewer }}
                    wrap={wrap}
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
        comments={pending}
        reviewId={review}
        workspaceId={ui.workspaceId}
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
        <Button label="Choose a merge request" primary onPress={() => setPicking(true)} styles={styles} theme={theme} />
      </Centered>
    );
  } else {
    body = <ReviewDiff key={`${target.projectPath}:${target.iid}`} target={target} ui={ui} onPickOther={() => setPicking(true)} />;
  }

  return (
    <HostContext.Provider value={host}>
      <View style={styles.screen}>{body}</View>
      <MergeRequestPicker open={picking} onClose={() => setPicking(false)} onPick={(ref) => setDiffTarget(workspaceId, ref)} ui={ui} />
    </HostContext.Provider>
  );
}
