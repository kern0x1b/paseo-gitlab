import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { Fragment, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  addCodeCommentRpc,
  detailRpc,
  diffsRpc,
  type Detail,
  type DiffFile,
  type DiffLine,
  type Discussion,
  type ItemRef,
} from "../../shared/contract";
import type { PendingComment } from "../review-store";
import { endsAt } from "../review-store";
import { Avatar, Badge, Button, Centered, errorText, IconButton } from "./common";
import { ProjectContext } from "./composer-tools";
import { Composer, Thread, useNoteActions, useWrite, type ComposerAction, type NoteActions, type Ui } from "./detail";
import { lineNumber, rangeLabel, suggestionFor, type CodeSelection } from "./code-comment";
import { highlightLine, languageOf, tokenPalette, type HighlightState, type Token } from "./highlight";
import { detailKey } from "./queries";
import { draftsKey, ReviewBar } from "./review";

const MONO = Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "Menlo" });

/**
 * Keeps a code line's indentation and breaks it inside the text when it is too
 * wide. Normal wrapping breaks at the indentation's last space, which leaves the
 * line number alone on one row and the code on the next.
 */
const CODE_WRAP = Platform.OS === "web" ? ({ whiteSpace: "pre-wrap", wordBreak: "break-all" } as object) : null;

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
  ui,
}: {
  line: DiffLine;
  tokens: Token[];
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
        : line.kind === "hunk"
          ? theme.colors.surface2
          : null;
  const cell = { fontFamily: MONO, fontSize: 11, lineHeight: 17 };
  const number = { ...cell, width: 38, color: theme.colors.foregroundMuted, textAlign: "right" as const };
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Select line ${lineNumber(line)}` : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [{ flexDirection: "row", position: "relative" }, pressed ? { opacity: 0.8 } : null]}
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
            opacity: line.kind === "hunk" ? 1 : 0.14,
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
      {line.kind === "hunk" ? (
        <Text style={{ ...cell, flex: 1, paddingHorizontal: 8, color: theme.colors.foregroundMuted }} numberOfLines={1}>
          {line.text}
        </Text>
      ) : (
        <>
          <Text style={number}>{line.oldLine ?? ""}</Text>
          <Text style={number}>{line.newLine ?? ""}</Text>
          <Text style={{ ...cell, width: 16, textAlign: "center", color: theme.colors.foregroundMuted }}>
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
          </Text>
          <Text selectable style={[{ ...cell, flex: 1, color: theme.colors.foreground, paddingRight: 8 }, CODE_WRAP]}>
            {line.text
              ? tokens.map((token, index) =>
                  palette[token.kind] ? (
                    <Text
                      key={index}
                      style={{ color: palette[token.kind]!, fontStyle: token.kind === "comment" ? "italic" : "normal" }}
                    >
                      {token.text}
                    </Text>
                  ) : (
                    token.text
                  ),
                )
              : " "}
          </Text>
        </>
      )}
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
  };
}

/** A comment waiting in your review, shown under the line it ends on, like GitLab's pending notes. */
function PendingNote({ comment, viewer, onEdit, onRemove, ui }: {
  comment: PendingComment;
  viewer: { username: string; name: string } | null;
  onEdit: (body: string) => void;
  onRemove: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const [editing, setEditing] = useState(false);
  return (
    <View style={{ margin: 8, padding: 10, gap: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.statusWarning, backgroundColor: theme.colors.surface1 }}>
      <View style={styles.row}>
        <Avatar person={viewer ? { ...viewer } : null} styles={styles} size={20} />
        <Text style={styles.noteAuthor}>{viewer?.name ?? "You"}</Text>
        <Badge label="Pending" styles={styles} color={theme.colors.statusWarning} />
        <View style={styles.spacer} />
        {!editing ? (
          <>
            <IconButton icon="Pencil" label="Edit the comment" onPress={() => setEditing(true)} theme={theme} styles={styles} />
            <IconButton icon="Trash2" label="Remove the comment" onPress={onRemove} theme={theme} styles={styles} />
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

export function FileDiff({
  file,
  detail,
  expanded,
  onToggle,
  actions,
  handlers,
  pending = [],
  viewer = null,
  ui,
}: {
  file: DiffFile;
  detail: Detail;
  expanded: boolean;
  onToggle: () => void;
  actions: NoteActions;
  handlers: CommentHandlers;
  /** This file's comments waiting in your local review. */
  pending?: PendingComment[];
  viewer?: { username: string; name: string; avatarUrl?: string | null } | null;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  // Indexes into file.lines; the first click anchors, the next one in the same file stretches it.
  const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const threads = detail.discussions.filter((discussion) => inFile(discussion, file));
  const placed = new Set<string>();
  const title = file.renamedFile ? `${file.oldPath} → ${file.newPath}` : file.newPath;
  const stacking = Boolean(handlers.stack);
  // Highlighted once per file; a hunk header resets the carried block-comment state.
  const highlighted = useMemo(() => {
    const language = languageOf(file.newPath);
    let state: HighlightState = { inBlock: false };
    return file.lines.map((line) => {
      if (line.kind === "hunk") {
        state = { inBlock: false };
        return [];
      }
      const result = highlightLine(line.text, language, state);
      state = result.state;
      return result.tokens;
    });
  }, [file]);
  const canComment = stacking || (detail.canComment && detail.diffRefs != null);
  const low = selection ? Math.min(selection.anchor, selection.focus) : -1;
  const high = selection ? Math.max(selection.anchor, selection.focus) : -1;
  const selectedLines = selection ? file.lines.slice(low, high + 1).filter((line) => line.kind !== "hunk") : [];

  const pick = (index: number) =>
    setSelection((current) => (current && current.anchor !== index ? { anchor: current.anchor, focus: index } : { anchor: index, focus: index }));

  const composerActions = (): { primary: ComposerAction; others: ComposerAction[] } => {
    const current: CodeSelection = { file, lines: selectedLines };
    const done = () => setSelection(null);
    if (handlers.stack) {
      const stack = handlers.stack;
      return {
        primary: {
          label: "Add to review",
          onSend: async (body) => {
            stack.add(current, body);
            done();
          },
        },
        others: [],
      };
    }
    const gitlab = (asDraft: boolean) => async (body: string) => {
      await handlers.toGitLab?.(current, body, asDraft);
      done();
    };
    return { primary: { label: "Comment", onSend: gitlab(false) }, others: [{ label: "Add to review", onSend: gitlab(true) }] };
  };

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
          <Text style={[styles.text, { fontFamily: MONO, fontSize: 12, fontWeight: "600", flexShrink: 0 }]} numberOfLines={1}>
            {title.split("/").pop()}
          </Text>
          <Text style={[styles.small, { fontFamily: MONO, flexShrink: 1 }]} numberOfLines={1}>
            {file.renamedFile ? `${file.oldPath} →` : title.split("/").slice(0, -1).join("/")}
          </Text>
        </View>
        {file.newFile ? <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>new</Text> : null}
        {file.deletedFile ? <Text style={[styles.small, { color: theme.colors.statusDanger }]}>deleted</Text> : null}
        {threads.length > 0 ? <Text style={styles.small}>💬 {threads.length}</Text> : null}
        <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>+{file.additions}</Text>
        <Text style={[styles.small, { color: theme.colors.statusDanger }]}>−{file.deletions}</Text>
      </Pressable>
      {expanded ? (
        <>
          <View style={styles.divider} />
          {file.truncated ? (
            <View style={styles.cardBody}>
              <Text style={styles.muted}>This diff is too large to show here.</Text>
              <Button
                label="Open the changes in GitLab"
                onPress={() => void openExternalUrl(`${detail.webUrl}/diffs`)}
                styles={styles}
                theme={theme}
              />
            </View>
          ) : (
            <View style={{ paddingVertical: 4 }}>
              {file.lines.map((line, index) => {
                const here = threads.filter((discussion) => anchoredAt(discussion, line));
                const waiting = pending.filter((comment) => endsAt(comment, line));
                here.forEach((discussion) => placed.add(discussion.id));
                const { primary, others } = index === high ? composerActions() : { primary: null, others: [] };
                return (
                  <Fragment key={index}>
                    <LineRow
                      line={line}
                      tokens={highlighted[index] ?? []}
                      selected={index >= low && index <= high && line.kind !== "hunk"}
                      onPress={canComment && line.kind !== "hunk" ? () => pick(index) : undefined}
                      ui={ui}
                    />
                    {here.map((discussion) => (
                      <View key={discussion.id} style={{ padding: 8 }}>
                        <Thread discussion={discussion} actions={actions} ui={ui} />
                      </View>
                    ))}
                    {handlers.stack
                      ? waiting.map((comment) => (
                          <PendingNote
                            key={comment.id}
                            comment={comment}
                            viewer={viewer}
                            onEdit={(body) => handlers.stack!.edit(comment.id, body)}
                            onRemove={() => handlers.stack!.remove(comment.id)}
                            ui={ui}
                          />
                        ))
                      : null}
                    {primary && selectedLines.length > 0 ? (
                      <View style={{ padding: 8, gap: 6 }}>
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
                            detail.canPush && selectedLines.some((line) => line.kind !== "removed")
                              ? [{ label: "Suggest change", text: suggestionFor(selectedLines) }]
                              : []
                          }
                          onCancel={() => setSelection(null)}
                          ui={ui}
                        />
                      </View>
                    ) : null}
                  </Fragment>
                );
              })}
              {threads
                    .filter((discussion) => !placed.has(discussion.id))
                    .map((discussion) => (
                      // Anchored to a line outside the shown hunks, or to an older version of the file.
                      <View key={discussion.id} style={{ padding: 8, gap: 4 }}>
                        <Text style={styles.small}>On a line not in this diff</Text>
                        <Thread discussion={discussion} actions={actions} ui={ui} />
                      </View>
                    ))}
            </View>
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
      return new Set(files.filter((file) => file.newPath === focusPath || file.oldPath === focusPath).map(fileKey));
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
      const pick = ({ kind, oldLine, newLine, oldPos, newPos }: DiffLine) => ({ kind, oldLine, newLine, oldPos, newPos });
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

  const refresh = () => {
    void detail.refetch();
    void diffs.refetch();
  };

  return (
    <ProjectContext.Provider value={itemRef.projectPath}>
      <View style={{ gap: 12 }}>
        {header ?? (
          <View style={styles.row}>
            {onBack ? <IconButton icon="ChevronLeft" label="Back" onPress={onBack} theme={theme} styles={styles} /> : null}
            <Text style={styles.muted} numberOfLines={1}>
              {data.reference} · {files.length} files
            </Text>
            <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>+{additions}</Text>
            <Text style={[styles.small, { color: theme.colors.statusDanger }]}>−{deletions}</Text>
            <View style={styles.spacer} />
            {onOpenWide ? (
              <IconButton icon="Maximize2" label="Open in the main area" onPress={onOpenWide} theme={theme} styles={styles} />
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
          {files.length} files · +{additions} −{deletions} · click a line to comment, then another to select a range
        </Text>
        {diffs.data.truncated ? <Text style={styles.small}>Only the first 500 files are shown.</Text> : null}
        {files.map((file) => (
          <FileDiff
            key={fileKey(file)}
            file={file}
            detail={data}
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
