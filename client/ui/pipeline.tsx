import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { Fragment, useRef, useState } from "react";
import { Platform, Pressable, ScrollView as NativeScrollView, Text, View } from "react-native";
import {
  jobActionRpc,
  jobLogRpc,
  pipelineActionRpc,
  pipelineRpc,
  runPipelineRpc,
  type Job,
  type LogColor,
  type Pipeline,
  type PipelineRef,
} from "../../shared/contract";
import { SendToAgentButton } from "./agent";
import { Badge, Button, Centered, ConfirmButton, errorText, IconButton, PipelineDot } from "./common";
import { formatDuration, formatSize, humanize, isActive, shortSha, timeAgo } from "./format";
import { jobLogKey, pipelineKey } from "./queries";
import type { Styles } from "./styles";

type Ui = { theme: PluginTheme; styles: Styles; workspaceId: string };

/** Fast while something is moving, slow once it has settled. */
const ACTIVE_REFRESH_MS = 5_000;
const IDLE_REFRESH_MS = 30_000;

const MONO = Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "Menlo" });

/** `refs/merge-requests/46577/head` → `!46577`; branches and tags stay as they are. */
function refLabel(ref: string): string {
  const mergeRequest = ref.match(/^refs\/merge-requests\/(\d+)\//);
  return mergeRequest ? `!${mergeRequest[1]}` : ref.replace(/^refs\/(heads|tags)\//, "");
}

function JobRow({
  job,
  onOpenLog,
  onOpenPipeline,
  onAction,
  busy,
  ui,
}: {
  job: Job;
  onOpenLog: (job: Job) => void;
  onOpenPipeline: (ref: PipelineRef) => void;
  onAction: (job: Job, action: "retry" | "play" | "cancel") => void;
  busy: boolean;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const downstream = job.downstream;
  const trailing =
    job.duration != null
      ? formatDuration(job.duration)
      : job.manual
        ? "manual"
        : humanize(job.status).toLowerCase();
  const action = job.playable ? "play" : job.cancelable ? "cancel" : job.retryable ? "retry" : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.name} ${job.status}`}
      onPress={() => (downstream ? onOpenPipeline(downstream) : onOpenLog(job))}
      style={({ pressed }) => [
        styles.listRow,
        { flexDirection: "row", alignItems: "center", gap: 8 },
        pressed ? styles.listRowPressed : null,
      ]}
    >
      <PipelineDot status={job.status} theme={theme} styles={styles} />
      <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
        {job.name}
        {downstream ? " ›" : ""}
      </Text>
      {job.allowFailure && job.status === "FAILED" ? (
        <Badge label="allowed to fail" styles={styles} color={theme.colors.statusWarning} />
      ) : null}
      <Text style={styles.small}>{trailing}</Text>
      {action ? (
        <IconButton
          icon={action === "play" ? "Play" : action === "cancel" ? "Square" : "RotateCcw"}
          label={`${humanize(action)} ${job.name}`}
          onPress={() => onAction(job, action)}
          disabled={busy}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </Pressable>
  );
}

export function PipelineView({
  pipelineRef,
  onBack,
  onOpenLog,
  onOpenPipeline,
  ui,
}: {
  pipelineRef: PipelineRef;
  onBack: () => void;
  onOpenLog: (projectPath: string, job: Job, pipelineIid: string) => void;
  onOpenPipeline: (ref: PipelineRef) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readPipeline = useRpc(pipelineRpc);
  const runJobAction = useRpc(jobActionRpc);
  const runPipelineAction = useRpc(pipelineActionRpc);
  const runPipeline = useRpc(runPipelineRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: pipelineKey(pipelineRef),
    queryFn: () => readPipeline(pipelineRef),
    refetchInterval: (current) =>
      isActive(current.state.data?.status) ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: pipelineKey(pipelineRef) });
  const jobAction = useMutation({
    mutationFn: (input: { jobId: string; action: "retry" | "play" | "cancel" }) => runJobAction(input),
    onSuccess: refresh,
    onError: (error) => toast.error(errorText(error)),
  });
  const runAgain = useMutation({
    mutationFn: (ref: string) => runPipeline({ projectPath: pipelineRef.projectPath, ref }),
    onSuccess: (next) => onOpenPipeline(next),
    onError: (error) => toast.error(errorText(error)),
  });
  const pipelineAction = useMutation({
    mutationFn: (input: { pipelineId: string; action: "retry" | "cancel" }) => runPipelineAction(input),
    onSuccess: refresh,
    onError: (error) => toast.error(errorText(error)),
  });

  if (query.isPending) {
    return (
      <Centered styles={styles}>
        <Text style={styles.muted}>Loading the pipeline…</Text>
      </Centered>
    );
  }
  if (query.isError) {
    return (
      <Centered styles={styles}>
        <Text style={styles.error}>{errorText(query.error)}</Text>
        <View style={styles.row}>
          <Button label="Back" onPress={onBack} styles={styles} theme={theme} />
          <Button label="Retry" onPress={() => void query.refetch()} styles={styles} theme={theme} />
        </View>
      </Centered>
    );
  }

  const pipeline: Pipeline = query.data;
  const jobCount = pipeline.stages.reduce((total, stage) => total + stage.jobs.length, 0);
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.row}>
        <IconButton icon="ChevronLeft" label="Back" onPress={onBack} theme={theme} styles={styles} />
        <Text style={styles.muted} numberOfLines={1}>
          Pipeline #{pipeline.iid}
        </Text>
        <View style={styles.spacer} />
        <IconButton
          icon="RefreshCw"
          label="Refresh"
          onPress={() => void query.refetch()}
          disabled={query.isFetching}
          theme={theme}
          styles={styles}
        />
        <IconButton
          icon="ExternalLink"
          label="Open in GitLab"
          onPress={() => void openExternalUrl(pipeline.webUrl)}
          theme={theme}
          styles={styles}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.cardBody}>
          <View style={styles.row}>
            <PipelineDot status={pipeline.status} theme={theme} styles={styles} />
            <Text style={styles.title}>
              {pipeline.statusLabel ? humanize(pipeline.statusLabel) : humanize(pipeline.status)}
            </Text>
          </View>
          <Text style={styles.muted}>
            {[
              refLabel(pipeline.ref),
              shortSha(pipeline.sha),
              pipeline.duration != null ? formatDuration(pipeline.duration) : null,
              `${jobCount} jobs`,
              pipeline.user ? `@${pipeline.user.username}` : null,
              timeAgo(pipeline.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {!pipeline.ref.startsWith("refs/merge-requests/") && pipeline.ref ? (
            <View style={styles.row}>
              <ConfirmButton
                label="Run again"
                title="Run a new pipeline?"
                message={`GitLab starts a new pipeline for ${refLabel(pipeline.ref)}. It uses runner time like any other run.`}
                confirmLabel="Run pipeline"
                busy={runAgain.isPending}
                onConfirm={() => runAgain.mutate(refLabel(pipeline.ref))}
                styles={styles}
                theme={theme}
              />
            </View>
          ) : null}
          {pipeline.retryable || pipeline.cancelable ? (
            <View style={styles.row}>
              {pipeline.retryable ? (
                <Button
                  label="Retry failed jobs"
                  busy={pipelineAction.isPending && pipelineAction.variables?.action === "retry"}
                  onPress={() => pipelineAction.mutate({ pipelineId: pipeline.id, action: "retry" })}
                  styles={styles}
                  theme={theme}
                />
              ) : null}
              {pipeline.cancelable ? (
                <Button
                  label="Cancel pipeline"
                  busy={pipelineAction.isPending && pipelineAction.variables?.action === "cancel"}
                  onPress={() => pipelineAction.mutate({ pipelineId: pipeline.id, action: "cancel" })}
                  styles={styles}
                  theme={theme}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {pipeline.stages.map((stage) => (
        <View key={stage.name} style={styles.card}>
          <View style={[styles.cardBody, styles.row]}>
            <PipelineDot status={stage.status.toUpperCase()} theme={theme} styles={styles} />
            <Text style={styles.sectionTitle}>{stage.name}</Text>
            <View style={styles.spacer} />
            <Text style={styles.small}>{humanize(stage.status)}</Text>
          </View>
          {stage.jobs.map((job) => (
            <Fragment key={job.id}>
              <View style={styles.divider} />
              <JobRow
                job={job}
                onOpenLog={(target) => onOpenLog(pipeline.projectPath, target, pipeline.iid)}
                onOpenPipeline={onOpenPipeline}
                onAction={(target, action) => jobAction.mutate({ jobId: target.id, action })}
                busy={jobAction.isPending && jobAction.variables?.jobId === job.id}
                ui={ui}
              />
            </Fragment>
          ))}
        </View>
      ))}
    </View>
  );
}

function colorFor(color: LogColor | null, theme: PluginTheme): string {
  switch (color) {
    case "red":
      return theme.colors.statusDanger;
    case "green":
      return theme.colors.statusSuccess;
    case "yellow":
      return theme.colors.statusWarning;
    case "blue":
    case "cyan":
    case "magenta":
      return theme.colors.accent;
    case "gray":
      return theme.colors.foregroundMuted;
    default:
      return theme.colors.foreground;
  }
}

export function JobLogView({
  projectPath,
  job,
  pipelineIid,
  onBack,
  ui,
}: {
  projectPath: string;
  job: Job;
  pipelineIid: string | null;
  onBack: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readLog = useRpc(jobLogRpc);
  const scroll = useRef<NativeScrollView | null>(null);
  // Follows the tail like GitLab does, until the log stops growing.
  const following = useRef(true);
  const [full, setFull] = useState(false);
  const query = useQuery({
    queryKey: [...jobLogKey(projectPath, job.id), full],
    queryFn: () => readLog({ projectPath, jobId: job.id, full }),
    refetchInterval: isActive(job.status) ? ACTIVE_REFRESH_MS : false,
  });

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.row}>
        <IconButton
          icon="ChevronLeft"
          label="Back to the pipeline"
          onPress={onBack}
          theme={theme}
          styles={styles}
        />
        <PipelineDot status={job.status} theme={theme} styles={styles} />
        <Text style={[styles.text, { flex: 1, fontWeight: "600" }]} numberOfLines={1}>
          {job.name}
        </Text>
        {job.status === "FAILED" ? (
          <SendToAgentButton
            workspaceId={ui.workspaceId}
            subject={{ job: { projectPath, jobId: job.id, name: job.name, webUrl: job.webUrl, pipelineIid } }}
            ui={ui}
          />
        ) : null}
        <IconButton
          icon="RefreshCw"
          label="Refresh"
          onPress={() => void query.refetch()}
          disabled={query.isFetching}
          theme={theme}
          styles={styles}
        />
        <IconButton
          icon="ExternalLink"
          label="Open in GitLab"
          onPress={() => void openExternalUrl(job.webUrl)}
          theme={theme}
          styles={styles}
        />
      </View>
      {job.artifacts.length > 0 ? (
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          <Text style={styles.sectionTitle}>Artifacts</Text>
          {job.artifacts.map((artifact) => (
            <Button
              key={artifact.url}
              label={`⬇ ${artifact.fileType.toLowerCase()}${artifact.size != null ? ` · ${formatSize(artifact.size)}` : ""}`}
              onPress={() => void openExternalUrl(artifact.url)}
              styles={styles}
              theme={theme}
            />
          ))}
        </View>
      ) : null}
      {query.isPending ? (
        <Text style={styles.muted}>Loading the log…</Text>
      ) : query.isError ? (
        <Text style={styles.error}>{errorText(query.error)}</Text>
      ) : query.data.lines.length === 0 ? (
        <Text style={styles.muted}>
          {job.manual ? "This manual job has not run yet." : "The log is empty."}
        </Text>
      ) : (
        <View style={styles.card}>
          {query.data.totalLines > query.data.lines.length ? (
            <View style={[styles.row, { padding: 8 }]}>
              <Text style={[styles.small, { flex: 1 }]}>
                Last {query.data.lines.length} of {query.data.totalLines} lines.
              </Text>
              {!full ? (
                <Button label="Load the full log" onPress={() => setFull(true)} styles={styles} theme={theme} />
              ) : null}
            </View>
          ) : null}
          <ScrollView
            ref={scroll}
            style={{ maxHeight: 640 }}
            contentContainerStyle={{ padding: 8 }}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              following.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
            }}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (following.current) {
                scroll.current?.scrollToEnd({ animated: false });
              }
            }}
          >
            {query.data.lines.map((line, index) => (
              <Text
                key={index}
                selectable
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: 16,
                  color: theme.colors.foreground,
                  fontWeight: line.section ? "600" : "normal",
                  marginTop: line.section ? 6 : 0,
                }}
              >
                {line.segments.map((segment, part) => (
                  <Text
                    key={part}
                    style={{
                      color: colorFor(segment.color, theme),
                      fontWeight: segment.bold ? "600" : undefined,
                    }}
                  >
                    {segment.text}
                  </Text>
                ))}
                {line.segments.length === 0 ? " " : null}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
