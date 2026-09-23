import { openExternalUrl } from "@getpaseo/plugin/client";
import { useRpc } from "../account";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { Fragment, useEffect, useMemo, useState } from "react";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import {
  addCodeCommentRpc,
  detailRpc,
  diffsRpc,
  fileLinesRpc,
  type DiffFile,
  type DiffLine,
  type Discussion,
  type ItemRef,
} from "../../shared/contract";
import type { PendingComment } from "../review-store";
import { endsAt } from "../review-store";
import { Avatar, Badge, Button, Centered, errorText, IconButton } from "./common";
import { ProjectContext } from "./composer-tools";
import {
  Composer,
  Thread,
  useNoteActions,
  useWrite,
  type ComposerAction,
  type NoteActions,
  type Ui,
} from "./detail";
import { lineNumber, rangeLabel, suggestionFor, type CodeSelection } from "./code-comment";
import { highlightLine, languageOf, tokenPalette, type HighlightState, type Token } from "./highlight";
import { hideWhitespace, splitRows, TAIL, withContext, type ShownLine } from "./diff-view";
import { detailKey } from "./queries";
import { draftsKey, ReviewBar } from "./review";

const MONO = Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "Menlo" });

/**
 * Keeps a code line's indentation and breaks it inside the text when it is too
 * wide. Normal wrapping breaks at the indentation's last space, which leaves the
 * line number alone on one row and the code on the next.
 */
const CODE_WRAP =
  Platform.OS === "web" ? ({ whiteSpace: "pre-wrap", wordBreak: "break-all" } as object) : null;
/** The default, as in GitLab and editors: a line keeps its length and the file scrolls sideways. */
const CODE_NOWRAP = Platform.OS === "web" ? ({ whiteSpace: "pre" } as object) : null;
/** Keeps threads and comment boxes in view while the code under them scrolls sideways. */
const PIN_LEFT = Platform.OS === "web" ? ({ position: "sticky", left: 0 } as object) : null;

export function diffsKey(ref: ItemRef) {
  return ["gitlab", "diffs", ref.projectPath, ref.iid] as const;
}

export function fileKey(file: DiffFile): string {
  return `${file.oldPath}\0${file.newPath}`;
}

function inFile(discussion: Discussion, file: DiffFile): boolean {
  const path = discussion.notes[0]?.position?.path;
  return path === file.newPath || path === file.oldPath;
}

/** GitLab anchors a comment on a removed line by its old number, on anything else by its new one. */
function anchoredAt(discussion: Discussion, line: DiffLine): boolean {
  const position = discussion.notes[0]?.position;
  if (!position || line.kind === "hunk") {
    return false;
  }
  if (position.newLine != null) {
    return line.kind !== "removed" && line.newLine === position.newLine;
  }
  return line.kind !== "added" && line.oldLine === position.oldLine;
}

