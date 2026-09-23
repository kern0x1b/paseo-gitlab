import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  addDraftRpc,
  addNoteRpc,
  applySuggestionRpc,
  deleteNoteRpc,
  detailRpc,
  resolveRpc,
  setLabelsRpc,
  setPeopleRpc,
  toggleReactionRpc,
  updateItemRpc,
  updateNoteRpc,
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
import { SendToAgentButton } from "./agent";
import { LabelPicker, PeoplePicker } from "./picker";
import { draftsKey, MergePanel, Reactions, ReviewBar } from "./review";
import { DETAIL_REFRESH_MS, detailKey, LISTS_KEY } from "./queries";
import type { Styles } from "./styles";

export type Ui = { theme: PluginTheme; styles: Styles; host: string; workspaceId: string };

/** What a thread needs to act on its notes; built once per detail. */
export interface NoteActions {
  reply: (discussionId: string, body: string) => Promise<unknown>;
  resolve: (discussionId: string, resolve: boolean) => Promise<unknown>;
  edit: (noteId: string, body: string) => Promise<unknown>;
  remove: (noteId: string) => Promise<unknown>;
  react: (awardableId: string, name: string) => Promise<unknown>;
  viewer: string;
  /** Only when you can push to the source branch, which applying commits to. */
  applySuggestion?: (suggestionId: string) => Promise<unknown>;
  /** MRs only: the reply goes into your pending review instead of out at once. */
  draftReply?: (discussionId: string, body: string) => Promise<unknown>;
}

/** An extra send action next to the primary one, like "Start thread" or "Add to review". */
export interface ComposerAction {
  label: string;
  onSend: (body: string) => Promise<unknown>;
}

function people(list: Person[]): string {
  return list.map((person) => `@${person.username}`).join(", ");
}

