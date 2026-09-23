import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { workspaceRpc, type ItemRef } from "../../shared/contract";
import { SendToAgentButton } from "./agent";
import { openDiff } from "../plugin-client";
import { Badge, Button, IconButton, PipelineDot } from "./common";
import type { Ui } from "./detail";
import { humanize, mergeStatusLabel, shortReference } from "./format";

export function workspaceKey(directory: string) {
  return ["gitlab", "workspace", directory] as const;
}

/**
 * The MR of the branch this workspace is on, above the lists: its pipeline, what
 * is still unresolved, and a way to hand it to an agent. Nothing is shown for a
 * workspace that is not a checkout of a project on the connected GitLab.
 */
export function WorkspaceCard({
  onOpen,
  onCreateMergeRequest,
  ui,
}: {
  onOpen: (ref: ItemRef) => void;
  onCreateMergeRequest: (input: { projectPath: string; sourceBranch: string; targetBranch: string }) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const directory = useWorkspace(ui.workspaceId, (workspace) => workspace.directory);
  const readWorkspace = useRpc(workspaceRpc);
  const query = useQuery({
    queryKey: workspaceKey(directory ?? ""),
    queryFn: () => readWorkspace({ directory: directory ?? "" }),
    enabled: Boolean(directory),
    refetchInterval: 60_000,
  });
  const state = query.data;
  if (!state?.checkout) {
    return null;
  }
  const { checkout, mergeRequest } = state;
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>This workspace</Text>
          <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
            {checkout.branch}
          </Text>
          {mergeRequest ? (
            <IconButton
              icon="FileDiff"
              label="Open the diff in the main area"
              onPress={() =>
                openDiff(ui.workspaceId, {
                  kind: "mr",
                  projectPath: mergeRequest.projectPath,
                  iid: mergeRequest.iid,
                })
              }
              theme={theme}
              styles={styles}
            />
          ) : null}
          {mergeRequest ? (
            <SendToAgentButton
              workspaceId={ui.workspaceId}
              subject={{ item: { kind: "mr", projectPath: mergeRequest.projectPath, iid: mergeRequest.iid } }}
              ui={ui}
            />
          ) : null}
        </View>
        {mergeRequest ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${mergeRequest.reference}`}
            onPress={() =>
              onOpen({ kind: "mr", projectPath: mergeRequest.projectPath, iid: mergeRequest.iid })
            }
            style={({ pressed }) => [{ gap: 4 }, pressed ? styles.listRowPressed : null]}
          >
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              <PipelineDot status={mergeRequest.pipelineStatus} theme={theme} styles={styles} />
              <Text style={styles.muted}>{shortReference(mergeRequest.reference)}</Text>
              {mergeRequest.pipelineStatus ? (
                <Text style={styles.small}>
                  pipeline {humanize(mergeRequest.pipelineStatus).toLowerCase()}
                </Text>
              ) : null}
              {state.unresolvedThreads > 0 ? (
                <Badge
                  label={`${state.unresolvedThreads} unresolved`}
                  styles={styles}
                  color={theme.colors.statusWarning}
                />
              ) : null}
            </View>
            <Text style={styles.listTitle} numberOfLines={2}>
              {mergeRequest.title}
            </Text>
            {mergeStatusLabel(mergeRequest.mergeStatus) ? (
              <Text style={styles.small}>{mergeStatusLabel(mergeRequest.mergeStatus)}</Text>
            ) : null}
          </Pressable>
        ) : checkout.branch !== state.defaultBranch ? (
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            <Text style={[styles.muted, { flex: 1 }]}>No open merge request for this branch.</Text>
            <Button
              label="Create merge request"
              onPress={() =>
                onCreateMergeRequest({
                  projectPath: checkout.projectPath,
                  sourceBranch: checkout.branch,
                  targetBranch: state.defaultBranch ?? "main",
                })
              }
              styles={styles}
              theme={theme}
            />
          </View>
        ) : (
          <Text style={styles.muted}>On the default branch.</Text>
        )}
      </View>
    </View>
  );
}