function LineRow({
  line,
  tokens,
  onPress,
  selected,
  wrap,
  side,
  ui,
}: {
  line: ShownLine;
  tokens: Token[];
  wrap: boolean;
  /** Side by side: which half this is, so only its line number shows. */
  side?: "old" | "new";
  onPress?: () => void;
  selected: boolean;
  ui: Ui;
}) {
  const palette = tokenPalette(ui.theme.colors.surface0);
  const { theme } = ui;
  const tint =
    line.kind === "added"
      ? theme.colors.statusSuccess
      : line.kind === "removed"
        ? theme.colors.statusDanger
        : null;
  const cell = { fontFamily: MONO, fontSize: 11, lineHeight: 17 };
  const number = { ...cell, width: 38, color: theme.colors.foregroundMuted, textAlign: "right" as const };
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Select line ${lineNumber(line)}` : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        { flexDirection: "row", position: "relative" },
        side ? { flex: 1 } : null,
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      {tint ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: tint,
            opacity: 0.14,
          }}
        />
      ) : null}
      {selected ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: theme.colors.accent,
            opacity: 0.22,
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.accent,
          }}
        />
      ) : null}
      {side !== "new" ? <Text style={number}>{line.oldLine ?? ""}</Text> : null}
      {side !== "old" ? <Text style={number}>{line.newLine ?? ""}</Text> : null}
      <Text style={{ ...cell, width: 16, textAlign: "center", color: theme.colors.foregroundMuted }}>
        {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
      </Text>
      <Text
        selectable
        style={[
          { ...cell, color: theme.colors.foreground, paddingRight: 8 },
          wrap ? [{ flex: 1 }, CODE_WRAP] : [{ flexGrow: 1, flexShrink: 0 }, CODE_NOWRAP],
        ]}
      >
        {line.text
          ? tokens.map((token, index) =>
              palette[token.kind] ? (
                <Text
                  key={index}
                  style={{
                    color: palette[token.kind]!,
                    fontStyle: token.kind === "comment" ? "italic" : "normal",
                  }}
                >
                  {token.text}
                </Text>
              ) : (
                token.text
              ),
            )
          : " "}
      </Text>
    </Pressable>
  );
}

/** A hunk header, and the way to see the unchanged lines it skips. */
function HunkRow({
  line,
  onExpand,
  busy,
  ui,
}: {
  line: ShownLine;
  onExpand?: () => void;
  busy: boolean;
  ui: Ui;
}) {
  const { theme } = ui;
  if (!onExpand && !line.text) {
    return null;
  }
  const cell = { fontFamily: MONO, fontSize: 11, lineHeight: 17 };
  const label =
    line.gap === TAIL
      ? line.gapSize
        ? `Show ${line.gapSize} more lines`
        : "Show the rest of the file"
      : `Show ${line.gapSize} hidden lines`;
  return (
    <Pressable
      accessibilityRole={onExpand ? "button" : undefined}
      accessibilityLabel={onExpand ? label : undefined}
      onPress={onExpand}
      disabled={!onExpand || busy}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 8,
          backgroundColor: theme.colors.surface2,
        },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      {onExpand ? (
        <>
          <Icon
            name={line.gap === TAIL ? "ChevronsDown" : "ChevronsUpDown"}
            size={12}
            color={theme.colors.accent}
          />
          <Text style={{ ...cell, color: theme.colors.accent }}>{busy ? "Loading…" : label}</Text>
        </>
      ) : null}
      {line.text ? (
        <Text style={{ ...cell, flex: 1, color: theme.colors.foregroundMuted }} numberOfLines={1}>
          {line.text}
        </Text>
      ) : null}
    </Pressable>
  );
}

export interface CommentHandlers {
  /** Sidebar: comments go straight to GitLab, at once or into the review kept there. */
  toGitLab?: (selection: CodeSelection, body: string, asDraft: boolean) => Promise<unknown>;
  /** Main area: comments pile up locally until the review is submitted, to an agent or to GitLab. */
  stack?: {
    add: (selection: CodeSelection, body: string) => void;
    edit: (id: string, body: string) => void;
    remove: (id: string) => void;
    /** A question about the lines, sent to your agent now instead of waiting in the review. */
    ask?: (selection: CodeSelection, body: string) => Promise<void>;
  };
}

/** How the diff is laid out; the main area lets you change it, the sidebar uses the defaults. */
export interface DiffView {
  wrap?: boolean;
  split?: boolean;
  hideWhitespace?: boolean;
}

/** A comment waiting in your review, shown under the line it ends on, like GitLab's pending notes. */
function PendingNote({
  comment,
  viewer,
  onEdit,
  onRemove,
  ui,
}: {
  comment: PendingComment;
  viewer: { username: string; name: string } | null;
  onEdit: (body: string) => void;
  onRemove: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const [editing, setEditing] = useState(false);
  return (
    <View
      style={{
        margin: 8,
        padding: 10,
        gap: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.statusWarning,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={styles.row}>
        <Avatar person={viewer ? { ...viewer } : null} styles={styles} size={20} />
        <Text style={styles.noteAuthor}>{viewer?.name ?? "You"}</Text>
        <Badge label="Pending" styles={styles} color={theme.colors.statusWarning} />
        <View style={styles.spacer} />
        {!editing ? (
          <>
            <IconButton
              icon="Pencil"
              label="Edit the comment"
              onPress={() => setEditing(true)}
              theme={theme}
              styles={styles}
            />
            <IconButton
              icon="Trash2"
              label="Remove the comment"
              onPress={onRemove}
              theme={theme}
              styles={styles}
            />
          </>
        ) : null}
      </View>
      {editing ? (
        <Composer
          placeholder="Edit the comment…"
          sendLabel="Save"
          initialValue={comment.body}
          autoFocus
          onSend={async (body) => {
            onEdit(body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          ui={ui}
        />
      ) : (
        <Text style={styles.text}>{comment.body}</Text>
      )}
    </View>
  );
}

function ViewedBox({
  checked,
  onChange,
  ui,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel="Viewed"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      hitSlop={6}
      style={[styles.row, { gap: 4 }]}
    >
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          borderWidth: 1.5,
          alignItems: "center",
          justifyContent: "center",
          borderColor: checked ? theme.colors.accent : theme.colors.foregroundMuted,
          backgroundColor: checked ? theme.colors.accent : "transparent",
        }}
      >
        {checked ? <Icon name="Check" size={10} color={theme.colors.accentForeground} /> : null}
      </View>
      <Text style={styles.small}>Viewed</Text>
    </Pressable>
  );
}

export function FileDiff({
  file,
  threads: allThreads = [],
  changesUrl,
  canComment,
  canSuggest,
  expanded,
  onToggle,
  actions,
  handlers,
  pending = [],
  viewer = null,
  view = {},
  viewed,
  loadFile,
  ui,
}: {
  file: DiffFile;
  /** The MR's threads; the ones on this file are shown under their lines. */
  threads?: Discussion[];
  /** Where GitLab shows these changes, for a file too large to show here. */
  changesUrl: string;
  canComment: boolean;
  /** Whether "Suggest change" is offered: you can push to the source branch. */
  canSuggest: boolean;
  expanded: boolean;
  onToggle: () => void;
  actions?: NoteActions;
  handlers?: CommentHandlers;
  /** This file's comments waiting in your local review. */
  pending?: PendingComment[];
  viewer?: { username: string; name: string; avatarUrl?: string | null } | null;
  view?: DiffView;
  viewed?: { value: boolean; onChange: (value: boolean) => void };
  /** The whole file at the diff's head, to show the unchanged lines around the hunks. */
  loadFile?: () => Promise<string[] | null>;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const toast = useToast();
  // Indexes into the shown lines; the first click anchors, the next one in the same file stretches it.
  const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [openGaps, setOpenGaps] = useState<ReadonlySet<number>>(() => new Set());
  const [fileLines, setFileLines] = useState<string[] | null>(null);
  const [noFile, setNoFile] = useState(false);
  const [loadingGap, setLoadingGap] = useState<number | null>(null);
  const expandable = Boolean(loadFile) && !noFile;
  const wrap = Boolean(view.wrap || view.split);
  const lines: ShownLine[] = useMemo(() => {
    const withGaps = expandable ? withContext(file, fileLines, openGaps) : file.lines;
    return view.hideWhitespace ? hideWhitespace(withGaps) : withGaps;
  }, [file, fileLines, openGaps, expandable, view.hideWhitespace]);
  useEffect(() => setSelection(null), [view.hideWhitespace]);

  const threads = actions ? allThreads.filter((discussion) => inFile(discussion, file)) : [];
  const placed = new Set<string>();
  const title = file.renamedFile ? `${file.oldPath} → ${file.newPath}` : file.newPath;
  const [visibleWidth, setVisibleWidth] = useState(0);
  // What sits between code lines takes the visible width and stays put while the code scrolls.
  const pinned = wrap ? null : [{ width: visibleWidth || undefined }, PIN_LEFT];
  // Highlighted once per file; a hunk header resets the carried block-comment state.
  const highlighted = useMemo(() => {
    const language = languageOf(file.newPath);
    let state: HighlightState = { inBlock: false };
    return lines.map((line) => {
      if (line.kind === "hunk") {
        state = { inBlock: false };
        return [];
      }
      const result = highlightLine(line.text, language, state);
      state = result.state;
      return result.tokens;
    });
  }, [lines, file.newPath]);
  const commentable = canComment && Boolean(handlers);
  const low = selection ? Math.min(selection.anchor, selection.focus) : -1;
  const high = selection ? Math.max(selection.anchor, selection.focus) : -1;
  const selectedLines = selection
    ? lines.slice(low, high + 1).filter((line) => line.kind !== "hunk" && !(line as ShownLine).folded)
    : [];

  const pick = (index: number) =>
    setSelection((current) =>
      current && current.anchor !== index
        ? { anchor: current.anchor, focus: index }
        : { anchor: index, focus: index },
    );

  const expand = async (gap: number) => {
    if (!loadFile) {
      return;
    }
    if (!fileLines) {
      setLoadingGap(gap);
      try {
        const loaded = await loadFile();
        if (!loaded) {
          setNoFile(true);
          toast.show("This file is binary or too large to expand here.");
          return;
        }
        setFileLines(loaded);
      } catch (error) {
        toast.error(errorText(error));
        return;
      } finally {
        setLoadingGap(null);
      }
    }
    setSelection(null);
    setOpenGaps((current) => new Set(current).add(gap));
  };

  const composerActions = (): { primary: ComposerAction; others: ComposerAction[] } => {
    const current: CodeSelection = { file, lines: selectedLines };
    const done = () => setSelection(null);
    if (handlers?.stack) {
      const stack = handlers.stack;
      const ask = stack.ask;
      return {
        primary: {
          label: "Add to review",
          onSend: async (body) => {
            stack.add(current, body);
            done();
          },
        },
        others: ask
          ? [
              {
                label: "Ask agent now",
                onSend: async (body) => {
                  await ask(current, body);
                  done();
                },
              },
            ]
          : [],
      };
    }
    const gitlab = (asDraft: boolean) => async (body: string) => {
      await handlers?.toGitLab?.(current, body, asDraft);
      done();
    };
    return {
      primary: { label: "Comment", onSend: gitlab(false) },
      others: [{ label: "Add to review", onSend: gitlab(true) }],
    };
  };

  const lineRow = (index: number, side?: "old" | "new") => {
    const line = lines[index]!;
    if (line.kind === "hunk") {
      const gap = line.gap;
      return (
        <HunkRow
          line={line}
          busy={loadingGap !== null && loadingGap === gap}
          onExpand={expandable && gap !== undefined ? () => void expand(gap) : undefined}
          ui={ui}
        />
      );
    }
    return (
      <LineRow
        line={line}
        wrap={wrap}
        side={side}
        tokens={highlighted[index] ?? []}
        selected={index >= low && index <= high && !line.folded}
        onPress={commentable && !line.folded ? () => pick(index) : undefined}
        ui={ui}
      />
    );
  };

  // Threads, pending comments and the open composer that belong under a line.
  const below = (index: number) => {
    const line = lines[index]!;
    const here = threads.filter((discussion) => anchoredAt(discussion, line));
    here.forEach((discussion) => placed.add(discussion.id));
    const waiting = handlers?.stack ? pending.filter((comment) => endsAt(comment, line)) : [];
    const { primary, others } = index === high ? composerActions() : { primary: null, others: [] };
    return (
      <>
        {actions
          ? here.map((discussion) => (
              <View key={discussion.id} style={[{ padding: 8 }, pinned]}>
                <Thread discussion={discussion} actions={actions} ui={ui} />
              </View>
            ))
          : null}
        {waiting.map((comment) => (
          <View key={comment.id} style={pinned}>
            <PendingNote
              comment={comment}
              viewer={viewer}
              onEdit={(body) => handlers!.stack!.edit(comment.id, body)}
              onRemove={() => handlers!.stack!.remove(comment.id)}
              ui={ui}
            />
          </View>
        ))}
        {primary && selectedLines.length > 0 ? (
          <View style={[{ padding: 8, gap: 6 }, pinned]}>
            <Text style={styles.small}>
              Comment on {rangeLabel(selectedLines)} · click another line to select a range
            </Text>
            <Composer
              key={`${low}-${high}`}
              placeholder="Write a comment…"
              sendLabel={primary.label}
              autoFocus
              onSend={primary.onSend}
              others={others}
              templates={
                canSuggest && selectedLines.some((line) => line.kind !== "removed")
                  ? [{ label: "Suggest change", text: suggestionFor(selectedLines) }]
                  : []
              }
              onCancel={() => setSelection(null)}
              ui={ui}
            />
          </View>
        ) : null}
      </>
    );
  };

  const blank = <View style={{ flex: 1, minHeight: 17, backgroundColor: theme.colors.surface1 }} />;
  const body = view.split
    ? splitRows(lines).map((row, at) =>
        "full" in row ? (
          <Fragment key={at}>
            {lineRow(row.full)}
            {below(row.full)}
          </Fragment>
        ) : (
          <Fragment key={at}>
            <View style={{ flexDirection: "row" }}>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  borderRightWidth: 1,
                  borderRightColor: theme.colors.border,
                }}
              >
                {row.left !== null ? lineRow(row.left, "old") : blank}
              </View>
              <View style={{ flex: 1, flexDirection: "row" }}>
                {row.right !== null ? lineRow(row.right, "new") : blank}
              </View>
            </View>
            {row.left !== null ? below(row.left) : null}
            {row.right !== null && row.right !== row.left ? below(row.right) : null}
          </Fragment>
        ),
      )
    : lines.map((_line, index) => (
        <Fragment key={index}>
          {lineRow(index)}
          {below(index)}
        </Fragment>
      ));

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.listRow, styles.row, pressed ? styles.listRowPressed : null]}
      >
        <Text style={styles.small}>{expanded ? "▾" : "▸"}</Text>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <Text
            style={[styles.text, { fontFamily: MONO, fontSize: 12, fontWeight: "600", flexShrink: 0 }]}
            numberOfLines={1}
          >
            {title.split("/").pop()}
          </Text>
          <Text style={[styles.small, { fontFamily: MONO, flexShrink: 1 }]} numberOfLines={1}>
            {file.renamedFile ? `${file.oldPath} →` : title.split("/").slice(0, -1).join("/")}
          </Text>
        </View>
        {file.newFile ? <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>new</Text> : null}
        {file.deletedFile ? (
          <Text style={[styles.small, { color: theme.colors.statusDanger }]}>deleted</Text>
        ) : null}
        {threads.length > 0 ? <Text style={styles.small}>💬 {threads.length}</Text> : null}
        <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>+{file.additions}</Text>
        <Text style={[styles.small, { color: theme.colors.statusDanger }]}>−{file.deletions}</Text>
        {viewed ? <ViewedBox checked={viewed.value} onChange={viewed.onChange} ui={ui} /> : null}
      </Pressable>
      {expanded ? (
        <>
          <View style={styles.divider} />
          {file.truncated ? (
            <View style={styles.cardBody}>
              <Text style={styles.muted}>This diff is too large to show here.</Text>
              <Button
                label="Open the changes in GitLab"
                onPress={() => void openExternalUrl(changesUrl)}
                styles={styles}
                theme={theme}
              />
            </View>
          ) : (
            <ScrollView
              horizontal={!wrap}
              scrollEnabled={!wrap}
              onLayout={(event) => setVisibleWidth(event.nativeEvent.layout.width)}
            >
              <View
                style={{
                  paddingVertical: 4,
                  minWidth: wrap ? undefined : visibleWidth || undefined,
                  flex: wrap ? 1 : undefined,
                }}
              >
                {body}
                {actions
                  ? threads
                      .filter((discussion) => !placed.has(discussion.id))
                      .map((discussion) => (
                        // Anchored to a line outside the shown hunks, or to an older version of the file.
                        <View key={discussion.id} style={[{ padding: 8, gap: 4 }, pinned]}>
                          <Text style={styles.small}>On a line not in this diff</Text>
                          <Thread discussion={discussion} actions={actions} ui={ui} />
                        </View>
                      ))
                  : null}
              </View>
            </ScrollView>
          )}
        </>
      ) : null}
    </View>
  );
}

export function ChangesView({
  itemRef,
  focusPath,
  onBack,
  onOpenWide,
  header,
  ui,
}: {
  itemRef: ItemRef;
  focusPath?: string;
  onBack?: () => void;
  /** Opens the same changes in the main area; shown only in the sidebar. */
  onOpenWide?: () => void;
  /** Replaces the default back-and-title row, for the main-area panel. */
  header?: React.ReactNode;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readDetail = useRpc(detailRpc);
  const readDiffs = useRpc(diffsRpc);
  const addCodeComment = useRpc(addCodeCommentRpc);
  const readFileLines = useRpc(fileLinesRpc);
  const queryClient = useQueryClient();
  const write = useWrite(itemRef);
  const detail = useQuery({ queryKey: detailKey(itemRef), queryFn: () => readDetail(itemRef) });
  const diffs = useQuery({
    queryKey: diffsKey(itemRef),
    queryFn: () => readDiffs({ projectPath: itemRef.projectPath, iid: itemRef.iid }),
  });
  const actions = useNoteActions(itemRef, detail.data);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const files = diffs.data?.files ?? [];
  // Open the file a thread pointed at, or everything when the MR is small.
  const initiallyOpen = useMemo(() => {
    if (focusPath) {
      return new Set(
        files.filter((file) => file.newPath === focusPath || file.oldPath === focusPath).map(fileKey),
      );
    }
    return files.length <= 3 ? new Set(files.map(fileKey)) : new Set<string>();
  }, [files, focusPath]);
  const isOpen = (file: DiffFile) => expanded.has(fileKey(file)) !== initiallyOpen.has(fileKey(file));

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
          {onBack ? <Button label="Back" onPress={onBack} styles={styles} theme={theme} /> : null}
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

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const data = detail.data;

  const handlers: CommentHandlers = {
    toGitLab: (selection, body, asDraft) => {
      const diffRefs = data.diffRefs;
      const first = selection.lines[0];
      const last = selection.lines[selection.lines.length - 1];
      if (!diffRefs || !first || !last) {
        return Promise.reject(new Error("GitLab did not report the commits this MR compares."));
      }
      const pick = ({ kind, oldLine, newLine, oldPos, newPos }: DiffLine) => ({
        kind,
        oldLine,
        newLine,
        oldPos,
        newPos,
      });
      return write(async () => {
        await addCodeComment({
          projectPath: itemRef.projectPath,
          iid: itemRef.iid,
          body,
          diffRefs,
          oldPath: selection.file.oldPath,
          newPath: selection.file.newPath,
          start: pick(first),
          end: pick(last),
          asDraft,
        });
        if (asDraft) {
          await queryClient.invalidateQueries({ queryKey: draftsKey(itemRef.projectPath, itemRef.iid) });
        }
      });
    },
  };

  const headSha = data.diffRefs?.headSha;
  const loadFile = (file: DiffFile) =>
    headSha && !file.deletedFile
      ? () =>
          readFileLines({ projectPath: itemRef.projectPath, path: file.newPath, ref: headSha }).then(
            (result) => result.lines,
          )
      : undefined;

  const refresh = () => {
    void detail.refetch();
    void diffs.refetch();
  };

  return (
    <ProjectContext.Provider value={itemRef.projectPath}>
      <View style={{ gap: 12 }}>
        {header ?? (
          <View style={styles.row}>
            {onBack ? (
              <IconButton icon="ChevronLeft" label="Back" onPress={onBack} theme={theme} styles={styles} />
            ) : null}
            <Text style={styles.muted} numberOfLines={1}>
              {data.reference} · {files.length} files
            </Text>
            <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>+{additions}</Text>
            <Text style={[styles.small, { color: theme.colors.statusDanger }]}>−{deletions}</Text>
            <View style={styles.spacer} />
            {onOpenWide ? (
              <IconButton
                icon="Maximize2"
                label="Open in the main area"
                onPress={onOpenWide}
                theme={theme}
                styles={styles}
              />
            ) : null}
            <IconButton
              icon="RefreshCw"
              label="Refresh"
              onPress={refresh}
              disabled={detail.isFetching || diffs.isFetching}
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
        )}
        <ReviewBar detail={data} write={write} ui={ui} />
        <Text style={styles.small}>
          {files.length} files · +{additions} −{deletions} · click a line to comment, then another to select a
          range
        </Text>
        {diffs.data.truncated ? <Text style={styles.small}>Only the first 500 files are shown.</Text> : null}
        {files.map((file) => (
          <FileDiff
            key={fileKey(file)}
            file={file}
            threads={data.discussions}
            changesUrl={`${data.webUrl}/diffs`}
            canComment={data.canComment && data.diffRefs != null}
            canSuggest={data.canPush}
            loadFile={loadFile(file)}
            expanded={isOpen(file)}
            onToggle={() =>
              setExpanded((current) => {
                const next = new Set(current);
                const key = fileKey(file);
                if (next.has(key)) {
                  next.delete(key);
                } else {
                  next.add(key);
                }
                return next;
              })
            }
            actions={actions}
            handlers={handlers}
            ui={ui}
          />
        ))}
      </View>
    </ProjectContext.Provider>
  );
}
