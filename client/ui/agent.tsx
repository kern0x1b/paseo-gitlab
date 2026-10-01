import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { useRpc } from "../account";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { agentPromptRpc, type ItemRef } from "../../shared/contract";
import { Button, errorText, IconButton } from "./common";
import { timeAgo } from "./format";
import type { Styles } from "./styles";

type Ui = { theme: PluginTheme; styles: Styles };

export type AgentSubject =
  | { item: ItemRef }
  | { conflicts: ItemRef }
  | { job: { projectPath: string; jobId: string; name: string; webUrl: string; pipelineIid: string | null } };

interface AgentChoice {
  id: string;
  title: string;
  provider: string;
  model: string | null;
  modeId: string | null;
  thinkingOptionId: string | null;
  status: string;
  lastActivityAt: string;
}

function AgentPicker({
  open,
  onClose,
  workspaceId,
  subject,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  subject: AgentSubject;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const paseo = usePaseo();
  const buildPrompt = useRpc(agentPromptRpc);
  const toast = useToast();
  const [sending, setSending] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ["gitlab", "agents", workspaceId],
    enabled: open,
    queryFn: async (): Promise<{ here: AgentChoice[]; template: AgentChoice | null }> => {
      const result = await paseo.agents.list({ scope: "active", page: { limit: 200 } });
      const all = result.entries
        .map(({ agent }) => agent)
        .filter((agent) => !agent.archivedAt)
        .map((agent) => ({
          id: agent.id,
          title: agent.title ?? "Untitled agent",
          provider: agent.provider,
          model: agent.model ?? null,
          modeId: agent.currentModeId ?? null,
          thinkingOptionId: agent.thinkingOptionId ?? null,
          status: agent.status,
          lastActivityAt: agent.lastUserMessageAt ?? agent.updatedAt,
          workspaceId: agent.workspaceId ?? null,
        }))
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      const here = all.filter((agent) => agent.workspaceId === workspaceId);
      return { here, template: here[0] ?? all[0] ?? null };
    },
  });

  const send = async (target: AgentChoice | "new") => {
    setSending(target === "new" ? "new" : target.id);
    try {
      const prompt = await buildPrompt(subject);
      if (target === "new") {
        const template = agents.data?.template;
        if (!template?.model) {
          throw new Error(
            "Start an agent in Paseo once, so a new one knows which provider and model to use.",
          );
        }
        await paseo.workspaces.ref(workspaceId).agents.create({
          config: {
            provider: `${template.provider}/${template.model}`,
            ...(template.modeId ? { modeId: template.modeId } : {}),
            ...(template.thinkingOptionId ? { thinkingOptionId: template.thinkingOptionId } : {}),
          },
          title: prompt.title,
          prompt: prompt.text,
        });
        toast.show("Started a new agent", { variant: "success" });
      } else {
        await paseo.agents.ref(target.id).send(prompt.text);
        toast.show(`Sent to ${target.title}`, { variant: "success" });
      }
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSending(null);
    }
  };

  return (
    <Modal title="Send to an agent" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <Text style={styles.muted}>
          {"conflicts" in subject
            ? "The agent merges the target branch into the source branch in its checkout, resolves the conflicts and pushes."
            : "The agent gets the link, the description, every unresolved thread and the log of each failed job."}
        </Text>
        <View style={styles.card}>
          {agents.isPending ? (
            <Text style={[styles.muted, { padding: 8 }]}>Loading agents…</Text>
          ) : agents.isError ? (
            <Text style={[styles.error, { padding: 8 }]}>{errorText(agents.error)}</Text>
          ) : agents.data.here.length === 0 ? (
            <Text style={[styles.muted, { padding: 8 }]}>No agents in this workspace yet.</Text>
          ) : (
            agents.data.here.map((agent) => (
              <Pressable
                key={agent.id}
                accessibilityRole="button"
                onPress={() => void send(agent)}
                disabled={sending !== null}
                style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
              >
                <View style={styles.row}>
                  <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
                    {agent.title}
                  </Text>
                  <Text style={styles.small}>
                    {sending === agent.id ? "Sending…" : `${agent.status} · ${timeAgo(agent.lastActivityAt)}`}
                  </Text>
                </View>
                <Text style={styles.small} numberOfLines={1}>
                  {agent.provider}
                  {agent.model ? ` · ${agent.model}` : ""}
                </Text>
              </Pressable>
            ))
          )}
        </View>
        <View style={styles.row}>
          <View style={styles.spacer} />
          <Button label="Cancel" onPress={onClose} styles={styles} theme={theme} />
          <Button
            label="New agent"
            primary
            busy={sending === "new"}
            disabled={agents.isPending || sending !== null}
            onPress={() => void send("new")}
            styles={styles}
            theme={theme}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

export function SendToAgentButton({
  workspaceId,
  subject,
  label,
  ui,
}: {
  workspaceId: string;
  subject: AgentSubject;
  label?: string;
  ui: Ui;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {label ? (
        <Button label={label} onPress={() => setOpen(true)} styles={ui.styles} theme={ui.theme} />
      ) : (
        <IconButton
          icon="Bot"
          label="Send to an agent"
          onPress={() => setOpen(true)}
          theme={ui.theme}
          styles={ui.styles}
        />
      )}
      <AgentPicker
        open={open}
        onClose={() => setOpen(false)}
        workspaceId={workspaceId}
        subject={subject}
        ui={ui}
      />
    </>
  );
}