function Link({
  label,
  onPress,
  ui,
  danger,
}: {
  label: string;
  onPress: () => void;
  ui: Ui;
  danger?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}>
      <Text
        style={[ui.styles.small, { color: danger ? ui.theme.colors.statusDanger : ui.theme.colors.accent }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One composer for new comments, replies and edits. Cmd/Ctrl+Enter sends the
 * primary action on web; a secondary action ("Start thread") sits next to it.
 */
export function Composer({
  placeholder,
  sendLabel,
  onSend,
  others = [],
  templates = [],
  onCancel,
  initialValue = "",
  autoFocus,
  ui,
}: {
  placeholder: string;
  sendLabel: string;
  onSend: (body: string) => Promise<unknown>;
  others?: ComposerAction[];
  /** Snippets to insert, like a suggestion block pre-filled with the line. */
  templates?: { label: string; text: string }[];
  onCancel?: () => void;
  initialValue?: string;
  autoFocus?: boolean;
  ui: Ui;
}) {
  const [body, setBody] = useState(initialValue);
  const [sending, setSending] = useState<string | null>(null);
  const send = async (which: string) => {
    const text = body.trim();
    const action = which === "primary" ? onSend : others.find((other) => other.label === which)?.onSend;
    if (!text || sending || !action) {
      return;
    }
    setSending(which);
    try {
      await action(text);
      setBody("");
    } catch {
      // The mutation already raised a toast; keep the text so nothing typed is lost.
    } finally {
      setSending(null);
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
        autoFocus={autoFocus}
        editable={sending === null}
        style={ui.styles.input}
        onKeyPress={(event) => {
          const native = event.nativeEvent as { key: string; metaKey?: boolean; ctrlKey?: boolean };
          if (native.key === "Enter" && (native.metaKey || native.ctrlKey)) {
            void send("primary");
          }
        }}
      />
      <View style={[ui.styles.row, { flexWrap: "wrap" }]}>
        <View style={ui.styles.spacer} />
        {onCancel ? <Button label="Cancel" onPress={onCancel} styles={ui.styles} theme={ui.theme} /> : null}
        {templates.map((template) => (
          <Button
            key={template.label}
            label={template.label}
            disabled={sending !== null}
            onPress={() => setBody((current) => (current ? `${current}\n${template.text}` : template.text))}
            styles={ui.styles}
            theme={ui.theme}
          />
        ))}
        {others.map((other) => (
          <Button
            key={other.label}
            label={other.label}
            busy={sending === other.label}
            disabled={!body.trim() || (sending !== null && sending !== other.label)}
            onPress={() => void send(other.label)}
            styles={ui.styles}
            theme={ui.theme}
          />
        ))}
        <Button
          label={sendLabel}
          primary
          busy={sending === "primary"}
          disabled={!body.trim() || (sending !== null && sending !== "primary")}
          onPress={() => void send("primary")}
          styles={ui.styles}
          theme={ui.theme}
        />
      </View>
    </View>
  );
}

export function NoteView({ note, actions, ui }: { note: Note; actions: NoteActions; ui: Ui }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <View style={ui.styles.note}>
      <View style={ui.styles.noteHeader}>
        <Avatar person={note.author} styles={ui.styles} />
        <Text style={ui.styles.noteAuthor} numberOfLines={1}>
          {note.author?.name ?? "Ghost user"}
        </Text>
        <Text style={[ui.styles.small, { flexShrink: 1 }]} numberOfLines={1}>
          @{note.author?.username ?? "ghost"} · {timeAgo(note.createdAt)}
        </Text>
        <View style={ui.styles.spacer} />
        {note.canEdit && !editing && !confirmingDelete ? (
          <>
            <Link label="Edit" onPress={() => setEditing(true)} ui={ui} />
            <Link label="Delete" onPress={() => setConfirmingDelete(true)} ui={ui} danger />
          </>
        ) : null}
        {confirmingDelete ? (
          <>
            <Text style={ui.styles.small}>Delete this comment?</Text>
            <Link label="No" onPress={() => setConfirmingDelete(false)} ui={ui} />
            <Link
              label={deleting ? "Deleting…" : "Yes, delete"}
              danger
              onPress={() => {
                setDeleting(true);
                void actions
                  .remove(note.id)
                  .catch(() => {})
                  .finally(() => {
                    setDeleting(false);
                    setConfirmingDelete(false);
                  });
              }}
              ui={ui}
            />
          </>
        ) : null}
      </View>
      {editing ? (
        <Composer
          placeholder="Edit the comment…"
          sendLabel="Save"
          initialValue={note.body}
          autoFocus
          onSend={async (body) => {
            await actions.edit(note.id, body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          ui={ui}
        />
      ) : (
        <HtmlBody html={note.bodyHtml} host={ui.host} theme={ui.theme} />
      )}
      {!editing && note.suggestions.length > 0 ? (
        <View style={[ui.styles.row, { flexWrap: "wrap" }]}>
          {note.suggestions.map((suggestion, index) =>
            suggestion.applied ? (
              <Badge key={suggestion.id} label="Suggestion applied" styles={ui.styles} color={ui.theme.colors.statusSuccess} />
            ) : actions.applySuggestion ? (
              <ApplySuggestion
                key={suggestion.id}
                label={note.suggestions.length > 1 ? `Apply suggestion ${index + 1}` : "Apply suggestion"}
                onApply={() => actions.applySuggestion!(suggestion.id)}
                ui={ui}
              />
            ) : null,
          )}
        </View>
      ) : null}
      {!editing && !note.system ? (
        <Reactions reactions={note.reactions} viewer={actions.viewer} onToggle={(name) => actions.react(note.id, name)} ui={ui} />
      ) : null}
    </View>
  );
}

function ApplySuggestion({ label, onApply, ui }: { label: string; onApply: () => Promise<unknown>; ui: Ui }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      label={label}
      busy={busy}
      onPress={() => {
        setBusy(true);
        void onApply()
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
      styles={ui.styles}
      theme={ui.theme}
    />
  );
}

function positionLabel(discussion: Discussion): { path: string; label: string } | null {
  const position = discussion.notes[0]?.position;
  if (!position) {
    return null;
  }
  const line = position.newLine ?? position.oldLine;
  return { path: position.path, label: `${position.path}${line != null ? `:${line}` : ""}` };
}

export function Thread({
  discussion,
  actions,
  onOpenCode,
  ui,
}: {
  discussion: Discussion;
  actions: NoteActions;
  onOpenCode?: (path: string) => void;
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
  const code = positionLabel(discussion);
  return (
    <View style={ui.styles.card}>
      <View style={ui.styles.cardBody}>
        {code || discussion.resolvable ? (
          <View style={ui.styles.row}>
            {code ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${code.label} in the changes`}
                onPress={() => onOpenCode?.(code.path)}
                disabled={!onOpenCode}
                style={{ flexShrink: 1 }}
              >
                <Text style={[ui.styles.small, { color: ui.theme.colors.accent }]} numberOfLines={1}>
                  📄 {code.label}
                </Text>
              </Pressable>
            ) : null}
            <View style={ui.styles.spacer} />
            {discussion.resolvable ? (
              <>
                {discussion.resolved ? (
                  <Badge label="Resolved" styles={ui.styles} color={ui.theme.colors.statusSuccess} />
                ) : (
                  <Badge label="Unresolved" styles={ui.styles} color={ui.theme.colors.statusWarning} />
                )}
                <Button
                  label={discussion.resolved ? "Unresolve" : "Resolve"}
                  busy={resolving}
                  onPress={() => {
                    setResolving(true);
                    void actions
                      .resolve(discussion.id, !discussion.resolved)
                      .catch(() => {})
                      .finally(() => setResolving(false));
                  }}
                  styles={ui.styles}
                  theme={ui.theme}
                />
              </>
            ) : null}
          </View>
        ) : null}
        <NoteView note={first} actions={actions} ui={ui} />
        {replies.length > 0 && !expanded ? (
          <Link
            label={`Show ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
            onPress={() => setExpanded(true)}
            ui={ui}
          />
        ) : null}
        {replies.length > 0 && expanded ? (
          <View style={ui.styles.replies}>
            {replies.map((note) => (
              <NoteView key={note.id} note={note} actions={actions} ui={ui} />
            ))}
          </View>
        ) : null}
        {replying ? (
          <Composer
            placeholder="Reply…"
            sendLabel="Reply"
            autoFocus
            onSend={async (body) => {
              await actions.reply(discussion.id, body);
              setReplying(false);
              setExpanded(true);
            }}
            others={
              actions.draftReply
                ? [
                    {
                      label: "Add to review",
                      onSend: async (body) => {
                        await actions.draftReply!(discussion.id, body);
                        setReplying(false);
                      },
                    },
                  ]
                : []
            }
            onCancel={() => setReplying(false)}
            ui={ui}
          />
        ) : (
          <Link label="Reply" onPress={() => setReplying(true)} ui={ui} />
        )}
      </View>
    </View>
  );
}

function EditableRow({
  label,
  value,
  onEdit,
  ui,
  children,
}: {
  label: string;
  value?: string | null;
  onEdit?: () => void;
  ui: Ui;
  children?: React.ReactNode;
}) {
  if (!value && !children && !onEdit) {
    return null;
  }
  return (
    <View style={[ui.styles.metaRow, { alignItems: "center" }]}>
      <Text style={ui.styles.metaLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        {children ?? <Text style={ui.styles.metaValue}>{value || "None"}</Text>}
      </View>
      {onEdit ? (
        <IconButton
          icon="Pencil"
          label={`Edit ${label.toLowerCase()}`}
          onPress={onEdit}
          theme={ui.theme}
          styles={ui.styles}
        />
      ) : null}
    </View>
  );
}

function EditForm({
  detail,
  onSave,
  onCancel,
  ui,
}: {
  detail: Detail;
  onSave: (changes: { title: string; description: string }) => Promise<unknown>;
  onCancel: () => void;
  ui: Ui;
}) {
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave({ title: title.trim(), description });
    } catch {
      // Reported by the mutation's toast; the form stays open with the edits.
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={ui.styles.card}>
      <View style={ui.styles.cardBody}>
        <Text style={ui.styles.sectionTitle}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          editable={!saving}
          style={[ui.styles.input, { minHeight: 0 }]}
          placeholderTextColor={ui.theme.colors.foregroundMuted}
        />
        <Text style={ui.styles.sectionTitle}>Description (Markdown)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          editable={!saving}
          style={[
            ui.styles.input,
            { minHeight: 220, maxHeight: 520, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 },
          ]}
          placeholderTextColor={ui.theme.colors.foregroundMuted}
        />
        <View style={ui.styles.row}>
          <View style={ui.styles.spacer} />
          <Button label="Cancel" onPress={onCancel} styles={ui.styles} theme={ui.theme} />
          <Button
            label="Save"
            primary
            busy={saving}
            disabled={!title.trim()}
            onPress={() => void save()}
            styles={ui.styles}
            theme={ui.theme}
          />
        </View>
      </View>
    </View>
  );
}

function Header({
  detail,
  onBack,
  onRefresh,
  onEdit,
  refreshing,
  ui,
}: {
  detail: Detail;
  onBack: () => void;
  onRefresh: () => void;
  onEdit?: () => void;
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
        <IconButton icon="ChevronLeft" label="Back" onPress={onBack} theme={ui.theme} styles={ui.styles} />
        <Text style={ui.styles.muted} numberOfLines={1}>
          {detail.reference}
        </Text>
        <View style={ui.styles.spacer} />
        <SendToAgentButton
          workspaceId={ui.workspaceId}
          subject={{ item: { kind: detail.kind, projectPath: detail.projectPath, iid: detail.iid } }}
          ui={ui}
        />
        {onEdit ? (
          <IconButton
            icon="Pencil"
            label="Edit title and description"
            onPress={onEdit}
            theme={ui.theme}
            styles={ui.styles}
          />
        ) : null}
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
      <View style={[ui.styles.row, { flexWrap: "wrap" }]}>
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

/**
 * Every write here follows the same path: run it, refresh the item and the lists,
 * and on failure show a toast and rethrow so the caller keeps its form open.
 */
export function useWrite(itemRef: ItemRef): (work: () => Promise<unknown>) => Promise<void> {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (work) => {
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: detailKey(itemRef) });
      void queryClient.invalidateQueries({ queryKey: LISTS_KEY });
    } catch (error) {
      toast.error(errorText(error));
      throw error;
    }
  };
}

/** Note mutations, shared by the detail and the changes view. */
export function useNoteActions(itemRef: ItemRef, detail: Detail | undefined): NoteActions {
  const addNote = useRpc(addNoteRpc);
  const updateNote = useRpc(updateNoteRpc);
  const deleteNote = useRpc(deleteNoteRpc);
  const resolve = useRpc(resolveRpc);
  const toggleReaction = useRpc(toggleReactionRpc);
  const applySuggestion = useRpc(applySuggestionRpc);
  const addDraft = useRpc(addDraftRpc);
  const queryClient = useQueryClient();
  const write = useWrite(itemRef);
  const isMr = itemRef.kind === "mr";
  return {
    viewer: detail?.viewer ?? "",
    reply: (discussionId, body) =>
      write(() => addNote({ noteableId: detail?.id ?? "", body, discussionId, mode: "comment" })),
    resolve: (discussionId, value) => write(() => resolve({ discussionId, resolve: value })),
    edit: (id, body) => write(() => updateNote({ id, body })),
    remove: (id) => write(() => deleteNote({ id })),
    react: (awardableId, name) => write(() => toggleReaction({ awardableId, name })),
    applySuggestion: detail?.canPush ? (id) => write(() => applySuggestion({ id })) : undefined,
    draftReply: isMr
      ? (discussionId, body) =>
          write(async () => {
            await addDraft({ projectPath: itemRef.projectPath, iid: itemRef.iid, body, discussionId });
            await queryClient.invalidateQueries({ queryKey: draftsKey(itemRef.projectPath, itemRef.iid) });
          })
      : undefined,
  };
}

export function ItemDetail({
  itemRef,
  onBack,
  onOpenPipeline,
  onOpenChanges,
  ui,
}: {
  itemRef: ItemRef;
  onBack: () => void;
  onOpenPipeline: (ref: PipelineRef) => void;
  onOpenChanges: (focusPath?: string) => void;
  ui: Ui;
}) {
  const readDetail = useRpc(detailRpc);
  const addNote = useRpc(addNoteRpc);
  const updateItem = useRpc(updateItemRpc);
  const setPeople = useRpc(setPeopleRpc);
  const setLabels = useRpc(setLabelsRpc);
  const write = useWrite(itemRef);
  const [showSystem, setShowSystem] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState<"assignees" | "reviewers" | "labels" | null>(null);
  const [changingState, setChangingState] = useState<"draft" | "state" | null>(null);

  const query = useQuery({
    queryKey: detailKey(itemRef),
    queryFn: () => readDetail(itemRef),
    refetchInterval: DETAIL_REFRESH_MS,
  });
  const actions = useNoteActions(itemRef, query.data);
  const addDraft = useRpc(addDraftRpc);
  const queryClient = useQueryClient();

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
  const isMr = detail.kind === "mr";
  const edit = detail.canEdit;
  const systemCount = detail.discussions.filter((discussion) => discussion.notes[0]?.system).length;
  const visible = detail.discussions.filter((discussion) => showSystem || !discussion.notes[0]?.system);
  const branches =
    detail.sourceBranch && detail.targetBranch ? `${detail.sourceBranch} → ${detail.targetBranch}` : null;
  const stateAction = detail.state === "opened" ? "close" : detail.state === "closed" ? "reopen" : null;

  const changeState = (
    which: "draft" | "state",
    changes: { state?: "close" | "reopen"; draft?: boolean },
  ) => {
    setChangingState(which);
    void write(() => updateItem({ ...itemRef, ...changes }))
      .catch(() => {})
      .finally(() => setChangingState(null));
  };

  return (
    <View style={{ gap: 12 }}>
      <Header
        detail={detail}
        onBack={onBack}
        onRefresh={() => void query.refetch()}
        onEdit={edit && !editing ? () => setEditing(true) : undefined}
        refreshing={query.isFetching}
        ui={ui}
      />

      <ReviewBar detail={detail} write={write} ui={ui} />
      <MergePanel detail={detail} write={write} ui={ui} />

      {editing ? (
        <EditForm
          detail={detail}
          onSave={async (changes) => {
            await write(() =>
              updateItem({ ...itemRef, title: changes.title, description: changes.description }),
            );
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          ui={ui}
        />
      ) : null}

      <View style={ui.styles.card}>
        <View style={ui.styles.cardBody}>
          <EditableRow
            label="Assignees"
            value={people(detail.assignees)}
            onEdit={edit ? () => setPicker("assignees") : undefined}
            ui={ui}
          />
          {isMr ? (
            <EditableRow
              label="Reviewers"
              value={people(detail.reviewers)}
              onEdit={edit ? () => setPicker("reviewers") : undefined}
              ui={ui}
            />
          ) : null}
          <EditableRow label="Labels" onEdit={edit ? () => setPicker("labels") : undefined} ui={ui}>
            {detail.labels.length > 0 ? (
              <Labels labels={detail.labels} styles={ui.styles} />
            ) : (
              <Text style={ui.styles.metaValue}>None</Text>
            )}
          </EditableRow>
          <EditableRow label="Milestone" value={detail.milestone} ui={ui} />
          <EditableRow label="Branches" value={branches} ui={ui} />
          {isMr ? (
            <EditableRow label="Status" value={mergeStatusLabel(detail.mergeStatus) ?? "—"} ui={ui} />
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
                  #{detail.pipelineIid}{" "}
                  {detail.pipelineStatus ? humanize(detail.pipelineStatus).toLowerCase() : ""} ›
                </Text>
              </View>
            </Pressable>
          ) : null}
          {isMr ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the changes"
              onPress={() => onOpenChanges()}
              style={({ pressed }) => [ui.styles.metaRow, pressed ? ui.styles.listRowPressed : null]}
            >
              <Text style={ui.styles.metaLabel}>Changes</Text>
              <Text style={[ui.styles.metaValue, { color: ui.theme.colors.accent }]}>
                Files and code comments ›
              </Text>
            </Pressable>
          ) : null}
          {edit && (stateAction || isMr) ? (
            <View style={[ui.styles.row, { flexWrap: "wrap", marginTop: 4 }]}>
              {isMr && detail.state === "opened" ? (
                <Button
                  label={detail.draft ? "Mark as ready" : "Mark as draft"}
                  busy={changingState === "draft"}
                  onPress={() => changeState("draft", { draft: !detail.draft })}
                  styles={ui.styles}
                  theme={ui.theme}
                />
              ) : null}
              {stateAction ? (
                <Button
                  label={stateAction === "close" ? (isMr ? "Close merge request" : "Close issue") : "Reopen"}
                  busy={changingState === "state"}
                  onPress={() => changeState("state", { state: stateAction })}
                  styles={ui.styles}
                  theme={ui.theme}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {!editing ? (
        <View style={ui.styles.card}>
          <View style={ui.styles.cardBody}>
            {detail.descriptionHtml.trim() ? (
              <HtmlBody html={detail.descriptionHtml} host={ui.host} theme={ui.theme} />
            ) : (
              <Text style={ui.styles.muted}>No description.</Text>
            )}
            {isMr ? (
              <Reactions
                reactions={detail.reactions}
                viewer={detail.viewer}
                onToggle={(name) => actions.react(detail.id, name)}
                ui={ui}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={ui.styles.row}>
        <Text style={ui.styles.sectionTitle}>Activity</Text>
        <View style={ui.styles.spacer} />
        {systemCount > 0 ? (
          <Link
            label={`${showSystem ? "Hide" : "Show"} ${systemCount} system ${systemCount === 1 ? "note" : "notes"}`}
            onPress={() => setShowSystem((value) => !value)}
            ui={ui}
          />
        ) : null}
      </View>

      {visible.map((discussion) =>
        discussion.notes[0]?.system ? (
          <Text key={discussion.id} style={ui.styles.systemNote}>
            @{discussion.notes[0].author?.username ?? "ghost"} {htmlToText(discussion.notes[0].bodyHtml)} ·{" "}
            {timeAgo(discussion.notes[0].createdAt)}
          </Text>
        ) : (
          <Thread
            key={discussion.id}
            discussion={discussion}
            actions={actions}
            onOpenCode={isMr ? (path) => onOpenChanges(path) : undefined}
            ui={ui}
          />
        ),
      )}

      {detail.canComment ? (
        <View style={ui.styles.card}>
          <View style={ui.styles.cardBody}>
            <Composer
              placeholder="Write a comment…"
              sendLabel="Comment"
              onSend={(body) => write(() => addNote({ noteableId: detail.id, body, mode: "comment" }))}
              others={[
                {
                  label: "Start thread",
                  onSend: (body) => write(() => addNote({ noteableId: detail.id, body, mode: "thread" })),
                },
                ...(isMr
                  ? [
                      {
                        label: "Add to review",
                        onSend: (body: string) =>
                          write(async () => {
                            await addDraft({ projectPath: detail.projectPath, iid: detail.iid, body });
                            await queryClient.invalidateQueries({ queryKey: draftsKey(detail.projectPath, detail.iid) });
                          }),
                      },
                    ]
                  : []),
              ]}
              ui={ui}
            />
          </View>
        </View>
      ) : null}

      <PeoplePicker
        title={picker === "reviewers" ? "Reviewers" : "Assignees"}
        open={picker === "assignees" || picker === "reviewers"}
        onClose={() => setPicker(null)}
        projectPath={detail.projectPath}
        initial={picker === "reviewers" ? detail.reviewers : detail.assignees}
        onSave={(usernames) =>
          write(() =>
            setPeople({ ...itemRef, field: picker === "reviewers" ? "reviewers" : "assignees", usernames }),
          )
        }
        ui={ui}
      />
      <LabelPicker
        open={picker === "labels"}
        onClose={() => setPicker(null)}
        projectPath={detail.projectPath}
        initial={detail.labels}
        onSave={(labelIds) => write(() => setLabels({ ...itemRef, labelIds }))}
        ui={ui}
      />
    </View>
  );
}
