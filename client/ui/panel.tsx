import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { AccountScope, useRpc } from "../account";
import { AccountSwitch } from "./account-switch";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { authStatusRpc, listsRpc, type ItemRef, type Job, type PipelineRef } from "../../shared/contract";
import { openBoard, openDiff, openGitLabSettings, openItem, openRepository } from "../plugin-client";
import { Button, Centered, errorText, HostContext, IconButton } from "./common";
import { ChangesView } from "./changes";
import { CreateView, type CreateTarget } from "./create";
import { WorkspaceCard } from "./workspace-card";
import { ItemDetail } from "./detail";
import { ItemLists } from "./lists";
import { JobLogView, PipelineView } from "./pipeline";
import { LISTS_KEY, LISTS_REFRESH_MS, STATUS_KEY } from "./queries";
import { useStyles } from "./styles";

type Screen =
  | { kind: "item"; ref: ItemRef }
  | { kind: "changes"; ref: ItemRef; focusPath?: string }
  | { kind: "pipeline"; ref: PipelineRef }
  | { kind: "job"; projectPath: string; job: Job; pipelineIid: string | null }
  | { kind: "create"; target: CreateTarget };

export function GitLabPanel(props: PluginWorkspacePanelProps) {
  return (
    <AccountScope workspaceId={props.workspaceId}>
      <GitLabPanelContent {...props} />
    </AccountScope>
  );
}

function GitLabPanelContent({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme);
  const readStatus = useRpc(authStatusRpc);
  const readLists = useRpc(listsRpc);
  const [stack, setStack] = useState<Screen[]>([]);
  const push = (screen: Screen) => setStack((current) => [...current, screen]);
  const back = () => setStack((current) => current.slice(0, -1));
  const replace = (screen: Screen) => setStack((current) => [...current.slice(0, -1), screen]);
  const top = stack[stack.length - 1];

  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => readStatus({}), staleTime: 5 * 60_000 });
  const connected = status.data?.connected === true;
  const lists = useQuery({
    queryKey: LISTS_KEY,
    queryFn: () => readLists({}),
    enabled: connected,
    refetchInterval: LISTS_REFRESH_MS,
  });

  let body: React.ReactNode;
  if (status.isPending) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Connecting to GitLab…</Text>
      </Centered>
    );
  } else if (status.isError) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.error}>{errorText(status.error)}</Text>
        <Button label="Retry" onPress={() => void status.refetch()} styles={styles} theme={theme} />
      </Centered>
    );
  } else if (!status.data.connected) {
    body = (
      <Centered styles={styles}>
        <Text style={[styles.text, { textAlign: "center" }]}>
          {status.data.error ?? "Connect a GitLab account to see your issues and merge requests here."}
        </Text>
        <Button
          label="Open GitLab settings"
          primary
          onPress={openGitLabSettings}
          styles={styles}
          theme={theme}
        />
      </Centered>
    );
  } else if (top?.kind === "item") {
    body = (
      <ItemDetail
        key={`${top.ref.kind}:${top.ref.projectPath}:${top.ref.iid}`}
        itemRef={top.ref}
        onBack={back}
        onOpenPipeline={(ref) => push({ kind: "pipeline", ref })}
        onOpenChanges={(focusPath) => push({ kind: "changes", ref: top.ref, focusPath })}
        onOpenInTab={() => openItem(workspaceId, top.ref)}
        ui={{ theme, styles, host: status.data.host, workspaceId }}
      />
    );
  } else if (top?.kind === "changes") {
    body = (
      <ChangesView
        key={`changes:${top.ref.projectPath}:${top.ref.iid}:${top.focusPath ?? ""}`}
        itemRef={top.ref}
        focusPath={top.focusPath}
        onBack={back}
        onOpenWide={() => openDiff(workspaceId, top.ref)}
        ui={{ theme, styles, host: status.data.host, workspaceId }}
      />
    );
  } else if (top?.kind === "pipeline") {
    body = (
      <PipelineView
        key={`${top.ref.projectPath}:${top.ref.iid}`}
        pipelineRef={top.ref}
        onBack={back}
        onOpenLog={(projectPath, job, pipelineIid) => push({ kind: "job", projectPath, job, pipelineIid })}
        onOpenPipeline={(ref) => push({ kind: "pipeline", ref })}
        ui={{ theme, styles, workspaceId }}
      />
    );
  } else if (top?.kind === "create") {
    body = (
      <CreateView
        target={top.target}
        onBack={back}
        onCreated={(ref) => replace({ kind: "item", ref })}
        ui={{ theme, styles, host: status.data.host, workspaceId }}
      />
    );
  } else if (top?.kind === "job") {
    body = (
      <JobLogView
        key={top.job.id}
        projectPath={top.projectPath}
        job={top.job}
        pipelineIid={top.pipelineIid}
        onBack={back}
        ui={{ theme, styles, workspaceId }}
      />
    );
  } else if (lists.isPending) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Loading…</Text>
      </Centered>
    );
  } else if (lists.isError) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.error}>{errorText(lists.error)}</Text>
        <Button label="Retry" onPress={() => void lists.refetch()} styles={styles} theme={theme} />
      </Centered>
    );
  } else {
    body = (
      <View style={{ gap: 8 }}>
        <View style={styles.row}>
          <AccountSwitch username={status.data.user.username} ui={{ theme, styles }} />
          <View style={styles.spacer} />
          <IconButton
            icon="Plus"
            label="New issue"
            onPress={() =>
              push({
                kind: "create",
                target: {
                  mode: "issue",
                  projectPath:
                    lists.data.mergeRequests[0]?.projectPath ?? lists.data.issues[0]?.projectPath ?? "",
                },
              })
            }
            theme={theme}
            styles={styles}
          />
          <IconButton
            icon="Kanban"
            label="Open the issue board"
            onPress={() => openBoard(workspaceId)}
            theme={theme}
            styles={styles}
          />
          <IconButton
            icon="FolderGit2"
            label="Browse the repository"
            onPress={() => openRepository(workspaceId)}
            theme={theme}
            styles={styles}
          />
          <IconButton
            icon="RefreshCw"
            label="Refresh"
            onPress={() => void lists.refetch()}
            disabled={lists.isFetching}
            theme={theme}
            styles={styles}
          />
          <IconButton
            icon="Settings"
            label="GitLab settings"
            onPress={openGitLabSettings}
            theme={theme}
            styles={styles}
          />
        </View>
        <WorkspaceCard
          onOpen={(ref) => push({ kind: "item", ref })}
          onCreateMergeRequest={(target) => push({ kind: "create", target: { mode: "mr", ...target } })}
          ui={{ theme, styles, host: status.data.host, workspaceId }}
        />
        <ItemLists
          lists={lists.data}
          onOpen={(ref) => push({ kind: "item", ref })}
          ui={{ theme, styles, viewer: status.data.user.username }}
        />
      </View>
    );
  }

  return (
    <HostContext.Provider value={status.data?.connected ? status.data.host : ""}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
        {body}
      </ScrollView>
    </HostContext.Provider>
  );
}
