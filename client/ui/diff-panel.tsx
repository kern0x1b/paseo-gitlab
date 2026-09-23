import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { authStatusRpc, detailRpc, listsRpc, type ItemRef, type ListItem } from "../../shared/contract";
import { setCommentDestination, setDiffTarget, useWorkspaceDiffState, type CommentDestination } from "../diff-target";
import { ChangesView } from "./changes";
import { Button, Centered, errorText, HostContext, IconButton } from "./common";
import type { Ui } from "./detail";
import { shortReference } from "./format";
import { detailKey, LISTS_KEY, STATUS_KEY } from "./queries";
import { useStyles } from "./styles";

interface AgentOption {
  id: string;
  title: string;
  status: string;
}

function useWorkspaceAgents(workspaceId: string) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["gitlab", "diff-agents", workspaceId],
    refetchInterval: 30_000,
    queryFn: async (): Promise<AgentOption[]> => {
      const result = await paseo.agents.list({ scope: "active", page: { limit: 200 } });
      return result.entries
        .map(({ agent }) => agent)
        .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
        .sort((a, b) => (b.lastUserMessageAt ?? b.updatedAt).localeCompare(a.lastUserMessageAt ?? a.updatedAt))
        .map((agent) => ({ id: agent.id, title: agent.title ?? "Untitled agent", status: agent.status }));
    },
  });
}

/** Where line comments go: an agent of this workspace, or GitLab at once or into your review. */
function DestinationBar({
  workspaceId,
  destination,
  agents,
  ui,
}: {
  workspaceId: string;
  destination: CommentDestination;
  agents: AgentOption[];
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const chip = (active: boolean) => [
    styles.badge,
    { paddingVertical: 4, paddingHorizontal: 10 },
    active ? { backgroundColor: theme.colors.accent } : null,
  ];
  const chipLabel = (active: boolean) => [styles.badgeLabel, active ? { color: theme.colors.accentForeground } : null];
  const selectedAgent = destination.kind === "agent" ? (destination.agentId ?? agents[0]?.id ?? null) : null;
  return (
    <View style={[styles.card]}>
      <View style={styles.cardBody}>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          <Text style={styles.sectionTitle}>Comments go to</Text>
          <View style={styles.tabs}>
            {(["agent", "gitlab"] as const).map((kind) => {
              const active = destination.kind === kind;
              return (
                <Pressable
                  key={kind}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() =>
                    setCommentDestination(
                      workspaceId,
                      kind === "agent" ? { kind, agentId: selectedAgent } : { kind, asDraft: false },
                    )
                  }
                  style={[styles.tab, { paddingHorizontal: 12 }, active ? styles.tabActive : null]}
                >
                  <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
                    {kind === "agent" ? "Your agent" : "GitLab"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {destination.kind === "agent" ? (
          agents.length === 0 ? (
            <Text style={styles.muted}>No agent in this workspace yet. Start one, then pick it here.</Text>
          ) : (
            <View style={[styles.chips, { alignItems: "center" }]}>
              {agents.map((agent) => {
                const active = agent.id === selectedAgent;
                return (
                  <Pressable
                    key={agent.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    onPress={() => setCommentDestination(workspaceId, { kind: "agent", agentId: agent.id })}
                    style={chip(active)}
                  >
                    <Text style={chipLabel(active)} numberOfLines={1}>
                      {agent.title} · {agent.status}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )
        ) : (
          <View style={[styles.chips, { alignItems: "center" }]}>
            {[false, true].map((asDraft) => {
              const active = destination.asDraft === asDraft;
              return (
                <Pressable
                  key={String(asDraft)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => setCommentDestination(workspaceId, { kind: "gitlab", asDraft })}
                  style={chip(active)}
                >
                  <Text style={chipLabel(active)}>{asDraft ? "Into my review (publish later)" : "Publish at once"}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
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
  const items: ListItem[] = lists.data ? [...lists.data.mergeRequests, ...lists.data.reviewMergeRequests] : [];
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

/**
 * An MR's changes in the workspace's main area, next to its agents. Line comments
 * go to one of this workspace's agents, with the file, lines and code attached,
 * or to GitLab, at once or into your pending review.
 */
export function DiffPanel({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme);
  const paseo = usePaseo();
  const toast = useToast();
  const readStatus = useRpc(authStatusRpc);
  const readDetail = useRpc(detailRpc);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => readStatus({}), staleTime: 5 * 60_000 });
  const { target, destination } = useWorkspaceDiffState(workspaceId);
  const agents = useWorkspaceAgents(workspaceId);
  const [picking, setPicking] = useState(false);
  const detail = useQuery({
    queryKey: target ? detailKey(target) : ["gitlab", "detail", "none"],
    queryFn: () => readDetail(target!),
    enabled: Boolean(target) && status.data?.connected === true,
  });

  const host = status.data?.connected ? status.data.host : "";
  const ui: Ui = { theme, styles, host, workspaceId };
  const agentId = destination.kind === "agent" ? (destination.agentId ?? agents.data?.[0]?.id ?? null) : null;
  const agentTitle = agents.data?.find((agent) => agent.id === agentId)?.title ?? "the agent";

  let body: React.ReactNode;
  if (status.isPending) {
    body = <Text style={styles.muted}>Connecting to GitLab…</Text>;
  } else if (!status.data?.connected) {
    body = <Text style={styles.muted}>Connect GitLab in Settings → GitLab first.</Text>;
  } else if (!target) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.text}>Pick a merge request to review its changes here.</Text>
        <Button label="Choose a merge request" primary onPress={() => setPicking(true)} styles={styles} theme={theme} />
      </Centered>
    );
  } else {
    body = (
      <ChangesView
        key={`${target.projectPath}:${target.iid}`}
        itemRef={target}
        destination={destination}
        toAgent={
          agentId
            ? async (text) => {
                try {
                  await paseo.agents.ref(agentId).send(text);
                  toast.show(`Sent to ${agentTitle}`, { variant: "success" });
                } catch (error) {
                  toast.error(errorText(error));
                  throw error;
                }
              }
            : undefined
        }
        header={
          <View style={{ gap: 12 }}>
            <View style={styles.row}>
              <Text style={styles.muted}>{detail.data?.reference ?? `!${target.iid}`}</Text>
              <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
                {detail.data?.title ?? ""}
              </Text>
              <Button label="Other MR" onPress={() => setPicking(true)} styles={styles} theme={theme} />
              {detail.data ? (
                <IconButton
                  icon="ExternalLink"
                  label="Open the changes in GitLab"
                  onPress={() => void openExternalUrl(`${detail.data!.webUrl}/diffs`)}
                  theme={theme}
                  styles={styles}
                />
              ) : null}
            </View>
            <DestinationBar workspaceId={workspaceId} destination={destination} agents={agents.data ?? []} ui={ui} />
          </View>
        }
        ui={ui}
      />
    );
  }

  return (
    <HostContext.Provider value={host}>
      <ScrollView style={styles.screen} contentContainerStyle={[styles.scroll, { padding: 16 }]}>
        {body}
      </ScrollView>
      <MergeRequestPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(ref) => setDiffTarget(workspaceId, ref)}
        ui={ui}
      />
    </HostContext.Provider>
  );
}
