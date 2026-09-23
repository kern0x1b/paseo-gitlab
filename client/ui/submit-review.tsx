import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { addCodeCommentRpc, addDraftRpc, submitReviewRpc, type Detail } from "../../shared/contract";
import { removePendingComments, type PendingComment } from "../review-store";
import { rangeLabel, reviewMessage } from "./code-comment";
import { Button, errorText } from "./common";
import type { Ui } from "./detail";
import { detailKey } from "./queries";
import { draftsKey } from "./review";

interface AgentOption {
  id: string;
  title: string;
  status: string;
}

function Choice({ selected, title, description, onPress, ui }: {
  selected: boolean;
  title: string;
  description: string;
  onPress: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{ flexDirection: "row", gap: 10, paddingVertical: 4 }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          marginTop: 2,
          borderRadius: 8,
          borderWidth: selected ? 5 : 1.5,
          borderColor: selected ? theme.colors.accent : theme.colors.foregroundMuted,
        }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.text, { fontWeight: "500" }]}>{title}</Text>
        <Text style={styles.small}>{description}</Text>
      </View>
    </Pressable>
  );
}

/**
 * "Submit your review", as GitLab does it, with a second destination: the
 * collected comments go either to one of this workspace's agents, as one message
 * with every file, line and code excerpt, or to GitLab as your review, published
 * together so the author gets one notification.
 */
