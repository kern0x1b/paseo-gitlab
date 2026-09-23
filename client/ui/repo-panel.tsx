import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  aheadBehindRpc,
  authStatusRpc,
  branchesRpc,
  createBranchRpc,
  createMergeRequestRpc,
  deleteBranchRpc,
  fileLinesRpc,
  refCommitsRpc,
  repoTreeRpc,
  scopedDiffsRpc,
  workspaceRpc,
  type Branch,
  type Commit,
  type DiffFile,
  type DiffScope,
} from "../../shared/contract";
import { AccountScope, useRpc } from "../account";
import { useDiffTarget } from "../diff-target";
import { openDiff } from "../plugin-client";
import { FileDiff, fileKey } from "./changes";
import { Badge, Button, Centered, ConfirmButton, errorText, HostContext, IconButton } from "./common";
import type { Ui } from "./detail";
import { timeAgo } from "./format";
import { highlightLine, languageOf, tokenPalette, type HighlightState } from "./highlight";
import { STATUS_KEY } from "./queries";
import { useStyles } from "./styles";
import { workspaceKey } from "./workspace-card";

const MONO = Platform.select({ web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "Menlo" });
/** Past this a file is shown in part; the rest is one click away in GitLab. */
const MAX_FILE_LINES = 3000;
const TREE_WIDTH = 280;

type Tab = "files" | "commits" | "branches";
/** A diff opened from the commits or branches tab, shown in the tab's place. */
type Opened = { title: string; scope: DiffScope; webUrl: string; ref: string };

function repoKey(...parts: (string | number | undefined)[]) {
  return ["gitlab", "repo", ...parts] as const;
}

function webUrlFor(
  host: string,
  projectPath: string,
  kind: "tree" | "blob" | "commits" | "branches",
  ref: string,
  path = "",
) {
  const tail = kind === "branches" ? "" : `/${encodeURIComponent(ref)}${path ? `/${path}` : ""}`;
  return `${host}/${projectPath}/-/${kind}${tail}`;
}

