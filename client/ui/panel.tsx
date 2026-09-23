import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { authStatusRpc, listsRpc, type ItemRef, type Job, type PipelineRef } from "../../shared/contract";
import { openGitLabSettings } from "../plugin-client";
import { Button, Centered, errorText, IconButton } from "./common";
import { ChangesView } from "./changes";
import { ItemDetail } from "./detail";
import { ItemLists } from "./lists";
import { JobLogView, PipelineView } from "./pipeline";
import { LISTS_KEY, LISTS_REFRESH_MS, STATUS_KEY } from "./queries";
import { useStyles } from "./styles";

/** What the panel shows, as a stack: back pops one level. */
type Screen =
  | { kind: "item"; ref: ItemRef }
  | { kind: "changes"; ref: ItemRef; focusPath?: string }
  | { kind: "pipeline"; ref: PipelineRef }
  | { kind: "job"; projectPath: string; job: Job };

/**
 * The GitLab panel: the lists, and whatever was opened from them in their place. It lives
 * in the explorer sidebar by default and can be moved to the main panel, where the
 * same component simply gets more width.
 */
export function GitLabPanel({ theme }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme);
  const readStatus = useRpc(authStatusRpc);
  const readLists = useRpc(listsRpc);
  const [stack, setStack] = useState<Screen[]>([]);
  const push = (screen: Screen) => setStack((current) => [...current, screen]);
  const back = () => setStack((current) => current.slice(0, -1));
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
        ui={{ theme, styles, host: status.data.host }}
      />
    );
  } else if (top?.kind === "changes") {
    body = (
      <ChangesView
        key={`changes:${top.ref.projectPath}:${top.ref.iid}:${top.focusPath ?? ""}`}
        itemRef={top.ref}
        focusPath={top.focusPath}
        onBack={back}
        ui={{ theme, styles, host: status.data.host }}
      />
    );
  } else if (top?.kind === "pipeline") {
    body = (
      <PipelineView
        key={`${top.ref.projectPath}:${top.ref.iid}`}
        pipelineRef={top.ref}
        onBack={back}
        onOpenLog={(projectPath, job) => push({ kind: "job", projectPath, job })}
        onOpenPipeline={(ref) => push({ kind: "pipeline", ref })}
        ui={{ theme, styles }}
      />
    );
  } else if (top?.kind === "job") {
    body = <JobLogView key={top.job.id} projectPath={top.projectPath} job={top.job} onBack={back} ui={{ theme, styles }} />;
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
          <Text style={styles.muted} numberOfLines={1}>
            @{status.data.user.username}
          </Text>
          <View style={styles.spacer} />
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
        <ItemLists lists={lists.data} onOpen={(ref) => push({ kind: "item", ref })} ui={{ theme, styles }} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      {body}
    </ScrollView>
  );
}
