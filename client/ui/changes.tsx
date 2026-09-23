import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { Fragment, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  addDiffNoteRpc,
  addDraftRpc,
  detailRpc,
  diffsRpc,
  type Detail,
  type DiffFile,
  type DiffLine,
  type Discussion,
  type ItemRef,
} from "../../shared/contract";
import { Button, Centered, errorText, IconButton } from "./common";
import { Composer, Thread, useNoteActions, useWrite, type NoteActions, type Ui } from "./detail";
import { detailKey } from "./queries";
import { draftsKey, ReviewBar } from "./review";

const MONO = Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "Menlo" });

function diffsKey(ref: ItemRef) {
  return ["gitlab", "diffs", ref.projectPath, ref.iid] as const;
}

function fileKey(file: DiffFile): string {
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
  onPress,
  selected,
  ui,
}: {
  line: DiffLine;
  onPress?: () => void;
  selected: boolean;
  ui: Ui;
}) {
  const { theme } = ui;
  const tint =
    line.kind === "added"
      ? theme.colors.statusSuccess
      : line.kind === "removed"
        ? theme.colors.statusDanger
        : line.kind === "hunk"
          ? theme.colors.surface2
          : null;
  const number = {
    width: 38,
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
    color: theme.colors.foregroundMuted,
    textAlign: "right" as const,
  };
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Comment on line ${line.newLine ?? line.oldLine}` : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        { flexDirection: "row", position: "relative" },
        pressed || selected ? { backgroundColor: theme.colors.surface2 } : null,
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
            opacity: line.kind === "hunk" ? 1 : 0.14,
          }}
        />
      ) : null}
      {line.kind === "hunk" ? (
        <Text
          style={{
            flex: 1,
            fontFamily: MONO,
            fontSize: 11,
            lineHeight: 17,
            paddingHorizontal: 8,
            color: theme.colors.foregroundMuted,
          }}
          numberOfLines={1}
        >
          {line.text}
        </Text>
      ) : (
        <>
          <Text style={number}>{line.oldLine ?? ""}</Text>
          <Text style={number}>{line.newLine ?? ""}</Text>
          <Text
            style={{
              width: 16,
              textAlign: "center",
              fontFamily: MONO,
              fontSize: 11,
              lineHeight: 17,
              color: theme.colors.foregroundMuted,
            }}
          >
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
          </Text>
          <Text
            selectable
            style={{
              flex: 1,
              fontFamily: MONO,
              fontSize: 11,
              lineHeight: 17,
              color: theme.colors.foreground,
              paddingRight: 8,
            }}
          >
            {line.text || " "}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function FileDiff({
  file,
  detail,
  expanded,
  onToggle,
  actions,
  onComment,
  ui,
}: {
  file: DiffFile;
  detail: Detail;
  expanded: boolean;
  onToggle: () => void;
  actions: NoteActions;
  onComment: (file: DiffFile, line: DiffLine, body: string, asDraft: boolean) => Promise<unknown>;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const [commentingAt, setCommentingAt] = useState<number | null>(null);
  const threads = detail.discussions.filter((discussion) => inFile(discussion, file));
  const placed = new Set<string>();
  const title = file.renamedFile ? `${file.oldPath} → ${file.newPath}` : file.newPath;
  const canComment = detail.canComment && detail.diffRefs != null;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.listRow, styles.row, pressed ? styles.listRowPressed : null]}
      >
        <Text style={styles.small}>{expanded ? "▾" : "▸"}</Text>
        <Text style={[styles.text, { flex: 1, fontFamily: MONO, fontSize: 12 }]} numberOfLines={2}>
          {title}
        </Text>
        {file.newFile ? <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>new</Text> : null}
        {file.deletedFile ? (
          <Text style={[styles.small, { color: theme.colors.statusDanger }]}>deleted</Text>
        ) : null}
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
                here.forEach((discussion) => placed.add(discussion.id));
                return (
                  <Fragment key={index}>
                    <LineRow
                      line={line}
                      selected={commentingAt === index}
                      onPress={canComment && line.kind !== "hunk" ? () => setCommentingAt(index) : undefined}
                      ui={ui}
                    />
                    {here.map((discussion) => (
                      <View key={discussion.id} style={{ padding: 8 }}>
                        <Thread discussion={discussion} actions={actions} ui={ui} />
                      </View>
                    ))}
                    {commentingAt === index ? (
                      <View style={{ padding: 8 }}>
                        <Composer
                          placeholder={`Comment on line ${line.newLine ?? line.oldLine}…`}
                          sendLabel="Add comment"
                          autoFocus
                          onSend={async (body) => {
                            await onComment(file, line, body, false);
                            setCommentingAt(null);
                          }}
                          others={[
                            {
                              label: "Add to review",
                              onSend: async (body) => {
                                await onComment(file, line, body, true);
                                setCommentingAt(null);
                              },
                            },
                          ]}
                          templates={
                            line.kind !== "removed" && detail.canPush
                              ? [{ label: "Suggest change", text: `\`\`\`suggestion:-0+0\n${line.text}\n\`\`\`` }]
                              : []
                          }
                          onCancel={() => setCommentingAt(null)}
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
  ui,
}: {
  itemRef: ItemRef;
  focusPath?: string;
  onBack: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readDetail = useRpc(detailRpc);
  const readDiffs = useRpc(diffsRpc);
  const addDiffNote = useRpc(addDiffNoteRpc);
  const addDraft = useRpc(addDraftRpc);
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
          <Button label="Back" onPress={onBack} styles={styles} theme={theme} />
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
  const diffRefs = detail.data.diffRefs;

  const comment = (file: DiffFile, line: DiffLine, body: string, asDraft: boolean) => {
    if (!diffRefs) {
      return Promise.reject(new Error("GitLab did not report the commits this MR compares."));
    }
    const anchor = {
      oldPath: file.oldPath,
      newPath: file.newPath,
      oldLine: line.kind === "added" ? null : line.oldLine,
      newLine: line.kind === "removed" ? null : line.newLine,
    };
    if (asDraft) {
      return write(async () => {
        await addDraft({ projectPath: itemRef.projectPath, iid: itemRef.iid, body, code: { diffRefs, ...anchor } });
        await queryClient.invalidateQueries({ queryKey: draftsKey(itemRef.projectPath, itemRef.iid) });
      });
    }
    return write(() => addDiffNote({ noteableId: detail.data.id, body, diffRefs, ...anchor }));
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.row}>
        <IconButton icon="ChevronLeft" label="Back" onPress={onBack} theme={theme} styles={styles} />
        <Text style={styles.muted} numberOfLines={1}>
          {detail.data.reference} · {files.length} files
        </Text>
        <Text style={[styles.small, { color: theme.colors.statusSuccess }]}>+{additions}</Text>
        <Text style={[styles.small, { color: theme.colors.statusDanger }]}>−{deletions}</Text>
        <View style={styles.spacer} />
        <IconButton
          icon="RefreshCw"
          label="Refresh"
          onPress={() => {
            void detail.refetch();
            void diffs.refetch();
          }}
          disabled={detail.isFetching || diffs.isFetching}
          theme={theme}
          styles={styles}
        />
        <IconButton
          icon="ExternalLink"
          label="Open the changes in GitLab"
          onPress={() => void openExternalUrl(`${detail.data.webUrl}/diffs`)}
          theme={theme}
          styles={styles}
        />
      </View>
      <ReviewBar detail={detail.data} write={write} ui={ui} />
      {detail.data.canComment ? <Text style={styles.small}>Tap a line to comment on it.</Text> : null}
      {diffs.data.truncated ? <Text style={styles.small}>Only the first 500 files are shown.</Text> : null}
      {files.map((file) => (
        <FileDiff
          key={fileKey(file)}
          file={file}
          detail={detail.data}
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
          onComment={comment}
          ui={ui}
        />
      ))}
    </View>
  );
}