function Folder({
  projectPath,
  refName,
  path,
  depth,
  openFile,
  active,
  ui,
}: {
  projectPath: string;
  refName: string;
  path: string;
  depth: number;
  openFile: (path: string) => void;
  active: string | null;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readTree = useRpc(repoTreeRpc);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const tree = useQuery({
    queryKey: repoKey("tree", projectPath, refName, path),
    queryFn: () => readTree({ projectPath, ref: refName, path }),
  });
  if (tree.isPending) {
    return <Text style={[styles.small, { paddingLeft: 8 + depth * 14, paddingVertical: 4 }]}>Loading…</Text>;
  }
  if (tree.isError) {
    return <Text style={[styles.error, { paddingLeft: 8 + depth * 14 }]}>{errorText(tree.error)}</Text>;
  }
  return (
    <>
      {tree.data.entries.map((entry) => {
        const isOpen = open.has(entry.path);
        const row = (
          <Pressable
            key={entry.path}
            accessibilityRole="button"
            accessibilityLabel={entry.path}
            accessibilityState={entry.type === "tree" ? { expanded: isOpen } : undefined}
            onPress={() => {
              if (entry.type === "blob") {
                openFile(entry.path);
                return;
              }
              setOpen((current) => {
                const next = new Set(current);
                if (!next.delete(entry.path)) {
                  next.add(entry.path);
                }
                return next;
              });
            }}
            style={({ pressed }) => [
              styles.row,
              { gap: 6, paddingVertical: 4, paddingRight: 8, paddingLeft: 8 + depth * 14, borderRadius: 6 },
              active === entry.path
                ? { backgroundColor: theme.colors.surface2 }
                : pressed
                  ? styles.listRowPressed
                  : null,
            ]}
          >
            <Icon
              name={entry.type === "tree" ? (isOpen ? "FolderOpen" : "Folder") : "File"}
              size={13}
              color={theme.colors.foregroundMuted}
            />
            <Text style={[styles.text, { flex: 1, fontSize: 12 }]} numberOfLines={1}>
              {entry.name}
            </Text>
          </Pressable>
        );
        return entry.type === "tree" && isOpen ? (
          <View key={entry.path}>
            {row}
            <Folder
              projectPath={projectPath}
              refName={refName}
              path={entry.path}
              depth={depth + 1}
              openFile={openFile}
              active={active}
              ui={ui}
            />
          </View>
        ) : (
          row
        );
      })}
      {tree.data.truncated ? (
        <Text style={[styles.small, { paddingLeft: 8 + depth * 14 }]}>
          Only the first 1000 entries are shown.
        </Text>
      ) : null}
    </>
  );
}

function FileView({
  projectPath,
  refName,
  path,
  ui,
}: {
  projectPath: string;
  refName: string;
  path: string;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readFile = useRpc(fileLinesRpc);
  const file = useQuery({
    queryKey: repoKey("file", projectPath, refName, path),
    queryFn: () => readFile({ projectPath, ref: refName, path }),
  });
  const lines = file.data?.lines ?? null;
  const shown = lines
    ? (lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines).slice(0, MAX_FILE_LINES)
    : [];
  const highlighted = useMemo(() => {
    const language = languageOf(path);
    let state: HighlightState = { inBlock: false };
    return shown.map((line) => {
      const result = highlightLine(line, language, state);
      state = result.state;
      return result.tokens;
    });
    // `shown` is derived from `lines`, which is what changes.
  }, [lines, path]);
  const palette = tokenPalette(theme.colors.surface0);
  const webUrl = webUrlFor(ui.host, projectPath, "blob", refName, path);
  const cell = { fontFamily: MONO, fontSize: 11, lineHeight: 17 };
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <Text style={[styles.text, { flex: 1, fontFamily: MONO, fontSize: 12 }]} numberOfLines={1}>
          {path}
        </Text>
        {lines ? <Text style={styles.small}>{lines.length} lines</Text> : null}
        <IconButton
          icon="ExternalLink"
          label="Open in GitLab"
          onPress={() => void openExternalUrl(webUrl)}
          theme={theme}
          styles={styles}
        />
      </View>
      {file.isPending ? (
        <Centered styles={styles}>
          <Text style={styles.muted}>Loading…</Text>
        </Centered>
      ) : file.isError ? (
        <Centered styles={styles}>
          <Text style={styles.error}>{errorText(file.error)}</Text>
        </Centered>
      ) : !lines ? (
        <Centered styles={styles}>
          <Text style={styles.muted}>This file is binary or too large to show here.</Text>
          <Button
            label="Open in GitLab"
            onPress={() => void openExternalUrl(webUrl)}
            styles={styles}
            theme={theme}
          />
        </Centered>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          <ScrollView horizontal contentContainerStyle={{ paddingVertical: 6, flexDirection: "column" }}>
            {shown.map((line, index) => (
              <View key={index} style={{ flexDirection: "row" }}>
                <Text
                  style={{
                    ...cell,
                    width: 48,
                    paddingRight: 12,
                    textAlign: "right",
                    color: theme.colors.foregroundMuted,
                  }}
                >
                  {index + 1}
                </Text>
                <Text
                  selectable
                  style={[
                    { ...cell, color: theme.colors.foreground, paddingRight: 16 },
                    Platform.OS === "web" ? ({ whiteSpace: "pre" } as object) : null,
                  ]}
                >
                  {line
                    ? (highlighted[index] ?? []).map((token, at) =>
                        palette[token.kind] ? (
                          <Text
                            key={at}
                            style={{
                              color: palette[token.kind]!,
                              fontStyle: token.kind === "comment" ? "italic" : "normal",
                            }}
                          >
                            {token.text}
                          </Text>
                        ) : (
                          token.text
                        ),
                      )
                    : " "}
                </Text>
              </View>
            ))}
            {lines.length > MAX_FILE_LINES ? (
              <Text style={[styles.small, { padding: 12 }]}>
                The first {MAX_FILE_LINES} of {lines.length} lines; the rest is in GitLab.
              </Text>
            ) : null}
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

/** A commit's or a comparison's files, read-only, each foldable. */
function DiffView({
  opened,
  projectPath,
  onBack,
  ui,
}: {
  opened: Opened;
  projectPath: string;
  onBack: () => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readDiffs = useRpc(scopedDiffsRpc);
  const readFile = useRpc(fileLinesRpc);
  const diffs = useQuery({
    queryKey: repoKey("diff", JSON.stringify(opened.scope)),
    queryFn: () => readDiffs(opened.scope),
  });
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const files = diffs.data?.files ?? [];
  const toggle = (file: DiffFile) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(fileKey(file))) {
        next.add(fileKey(file));
      }
      return next;
    });
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <IconButton icon="ChevronLeft" label="Back" onPress={onBack} theme={theme} styles={styles} />
        <Text style={[styles.text, { flex: 1, fontWeight: "600" }]} numberOfLines={1}>
          {opened.title}
        </Text>
        {diffs.data ? (
          <Text style={styles.small}>
            {files.length} files ·{" "}
            <Text style={{ color: theme.colors.statusSuccess }}>
              +{files.reduce((sum, file) => sum + file.additions, 0)}
            </Text>{" "}
            <Text style={{ color: theme.colors.statusDanger }}>
              −{files.reduce((sum, file) => sum + file.deletions, 0)}
            </Text>
          </Text>
        ) : null}
        <IconButton
          icon="ExternalLink"
          label="Open in GitLab"
          onPress={() => void openExternalUrl(opened.webUrl)}
          theme={theme}
          styles={styles}
        />
      </View>
      {diffs.isPending ? (
        <Centered styles={styles}>
          <Text style={styles.muted}>Loading the changes…</Text>
        </Centered>
      ) : diffs.isError ? (
        <Centered styles={styles}>
          <Text style={styles.error}>{errorText(diffs.error)}</Text>
        </Centered>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          {files.length === 0 ? <Text style={styles.muted}>No file changes.</Text> : null}
          {files.map((file) => (
            <FileDiff
              key={fileKey(file)}
              file={file}
              changesUrl={opened.webUrl}
              canComment={false}
              canSuggest={false}
              expanded={!closed.has(fileKey(file))}
              onToggle={() => toggle(file)}
              loadFile={
                file.deletedFile
                  ? undefined
                  : () =>
                      readFile({ projectPath, path: file.newPath, ref: opened.ref }).then(
                        (result) => result.lines,
                      )
              }
              ui={ui}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function CommitRow({ commit, onPress, ui }: { commit: Commit; onPress: () => void; ui: Ui }) {
  const { styles } = ui;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
    >
      <Text style={styles.listTitle} numberOfLines={2}>
        {commit.title}
      </Text>
      <Text style={styles.small} numberOfLines={1}>
        <Text style={{ fontFamily: MONO }}>{commit.shortSha}</Text> · {commit.author} ·{" "}
        {timeAgo(commit.createdAt)}
      </Text>
    </Pressable>
  );
}

function CommitsTab({
  projectPath,
  refName,
  onOpen,
  ui,
}: {
  projectPath: string;
  refName: string;
  onOpen: (opened: Opened) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readCommits = useRpc(refCommitsRpc);
  const commits = useInfiniteQuery({
    queryKey: repoKey("commits", projectPath, refName),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => readCommits({ projectPath, ref: refName, page: pageParam }),
    getNextPageParam: (last, pages) => (last.more ? pages.length + 1 : undefined),
  });
  if (commits.isPending) {
    return (
      <Centered styles={styles}>
        <Text style={styles.muted}>Loading commits…</Text>
      </Centered>
    );
  }
  if (commits.isError) {
    return (
      <Centered styles={styles}>
        <Text style={styles.error}>{errorText(commits.error)}</Text>
      </Centered>
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
      <View style={styles.card}>
        {commits.data.pages
          .flatMap((page) => page.commits)
          .map((commit) => (
            <CommitRow
              key={commit.sha}
              commit={commit}
              onPress={() =>
                onOpen({
                  title: commit.title,
                  scope: { kind: "commit", projectPath, sha: commit.sha },
                  webUrl: commit.webUrl,
                  ref: commit.sha,
                })
              }
              ui={ui}
            />
          ))}
      </View>
      {commits.hasNextPage ? (
        <View style={{ paddingTop: 12, alignItems: "center" }}>
          <Button
            label="Load more"
            busy={commits.isFetchingNextPage}
            onPress={() => void commits.fetchNextPage()}
            styles={styles}
            theme={theme}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function CreateMergeRequest({
  open,
  onClose,
  projectPath,
  branch,
  target,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  branch: string;
  target: string;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const toast = useToast();
  const create = useRpc(createMergeRequestRpc);
  const [title, setTitle] = useState(branch);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const ref = await create({
        projectPath,
        title: title.trim(),
        description: "",
        sourceBranch: branch,
        targetBranch: target,
      });
      toast.show("Merge request created", { variant: "success" });
      onClose();
      openDiff(ui.workspaceId, ref);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Merge ${branch} into ${target}`}
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
    >
      <Modal.Content>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
        />
        <View style={styles.row}>
          <View style={styles.spacer} />
          <Button label="Cancel" onPress={onClose} styles={styles} theme={theme} />
          <Button
            label="Create merge request"
            primary
            busy={busy}
            disabled={!title.trim()}
            onPress={() => void submit()}
            styles={styles}
            theme={theme}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function BranchRow({
  branch,
  base,
  projectPath,
  onBrowse,
  onOpen,
  ui,
}: {
  branch: Branch;
  base: string | null;
  projectPath: string;
  onBrowse: () => void;
  onOpen: (opened: Opened) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const toast = useToast();
  const queryClient = useQueryClient();
  const readAheadBehind = useRpc(aheadBehindRpc);
  const deleteBranch = useRpc(deleteBranchRpc);
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const counts = useQuery({
    queryKey: repoKey("ahead-behind", projectPath, branch.name, base ?? ""),
    queryFn: () => readAheadBehind({ projectPath, branch: branch.name, base: base! }),
    enabled: expanded && base !== null && !branch.isDefault,
  });
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteBranch({ projectPath, name: branch.name });
      toast.show(`Deleted ${branch.name}`, { variant: "success" });
      await queryClient.invalidateQueries({ queryKey: repoKey("branches", projectPath) });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
      >
        <View style={[styles.row, { gap: 6 }]}>
          <Icon name="GitBranch" size={13} color={theme.colors.foregroundMuted} />
          <Text
            style={[styles.text, { flexShrink: 1, fontFamily: MONO, fontSize: 12, fontWeight: "600" }]}
            numberOfLines={1}
          >
            {branch.name}
          </Text>
          {branch.isDefault ? <Badge label="default" styles={styles} /> : null}
          {branch.protected ? <Badge label="protected" styles={styles} /> : null}
          {branch.merged ? <Badge label="merged" styles={styles} color={theme.colors.statusSuccess} /> : null}
        </View>
        <Text style={styles.small} numberOfLines={1}>
          {branch.commit.title} · {branch.commit.author} · {timeAgo(branch.commit.createdAt)}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={[styles.cardBody, { paddingTop: 0 }]}>
          {!branch.isDefault && base ? (
            <Text style={styles.small}>
              {counts.isPending
                ? "Counting commits…"
                : counts.isError
                  ? errorText(counts.error)
                  : `${counts.data.ahead} ahead, ${counts.data.behind} behind ${base}`}
            </Text>
          ) : null}
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            <Button label="Browse files" onPress={onBrowse} styles={styles} theme={theme} />
            {!branch.isDefault && base ? (
              <Button
                label={`Compare with ${base}`}
                onPress={() =>
                  onOpen({
                    title: `${base}…${branch.name}`,
                    scope: { kind: "compare", projectPath, from: base, to: branch.name, mergeBase: true },
                    webUrl: `${ui.host}/${projectPath}/-/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch.name)}`,
                    ref: branch.commit.sha,
                  })
                }
                styles={styles}
                theme={theme}
              />
            ) : null}
            {!branch.isDefault && !branch.merged && base ? (
              <Button
                label="Create merge request"
                onPress={() => setCreating(true)}
                styles={styles}
                theme={theme}
              />
            ) : null}
            {!branch.isDefault && !branch.protected && branch.canPush ? (
              <ConfirmButton
                label="Delete"
                title={`Delete ${branch.name}?`}
                message={`The branch is removed from GitLab for everyone. Its commits stay reachable only from other branches and merge requests.`}
                confirmLabel="Delete branch"
                busy={deleting}
                onConfirm={() => void remove()}
                styles={styles}
                theme={theme}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {base ? (
        <CreateMergeRequest
          open={creating}
          onClose={() => setCreating(false)}
          projectPath={projectPath}
          branch={branch.name}
          target={base}
          ui={ui}
        />
      ) : null}
    </View>
  );
}

function NewBranch({
  open,
  onClose,
  projectPath,
  from,
  onCreated,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  from: string;
  onCreated: (name: string) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const toast = useToast();
  const createBranch = useRpc(createBranchRpc);
  const [name, setName] = useState("");
  const [ref, setRef] = useState(from);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const created = await createBranch({ projectPath, name: name.trim(), ref: ref.trim() });
      toast.show(`Created ${created.name}`, { variant: "success" });
      setName("");
      onCreated(created.name);
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New branch" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Branch name"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
        />
        <TextInput
          value={ref}
          onChangeText={setRef}
          placeholder="From branch, tag or commit"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
        />
        <View style={styles.row}>
          <View style={styles.spacer} />
          <Button label="Cancel" onPress={onClose} styles={styles} theme={theme} />
          <Button
            label="Create branch"
            primary
            busy={busy}
            disabled={!name.trim() || !ref.trim()}
            onPress={() => void submit()}
            styles={styles}
            theme={theme}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function BranchesTab({
  projectPath,
  refName,
  onBrowse,
  onOpen,
  ui,
}: {
  projectPath: string;
  refName: string;
  onBrowse: (branch: string) => void;
  onOpen: (opened: Opened) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readBranches = useRpc(branchesRpc);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const branches = useQuery({
    queryKey: repoKey("branches", projectPath, search.trim()),
    queryFn: () => readBranches({ projectPath, search }),
    placeholderData: (previous) => previous,
  });
  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.row, { padding: 12, gap: 8 }]}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search branches…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.input, { flex: 1, minHeight: 0, paddingVertical: 6 }]}
        />
        <Button label="New branch" onPress={() => setCreating(true)} styles={styles} theme={theme} />
      </View>
      {branches.isPending ? (
        <Centered styles={styles}>
          <Text style={styles.muted}>Loading branches…</Text>
        </Centered>
      ) : branches.isError ? (
        <Centered styles={styles}>
          <Text style={styles.error}>{errorText(branches.error)}</Text>
        </Centered>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <View style={styles.card}>
            {branches.data.branches.length === 0 ? (
              <Text style={[styles.muted, { padding: 12 }]}>No branch matches.</Text>
            ) : null}
            {branches.data.branches.map((branch) => (
              <BranchRow
                key={branch.name}
                branch={branch}
                base={branches.data.defaultBranch}
                projectPath={projectPath}
                onBrowse={() => onBrowse(branch.name)}
                onOpen={onOpen}
                ui={ui}
              />
            ))}
          </View>
          {branches.data.branches.length === 100 ? (
            <Text style={[styles.small, { paddingTop: 8 }]}>
              The first 100 branches; search to find the others.
            </Text>
          ) : null}
        </ScrollView>
      )}
      <NewBranch
        open={creating}
        onClose={() => setCreating(false)}
        projectPath={projectPath}
        from={refName}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: repoKey("branches", projectPath) })}
        ui={ui}
      />
    </View>
  );
}

function RefPicker({
  open,
  onClose,
  projectPath,
  onPick,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  onPick: (ref: string) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const readBranches = useRpc(branchesRpc);
  const [search, setSearch] = useState("");
  const branches = useQuery({
    queryKey: repoKey("branches", projectPath, search.trim()),
    queryFn: () => readBranches({ projectPath, search }),
    enabled: open,
    placeholderData: (previous) => previous,
  });
  return (
    <Modal title="Switch branch" open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search branches…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          autoFocus
        />
        {branches.isPending ? <Text style={styles.small}>Loading…</Text> : null}
        {branches.data?.branches.slice(0, 30).map((branch) => (
          <Pressable
            key={branch.name}
            accessibilityRole="button"
            onPress={() => {
              onPick(branch.name);
              onClose();
            }}
            style={({ pressed }) => [styles.listRow, pressed ? styles.listRowPressed : null]}
          >
            <Text style={[styles.text, { fontFamily: MONO, fontSize: 12 }]} numberOfLines={1}>
              {branch.name}
            </Text>
            <Text style={styles.small} numberOfLines={1}>
              {branch.commit.title} · {timeAgo(branch.commit.createdAt)}
            </Text>
          </Pressable>
        ))}
      </Modal.Content>
    </Modal>
  );
}

function Repository({ projectPath, initialRef, ui }: { projectPath: string; initialRef: string; ui: Ui }) {
  const { styles, theme } = ui;
  const [refName, setRefName] = useState(initialRef);
  const [tab, setTab] = useState<Tab>("files");
  const [file, setFile] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [picking, setPicking] = useState(false);
  const tabs: { id: Tab; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "commits", label: "Commits" },
    { id: "branches", label: "Branches" },
  ];
  const webUrl = webUrlFor(
    ui.host,
    projectPath,
    tab === "commits" ? "commits" : tab === "branches" ? "branches" : "tree",
    refName,
  );
  let body: React.ReactNode;
  if (opened) {
    body = <DiffView opened={opened} projectPath={projectPath} onBack={() => setOpened(null)} ui={ui} />;
  } else if (tab === "files") {
    body = (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <ScrollView
          style={{
            width: TREE_WIDTH,
            flexGrow: 0,
            borderRightWidth: 1,
            borderRightColor: theme.colors.border,
          }}
          contentContainerStyle={{ padding: 4, paddingBottom: 16 }}
        >
          <Folder
            key={refName}
            projectPath={projectPath}
            refName={refName}
            path=""
            depth={0}
            openFile={setFile}
            active={file}
            ui={ui}
          />
        </ScrollView>
        {file ? (
          <FileView
            key={`${refName}:${file}`}
            projectPath={projectPath}
            refName={refName}
            path={file}
            ui={ui}
          />
        ) : (
          <Centered styles={styles}>
            <Text style={styles.muted}>Pick a file to read it.</Text>
          </Centered>
        )}
      </View>
    );
  } else if (tab === "commits") {
    body = (
      <CommitsTab key={refName} projectPath={projectPath} refName={refName} onOpen={setOpened} ui={ui} />
    );
  } else {
    body = (
      <BranchesTab
        projectPath={projectPath}
        refName={refName}
        onBrowse={(branch) => {
          setRefName(branch);
          setFile(null);
          setTab("files");
        }}
        onOpen={setOpened}
        ui={ui}
      />
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <Text style={[styles.title, { flexShrink: 1 }]} numberOfLines={1}>
          {projectPath}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch branch"
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.badge, styles.row, { gap: 4 }, pressed ? { opacity: 0.7 } : null]}
        >
          <Icon name="GitBranch" size={12} color={theme.colors.foregroundMuted} />
          <Text style={[styles.badgeLabel, { fontFamily: MONO }]} numberOfLines={1}>
            {refName}
          </Text>
          <Icon name="ChevronDown" size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
        <View style={styles.spacer} />
        <View style={[styles.tabs, { width: 260 }]}>
          {tabs.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === option.id }}
              onPress={() => {
                setTab(option.id);
                setOpened(null);
              }}
              style={[styles.tab, tab === option.id ? styles.tabActive : null]}
            >
              <Text style={styles.small}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <IconButton
          icon="ExternalLink"
          label="Open in GitLab"
          onPress={() => void openExternalUrl(webUrl)}
          theme={theme}
          styles={styles}
        />
      </View>
      {body}
      <RefPicker
        open={picking}
        onClose={() => setPicking(false)}
        projectPath={projectPath}
        onPick={(next) => {
          setRefName(next);
          setFile(null);
          setOpened(null);
        }}
        ui={ui}
      />
    </View>
  );
}

function RepositoryPanelContent({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme);
  const readStatus = useRpc(authStatusRpc);
  const readWorkspace = useRpc(workspaceRpc);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => readStatus({}), staleTime: 5 * 60_000 });
  const workspace = useQuery({
    queryKey: workspaceKey(directory ?? ""),
    queryFn: () => readWorkspace({ directory: directory ?? "" }),
    enabled: Boolean(directory) && status.data?.connected === true,
  });
  const target = useDiffTarget(workspaceId);
  const host = status.data?.connected ? status.data.host : "";
  const ui: Ui = { theme, styles, host, workspaceId };
  const checkout = workspace.data?.checkout ?? null;
  // The workspace's own project, or the one of the MR last opened in the diff panel.
  const projectPath = checkout?.projectPath ?? target?.projectPath ?? null;
  const initialRef = checkout?.branch ?? workspace.data?.defaultBranch ?? "HEAD";

  let body: React.ReactNode;
  if (status.isPending || (workspace.isPending && workspace.fetchStatus !== "idle")) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Loading…</Text>
      </Centered>
    );
  } else if (!status.data?.connected) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>Connect GitLab in Settings → GitLab first.</Text>
      </Centered>
    );
  } else if (!projectPath) {
    body = (
      <Centered styles={styles}>
        <Text style={styles.muted}>This workspace is not a checkout of a project on {host}.</Text>
      </Centered>
    );
  } else {
    body = (
      <Repository
        key={`${projectPath}:${initialRef}`}
        projectPath={projectPath}
        initialRef={initialRef}
        ui={ui}
      />
    );
  }
  return (
    <HostContext.Provider value={host}>
      <View style={styles.screen}>{body}</View>
    </HostContext.Provider>
  );
}

/** The project's files, commits and branches in the main area, as GitLab's repository pages show them. */
export function RepositoryPanel(props: PluginWorkspacePanelProps) {
  return (
    <AccountScope workspaceId={props.workspaceId}>
      <RepositoryPanelContent {...props} />
    </AccountScope>
  );
}
