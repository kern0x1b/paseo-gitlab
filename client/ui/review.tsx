import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  deleteDraftRpc,
  draftsRpc,
  mergeRequestActionRpc,
  submitReviewRpc,
  type Detail,
  type Reaction,
} from "../../shared/contract";
import { Badge, Button } from "./common";
import type { Styles } from "./styles";

type Ui = { theme: PluginTheme; styles: Styles };
type Write = (work: () => Promise<unknown>) => Promise<void>;

/** The emoji GitLab offers first in its picker, by the names its API takes. */
const COMMON_REACTIONS: { name: string; emoji: string }[] = [
  { name: "thumbsup", emoji: "👍" },
  { name: "thumbsdown", emoji: "👎" },
  { name: "smile", emoji: "😄" },
  { name: "tada", emoji: "🎉" },
  { name: "confused", emoji: "😕" },
  { name: "heart", emoji: "❤️" },
  { name: "rocket", emoji: "🚀" },
  { name: "eyes", emoji: "👀" },
];

export function Reactions({ reactions, viewer, onToggle, ui }: {
  reactions: Reaction[];
  viewer: string;
  onToggle: (name: string) => Promise<unknown>;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = (name: string) => {
    setBusy(name);
    setPicking(false);
    void onToggle(name)
      .catch(() => {})
      .finally(() => setBusy(null));
  };
  const chip = (active: boolean) => [
    styles.badge,
    { borderWidth: 1, borderColor: active ? theme.colors.accent : "transparent" },
  ];
  return (
    <View style={[styles.chips, { alignItems: "center" }]}>
      {reactions.map((reaction) => {
        const mine = reaction.users.includes(viewer);
        return (
          <Pressable
            key={reaction.name}
            accessibilityRole="button"
            accessibilityLabel={`${reaction.name} by ${reaction.users.join(", ")}`}
            onPress={() => toggle(reaction.name)}
            disabled={busy !== null}
            style={chip(mine)}
          >
            <Text style={styles.badgeLabel}>
              {reaction.emoji} {reaction.users.length}
            </Text>
          </Pressable>
        );
      })}
      {picking ? (
        COMMON_REACTIONS.filter((option) => !reactions.some((reaction) => reaction.name === option.name)).map((option) => (
          <Pressable
            key={option.name}
            accessibilityRole="button"
            accessibilityLabel={`React with ${option.name}`}
            onPress={() => toggle(option.name)}
            style={chip(false)}
          >
            <Text style={styles.badgeLabel}>{option.emoji}</Text>
          </Pressable>
        ))
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Add a reaction" onPress={() => setPicking(true)} style={chip(false)}>
          <Text style={styles.badgeLabel}>☺︎ +</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Approve, merge, auto-merge and rebase, each shown only when GitLab would accept it. */
export function MergePanel({ detail, write, ui }: { detail: Detail; write: Write; ui: Ui }) {
  const { styles, theme } = ui;
  const runAction = useRpc(mergeRequestActionRpc);
  const [busy, setBusy] = useState<string | null>(null);
  if (detail.kind !== "mr" || detail.state !== "opened") {
    return null;
  }
  const act = (action: "approve" | "unapprove" | "merge" | "auto_merge" | "cancel_auto_merge" | "rebase") => {
    setBusy(action);
    void write(() => runAction({ kind: "mr", projectPath: detail.projectPath, iid: detail.iid, action }))
      .catch(() => {})
      .finally(() => setBusy(null));
  };
  const approvedByMe = detail.approvedBy.includes(detail.viewer);
  const pipelineRunning = detail.pipelineStatus === "RUNNING" || detail.pipelineStatus === "PENDING";
  const canAutoMerge = detail.canMerge && !detail.autoMergeEnabled && detail.autoMergeStrategies.length > 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          <Text style={styles.sectionTitle}>Approvals</Text>
          {detail.approvedBy.length > 0 ? (
            <Text style={[styles.small, { flex: 1 }]}>Approved by {detail.approvedBy.map((name) => `@${name}`).join(", ")}</Text>
          ) : (
            <Text style={[styles.small, { flex: 1 }]}>Not approved yet</Text>
          )}
          {detail.autoMergeEnabled ? <Badge label="Auto-merge on" styles={styles} color={theme.colors.statusSuccess} /> : null}
        </View>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {detail.canApprove || approvedByMe ? (
            <Button
              label={approvedByMe ? "Revoke approval" : "Approve"}
              primary={!approvedByMe}
              busy={busy === "approve" || busy === "unapprove"}
              onPress={() => act(approvedByMe ? "unapprove" : "approve")}
              styles={styles}
              theme={theme}
            />
          ) : null}
          {detail.canMerge && detail.mergeable ? (
            <Button label="Merge" busy={busy === "merge"} onPress={() => act("merge")} styles={styles} theme={theme} />
          ) : null}
          {canAutoMerge && (pipelineRunning || !detail.mergeable) ? (
            <Button
              label="Merge when checks pass"
              busy={busy === "auto_merge"}
              onPress={() => act("auto_merge")}
              styles={styles}
              theme={theme}
            />
          ) : null}
          {detail.autoMergeEnabled && detail.canMerge ? (
            <Button
              label="Cancel auto-merge"
              busy={busy === "cancel_auto_merge"}
              onPress={() => act("cancel_auto_merge")}
              styles={styles}
              theme={theme}
            />
          ) : null}
          {detail.shouldBeRebased && detail.canPush ? (
            <Button
              label={detail.rebaseInProgress ? "Rebasing…" : "Rebase"}
              busy={busy === "rebase"}
              disabled={detail.rebaseInProgress}
              onPress={() => act("rebase")}
              styles={styles}
              theme={theme}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function draftsKey(projectPath: string, iid: string) {
  return ["gitlab", "drafts", projectPath, iid] as const;
}

/**
 * The pending review: comments saved as drafts and published together, the way
 * GitLab's "Finish review" does, so the author gets one notification, not twenty.
 */
export function ReviewBar({ detail, write, ui }: { detail: Detail; write: Write; ui: Ui }) {
  const { styles, theme } = ui;
  const readDrafts = useRpc(draftsRpc);
  const deleteDraft = useRpc(deleteDraftRpc);
  const submitReview = useRpc(submitReviewRpc);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const ref = { projectPath: detail.projectPath, iid: detail.iid };
  const drafts = useQuery({
    queryKey: draftsKey(detail.projectPath, detail.iid),
    queryFn: () => readDrafts(ref),
    enabled: detail.kind === "mr",
  });
  const list = drafts.data?.drafts ?? [];
  if (detail.kind !== "mr" || list.length === 0) {
    return null;
  }
  const run = (label: string, work: () => Promise<unknown>) => {
    setBusy(label);
    void write(async () => {
      await work();
      await queryClient.invalidateQueries({ queryKey: draftsKey(detail.projectPath, detail.iid) });
    })
      .catch(() => {})
      .finally(() => setBusy(null));
  };
  return (
    <View style={[styles.card, { borderColor: theme.colors.accent }]}>
      <View style={styles.cardBody}>
        <Text style={styles.sectionTitle}>
          Your review · {list.length} pending {list.length === 1 ? "comment" : "comments"}
        </Text>
        {list.map((draft) => (
          <View key={draft.id} style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.small}>
                {draft.position
                  ? `📄 ${draft.position.path}:${draft.position.newLine ?? draft.position.oldLine ?? ""}`
                  : draft.discussionId
                    ? "Reply"
                    : "Comment"}
              </Text>
              <Text style={styles.text} numberOfLines={3}>
                {draft.body}
              </Text>
            </View>
            <Button
              label="Discard"
              busy={busy === draft.id}
              onPress={() => run(draft.id, () => deleteDraft({ ...ref, id: draft.id }))}
              styles={styles}
              theme={theme}
            />
          </View>
        ))}
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          <View style={styles.spacer} />
          <Button
            label="Submit review"
            busy={busy === "submit"}
            onPress={() => run("submit", () => submitReview({ ...ref, approve: false }))}
            styles={styles}
            theme={theme}
          />
          {detail.canApprove && !detail.approvedBy.includes(detail.viewer) ? (
            <Button
              label="Submit and approve"
              primary
              busy={busy === "approve"}
              onPress={() => run("approve", () => submitReview({ ...ref, approve: true }))}
              styles={styles}
              theme={theme}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}
