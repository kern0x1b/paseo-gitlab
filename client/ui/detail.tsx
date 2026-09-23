import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  addNoteRpc,
  detailRpc,
  resolveRpc,
  type Detail,
  type Discussion,
  type ItemRef,
  type Note,
  type Person,
  type PipelineRef,
} from "../../shared/contract";
import { HtmlBody } from "../html/html-body";
import { htmlToText } from "../html/sanitize";
import { Avatar, Badge, Button, Centered, errorText, IconButton, Labels, PipelineDot } from "./common";
import { humanize, mergeStatusLabel, timeAgo } from "./format";
import { DETAIL_REFRESH_MS, detailKey, LISTS_KEY } from "./queries";
import type { Styles } from "./styles";

type Ui = { theme: PluginTheme; styles: Styles; host: string };

function people(list: Person[]): string {
  return list.map((person) => `@${person.username}`).join(", ");
}

function Meta({ label, value, styles }: { label: string; value: string | null; styles: Styles }) {
  if (!value) {
    return null;
  }
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

/**
 * One composer for both a new thread and a reply. Cmd/Ctrl+Enter sends on web,
 * the button everywhere.
 */
function Composer({
  placeholder,
  sendLabel,
  onSend,
  onCancel,
  ui,
}: {
  placeholder: string;
  sendLabel: string;
  onSend: (body: string) => Promise<unknown>;
  onCancel?: () => void;
  ui: Ui;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const text = body.trim();
    if (!text || sending) {
      return;
    }
    setSending(true);
    try {
      await onSend(text);
      setBody("");
    } finally {
      setSending(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder={placeholder}
        placeholderTextColor={ui.theme.colors.foregroundMuted}
        multiline
        editable={!sending}
        style={ui.styles.input}
        onKeyPress={(event) => {
          const native = event.nativeEvent as { key: string; metaKey?: boolean; ctrlKey?: boolean };
          if (native.key === "Enter" && (native.metaKey || native.ctrlKey)) {
            void send();
          }
        }}
      />
      <View style={ui.styles.row}>
        <View style={ui.styles.spacer} />
        {onCancel ? <Button label="Cancel" onPress={onCancel} styles={ui.styles} theme={ui.theme} /> : null}
        <Button
          label={sendLabel}
          primary
          busy={sending}
          disabled={!body.trim()}
          onPress={() => void send()}
          styles={ui.styles}
          theme={ui.theme}
        />
      </View>
    </View>
  );
}

function NoteView({ note, ui }: { note: Note; ui: Ui }) {
  return (
    <View style={ui.styles.note}>
      <View style={ui.styles.noteHeader}>
        <Avatar person={note.author} styles={ui.styles} />
        <Text style={ui.styles.noteAuthor} numberOfLines={1}>
          {note.author?.name ?? "Ghost user"}
        </Text>
        <Text style={ui.styles.small} numberOfLines={1}>
          @{note.author?.username ?? "ghost"} · {timeAgo(note.createdAt)}
        </Text>
      </View>
      <HtmlBody html={note.bodyHtml} host={ui.host} theme={ui.theme} />
    </View>
  );
}

function Thread({
  discussion,
  onReply,
  onResolve,
  ui,
}: {
  discussion: Discussion;
  onReply: (discussionId: string, body: string) => Promise<unknown>;
  onResolve: (discussionId: string, resolve: boolean) => Promise<unknown>;
  ui: Ui;
}) {
  const [replying, setReplying] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [first, ...replies] = discussion.notes;
  // Collapsed like GitLab does: a resolved thread shows its first note and a count.
  const [expanded, setExpanded] = useState(!discussion.resolved);
  if (!first) {
    return null;
  }
  return (
    <View style={ui.styles.card}>
      <View style={ui.styles.cardBody}>
        {discussion.resolvable ? (
          <View style={ui.styles.row}>
            {discussion.resolved ? (
              <Badge label="Resolved" styles={ui.styles} color={ui.theme.colors.statusSuccess} />
            ) : (
              <Badge label="Unresolved" styles={ui.styles} color={ui.theme.colors.statusWarning} />
            )}
            <View style={ui.styles.spacer} />
            <Button
              label={discussion.resolved ? "Unresolve" : "Resolve thread"}
              busy={resolving}
              onPress={() => {
                setResolving(true);
                void onResolve(discussion.id, !discussion.resolved).finally(() => setResolving(false));
              }}
              styles={ui.styles}
              theme={ui.theme}
            />
          </View>
        ) : null}
        <NoteView note={first} ui={ui} />
        {replies.length > 0 && !expanded ? (
          <Pressable accessibilityRole="button" onPress={() => setExpanded(true)}>
            <Text style={[ui.styles.muted, { color: ui.theme.colors.accent }]}>
              Show {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </Text>
          </Pressable>
        ) : null}
        {replies.length > 0 && expanded ? (
          <View style={ui.styles.replies}>
            {replies.map((note) => (
              <NoteView key={note.id} note={note} ui={ui} />
            ))}
          </View>
        ) : null}
        {replying ? (
          <Composer
            placeholder="Reply…"
            sendLabel="Reply"
            onSend={async (body) => {
              await onReply(discussion.id, body);
              setReplying(false);
              setExpanded(true);
            }}
            onCancel={() => setReplying(false)}
            ui={ui}
          />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setReplying(true)}>
            <Text style={[ui.styles.muted, { color: ui.theme.colors.accent }]}>Reply</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Header({
  detail,
  onBack,
  onRefresh,
  refreshing,
  ui,
}: {
  detail: Detail;
  onBack: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  ui: Ui;
}) {
  const stateColor =
    detail.state === "opened"
      ? ui.theme.colors.statusSuccess
      : detail.state === "merged"
        ? ui.theme.colors.accent
        : ui.theme.colors.foregroundMuted;
  return (
    <View style={{ gap: 8 }}>
      <View style={ui.styles.row}>
        <IconButton
          icon="ChevronLeft"
          label="Back to the list"
          onPress={onBack}
          theme={ui.theme}
          styles={ui.styles}
        />
        <Text style={ui.styles.muted} numberOfLines={1}>
          {detail.reference}
        </Text>
        <View style={ui.styles.spacer} />
        <IconButton
          icon="RefreshCw"
          label="Refresh"
          onPress={onRefresh}
          disabled={refreshing}
          theme={ui.theme}
          styles={ui.styles}
        />
        <IconButton
          icon="ExternalLink"
          label="Open in GitLab"
          onPress={() => void openExternalUrl(detail.webUrl)}
          theme={ui.theme}
          styles={ui.styles}
        />
      </View>
      <Text style={ui.styles.title}>{detail.title}</Text>
      <View style={ui.styles.row}>
        <Badge label={humanize(detail.state)} styles={ui.styles} color={stateColor} />
        {detail.draft ? <Badge label="Draft" styles={ui.styles} /> : null}
        {detail.kind === "mr" && detail.approved ? (
          <Badge label="Approved" styles={ui.styles} color={ui.theme.colors.statusSuccess} />
        ) : null}
        <Text style={ui.styles.small} numberOfLines={1}>
          by @{detail.author?.username ?? "ghost"} · {timeAgo(detail.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export function ItemDetail({
  itemRef,
  onBack,
  onOpenPipeline,
  ui,
}: {
  itemRef: ItemRef;
  onBack: () => void;
  onOpenPipeline: (ref: PipelineRef) => void;
  ui: Ui;
}) {
  const readDetail = useRpc(detailRpc);
  const addNote = useRpc(addNoteRpc);
  const resolve = useRpc(resolveRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showSystem, setShowSystem] = useState(false);

  const query = useQuery({
    queryKey: detailKey(itemRef),
    queryFn: () => readDetail(itemRef),
    refetchInterval: DETAIL_REFRESH_MS,
  });

  const afterWrite = async () => {
    await queryClient.invalidateQueries({ queryKey: detailKey(itemRef) });
    void queryClient.invalidateQueries({ queryKey: LISTS_KEY });
  };
  const post = useMutation({
    mutationFn: addNote,
    onSuccess: afterWrite,
    onError: (error) => toast.error(errorText(error)),
  });
  const toggle = useMutation({
    mutationFn: resolve,
    onSuccess: afterWrite,
    onError: (error) => toast.error(errorText(error)),
  });

  if (query.isPending) {
    return (
      <Centered styles={ui.styles}>
        <Text style={ui.styles.muted}>Loading…</Text>
      </Centered>
    );
  }
  if (query.isError) {
    return (
      <Centered styles={ui.styles}>
        <Text style={ui.styles.error}>{errorText(query.error)}</Text>
        <View style={ui.styles.row}>
          <Button label="Back" onPress={onBack} styles={ui.styles} theme={ui.theme} />
          <Button label="Retry" onPress={() => void query.refetch()} styles={ui.styles} theme={ui.theme} />
        </View>
      </Centered>
    );
  }

  const detail = query.data;
  const systemCount = detail.discussions.filter((discussion) => discussion.notes[0]?.system).length;
  const visible = detail.discussions.filter((discussion) => showSystem || !discussion.notes[0]?.system);
  const branches =
    detail.sourceBranch && detail.targetBranch ? `${detail.sourceBranch} → ${detail.targetBranch}` : null;

  return (
    <View style={{ gap: 12 }}>
      <Header
        detail={detail}
        onBack={onBack}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        ui={ui}
      />

      <View style={ui.styles.card}>
        <View style={ui.styles.cardBody}>
          <Meta label="Assignees" value={people(detail.assignees)} styles={ui.styles} />
          <Meta label="Reviewers" value={people(detail.reviewers)} styles={ui.styles} />
          <Meta label="Milestone" value={detail.milestone} styles={ui.styles} />
          <Meta label="Branches" value={branches} styles={ui.styles} />
          {detail.kind === "mr" ? (
            <View style={ui.styles.metaRow}>
              <Text style={ui.styles.metaLabel}>Status</Text>
              <Text style={ui.styles.metaValue}>{mergeStatusLabel(detail.mergeStatus) ?? "—"}</Text>
            </View>
          ) : null}
          {detail.pipelineIid ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open pipeline ${detail.pipelineIid}`}
              onPress={() => onOpenPipeline({ projectPath: detail.projectPath, iid: detail.pipelineIid! })}
              style={({ pressed }) => [ui.styles.metaRow, pressed ? ui.styles.listRowPressed : null]}
            >
              <Text style={ui.styles.metaLabel}>Pipeline</Text>
              <View style={[ui.styles.row, { flex: 1 }]}>
                <PipelineDot status={detail.pipelineStatus} theme={ui.theme} styles={ui.styles} />
                <Text style={[ui.styles.metaValue, { color: ui.theme.colors.accent }]}>
                  #{detail.pipelineIid} {detail.pipelineStatus ? humanize(detail.pipelineStatus).toLowerCase() : ""} ›
                </Text>
              </View>
            </Pressable>
          ) : null}
          <Labels labels={detail.labels} styles={ui.styles} />
        </View>
      </View>

      <View style={ui.styles.card}>
        <View style={ui.styles.cardBody}>
          {detail.descriptionHtml.trim() ? (
            <HtmlBody html={detail.descriptionHtml} host={ui.host} theme={ui.theme} />
          ) : (
            <Text style={ui.styles.muted}>No description.</Text>
          )}
        </View>
      </View>

      <View style={ui.styles.row}>
        <Text style={ui.styles.sectionTitle}>Activity</Text>
        <View style={ui.styles.spacer} />
        {systemCount > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setShowSystem((value) => !value)}>
            <Text style={ui.styles.small}>
              {showSystem ? "Hide" : "Show"} {systemCount} system {systemCount === 1 ? "note" : "notes"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {visible.map((discussion) =>
        discussion.notes[0]?.system ? (
          <Text key={discussion.id} style={ui.styles.systemNote}>
            @{discussion.notes[0].author?.username ?? "ghost"}{" "}
            {htmlToText(discussion.notes[0].bodyHtml)} · {timeAgo(discussion.notes[0].createdAt)}
          </Text>
        ) : (
          <Thread
            key={discussion.id}
            discussion={discussion}
            onReply={(discussionId, body) => post.mutateAsync({ noteableId: detail.id, body, discussionId })}
            onResolve={(discussionId, value) => toggle.mutateAsync({ discussionId, resolve: value })}
            ui={ui}
          />
        ),
      )}

      <View style={ui.styles.card}>
        <View style={ui.styles.cardBody}>
          <Composer
            placeholder="Write a comment…"
            sendLabel="Comment"
            onSend={(body) => post.mutateAsync({ noteableId: detail.id, body })}
            ui={ui}
          />
        </View>
      </View>
    </View>
  );
}