export function SubmitReview({ open, onClose, detail, comments, reviewId, workspaceId, ui }: {
  open: boolean;
  onClose: () => void;
  detail: Detail;
  comments: PendingComment[];
  reviewId: string;
  workspaceId: string;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const paseo = usePaseo();
  const toast = useToast();
  const queryClient = useQueryClient();
  const addCodeComment = useRpc(addCodeCommentRpc);
  const addDraft = useRpc(addDraftRpc);
  const submitReview = useRpc(submitReviewRpc);
  const [target, setTarget] = useState<"agent" | "gitlab">("agent");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [approve, setApprove] = useState(false);
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const agents = useQuery({
    queryKey: ["gitlab", "review-agents", workspaceId],
    enabled: open,
    queryFn: async (): Promise<AgentOption[]> => {
      const result = await paseo.agents.list({ scope: "active", page: { limit: 200 } });
      return result.entries
        .map(({ agent }) => agent)
        .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
        .sort((a, b) => (b.lastUserMessageAt ?? b.updatedAt).localeCompare(a.lastUserMessageAt ?? a.updatedAt))
        .map((agent) => ({ id: agent.id, title: agent.title ?? "Untitled agent", status: agent.status }));
    },
  });
  const chosenAgent = agentId ?? agents.data?.[0]?.id ?? null;

  const submit = async () => {
    setSubmitting(true);
    try {
      if (target === "agent") {
        if (!chosenAgent) {
          throw new Error("There is no agent in this workspace to send the review to.");
        }
        await paseo.agents.ref(chosenAgent).send(reviewMessage(detail, comments, summary));
        removePendingComments(reviewId);
        toast.show(`Review sent to ${agents.data?.find((agent) => agent.id === chosenAgent)?.title ?? "the agent"}`, {
          variant: "success",
        });
      } else {
        if (!detail.diffRefs) {
          throw new Error("GitLab did not report the commits this MR compares.");
        }
        const ref = { projectPath: detail.projectPath, iid: detail.iid };
        // One draft per comment, then one publish: GitLab sends a single notification for the lot.
        for (const comment of comments) {
          const first = comment.lines[0]!;
          const last = comment.lines[comment.lines.length - 1]!;
          const pick = ({ kind, oldLine, newLine, oldPos, newPos }: typeof first) => ({ kind, oldLine, newLine, oldPos, newPos });
          await addCodeComment({
            ...ref,
            body: comment.body,
            diffRefs: detail.diffRefs,
            oldPath: comment.oldPath,
            newPath: comment.newPath,
            start: pick(first),
            end: pick(last),
            asDraft: true,
          });
          // Taken off the local list as soon as GitLab holds it, so a failure halfway loses nothing.
          removePendingComments(reviewId, [comment.id]);
        }
        if (summary.trim()) {
          await addDraft({ ...ref, body: summary.trim() });
        }
        await submitReview({ ...ref, approve });
        await queryClient.invalidateQueries({ queryKey: detailKey(detail) });
        await queryClient.invalidateQueries({ queryKey: draftsKey(detail.projectPath, detail.iid) });
        toast.show(approve ? "Review published and approved" : "Review published", { variant: "success" });
      }
      setSummary("");
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Submit your review" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <Text style={styles.sectionTitle}>Send to</Text>
        <Choice
          selected={target === "agent"}
          title="Your agent"
          description="Every comment, with its file, lines and code, goes to one of this workspace's agents. Nothing is posted to GitLab."
          onPress={() => setTarget("agent")}
          ui={ui}
        />
        {target === "agent" ? (
          <View style={{ paddingLeft: 26, gap: 2 }}>
            {agents.isPending ? <Text style={styles.small}>Loading agents…</Text> : null}
            {agents.data?.length === 0 ? (
              <Text style={styles.small}>No agent in this workspace yet. Start one, or publish to GitLab.</Text>
            ) : null}
            {agents.data?.map((agent) => (
              <Choice
                key={agent.id}
                selected={agent.id === chosenAgent}
                title={agent.title}
                description={agent.status}
                onPress={() => setAgentId(agent.id)}
                ui={ui}
              />
            ))}
          </View>
        ) : null}
        <Choice
          selected={target === "gitlab"}
          title="GitLab"
          description={`Published on ${detail.reference} as your review, with one notification for everyone on it.`}
          onPress={() => setTarget("gitlab")}
          ui={ui}
        />
        {target === "gitlab" ? (
          <View style={{ paddingLeft: 26 }}>
            <Choice
              selected={!approve}
              title="Comment"
              description="Submit the comments without an approval."
              onPress={() => setApprove(false)}
              ui={ui}
            />
            {detail.canApprove && !detail.approvedBy.includes(detail.viewer) ? (
              <Choice
                selected={approve}
                title="Approve"
                description="Submit the comments and approve these changes."
                onPress={() => setApprove(true)}
                ui={ui}
              />
            ) : null}
          </View>
        ) : null}
        <TextInput
          value={summary}
          onChangeText={setSummary}
          placeholder="Add an optional summary…"
          placeholderTextColor={theme.colors.foregroundMuted}
          multiline
          style={[styles.input, { minHeight: 56 }]}
        />
        <View style={styles.row}>
          <Button
            label={target === "agent" ? "Send to agent" : approve ? "Submit and approve" : "Submit review"}
            primary
            busy={submitting}
            disabled={comments.length === 0 || (target === "agent" && !chosenAgent)}
            onPress={() => void submit()}
            styles={styles}
            theme={theme}
          />
          <Button label="Continue review" onPress={onClose} styles={styles} theme={theme} />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={[styles.text, { fontWeight: "600", flex: 1 }]}>
            {comments.length} pending {comments.length === 1 ? "comment" : "comments"}
          </Text>
          {comments.length > 0 ? (
            <Button
              label="Discard review"
              onPress={() => {
                removePendingComments(reviewId);
                onClose();
              }}
              styles={styles}
              theme={theme}
            />
          ) : null}
        </View>
        {comments.map((comment) => (
          <View key={comment.id} style={{ gap: 2 }}>
            <Text style={[styles.small, { color: theme.colors.accent }]} numberOfLines={1}>
              📄 {comment.newPath} · {rangeLabel(comment.lines)}
            </Text>
            <Text style={styles.text} numberOfLines={3}>
              {comment.body}
            </Text>
          </View>
        ))}
      </Modal.Content>
    </Modal>
  );
}
