import type { PluginAttachmentSearchPayload } from "@getpaseo/plugin";
import type {
  Detail,
  DetailLabel,
  DiffFile,
  DiffLine,
  DiffRefs,
  ItemRef,
  JobLog,
  Lists,
  Person,
  Pipeline,
  PipelineRef,
  DraftNote,
  DiffScope,
  BoardCard,
  BoardColumn,
  BoardFilters,
  BoardSummary,
  Branch,
  Milestone,
  Commit,
  MergeRequestVersion,
  TreeEntry,
  WorkspaceState,
  SavedQuery,
  SearchQuery,
  ListItem,
} from "../shared/contract";
import { randomUUID } from "node:crypto";
import { readSavedQueries, writeSavedQueries } from "./state";
import { authStatus, requireConnection, type AuthDeps } from "./auth";
import { assertNoMutationErrors, graphql, GitLabError, rest, restWrite, type Connection } from "./gitlab";
import { codePosition, fetchCommitDiffs, fetchCompare, fetchDiffs } from "./diff";
import { fetchImage } from "./images";
import { MAX_LOG_LINES, parseJobLog } from "./log";
import {
  agentPrompt,
  conflictPrompt,
  failedJobsOf,
  itemContext,
  jobPrompt,
  logTail,
  type FailedJobLog,
} from "./agent-context";
import { readCheckout } from "./workspace";
import {
  BOARD_CARDS_QUERY,
  CREATE_BOARD_ISSUE_MUTATION,
  CREATE_BOARD_LIST_MUTATION,
  CREATE_BOARD_MUTATION,
  DESTROY_BOARD_LIST_MUTATION,
  DESTROY_BOARD_MUTATION,
  MILESTONES_QUERY,
  UPDATE_BOARD_MUTATION,
  BOARD_COLUMNS_QUERY,
  BOARDS_QUERY,
  boardFilterVariables,
  MOVE_BOARD_CARD_MUTATION,
  toBoardCards,
  toBoardColumns,
  type RawBoardCards,
  type RawBoardColumns,
  type RawBoards,
  CREATE_DIFF_NOTE_MUTATION,
  CREATE_ISSUE_MUTATION,
  MERGE_MUTATION,
  TOGGLE_REACTION_MUTATION,
  CREATE_MERGE_REQUEST_MUTATION,
  REFERENCE_SEARCH_QUERY,
  referenceVariables,
  RUN_PIPELINE_MUTATION,
  searchQuery,
  searchVariables,
  toSearchResults,
  type RawSearchResult,
  CREATE_DISCUSSION_MUTATION,
  CREATE_NOTE_MUTATION,
  DESTROY_NOTE_MUTATION,
  SEARCH_LABELS_QUERY,
  SEARCH_USERS_QUERY,
  SET_DRAFT_MUTATION,
  SET_MERGE_REQUEST_LABELS_MUTATION,
  SET_PEOPLE_MUTATIONS,
  UPDATE_ISSUE_MUTATION,
  UPDATE_MERGE_REQUEST_MUTATION,
  UPDATE_NOTE_MUTATION,
  ISSUE_QUERY,
  JOB_MUTATIONS,
  LISTS_QUERIES,
  MERGE_REQUEST_QUERY,
  numericId,
  PIPELINE_MUTATIONS,
  PIPELINE_QUERY,
  TODO_DONE_MUTATION,
  TOGGLE_RESOLVE_MUTATION,
  toDetail,
  toLists,
  parseReference,
  SEARCH_ITEMS_QUERY,
  searchHits,
  toPipeline,
  toWorkspaceMergeRequest,
  WORKSPACE_QUERY,
  type RawPipeline,
  type RawSearchItems,
  type RawWorkspace,
  type RawIssueDetail,
  type RawLists,
  type RawMergeRequestDetail,
} from "./queries";

const LOG_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TREE_PAGES = 10;
const COMMITS_PER_PAGE = 40;
const BOARD_PAGE_SIZE = 20;

interface RawCommit {
  id: string;
  short_id: string;
  parent_ids?: string[];
  title: string;
  author_name: string;
  created_at: string;
  web_url: string;
}

function toCommit(commit: RawCommit): Commit {
  return {
    sha: commit.id,
    shortSha: commit.short_id,
    parentSha: commit.parent_ids?.[0] ?? null,
    title: commit.title,
    author: commit.author_name,
    createdAt: commit.created_at,
    webUrl: commit.web_url,
  };
}

function projectPath(path: string): string {
  return `/projects/${encodeURIComponent(path)}`;
}

function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return entries.sort((a, b) =>
    a.type !== b.type ? (a.type === "tree" ? -1 : 1) : a.name.localeCompare(b.name),
  );
}
const FULL_LOG_LINES = 50_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SAVED_QUERY_LIMIT = 30;

function mergeRequestPath(ref: { projectPath: string; iid: string }): string {
  return `/projects/${encodeURIComponent(ref.projectPath)}/merge_requests/${encodeURIComponent(ref.iid)}`;
}

export function discussionHash(discussionId: string): string {
  return discussionId.replace(/^gid:\/\/gitlab\/Discussion\//, "");
}

interface RawDraftNote {
  id: number;
  note: string;
  discussion_id: string | null;
  position: {
    new_path?: string;
    old_path?: string;
    new_line?: number | null;
    old_line?: number | null;
  } | null;
}

function toDraftNote(raw: RawDraftNote): DraftNote {
  const path = raw.position?.new_path ?? raw.position?.old_path;
  return {
    id: String(raw.id),
    body: raw.note,
    discussionId: raw.discussion_id,
    position: path
      ? { path, newLine: raw.position?.new_line ?? null, oldLine: raw.position?.old_line ?? null }
      : null,
  };
}
const LISTS_CACHE_MS = 60_000;

async function mutate(
  connection: Connection,
  deps: AuthDeps,
  mutation: string,
  variables: Record<string, unknown>,
  action: string,
): Promise<{ ok: true }> {
  const data = await graphql<Record<string, { errors?: string[] } | null>>(
    connection,
    mutation,
    variables,
    deps.fetch,
  );
  assertNoMutationErrors(Object.values(data)[0], action);
  return { ok: true };
}

const usernames = new Map<string, string>();

async function usernameFor(connection: Connection, deps: AuthDeps): Promise<string> {
  const key = `${connection.host}\0${connection.token}`;
  const cached = usernames.get(key);
  if (cached) {
    return cached;
  }
  const user = await rest<{ username: string }>(connection, "/user", deps.fetch);
  usernames.clear();
  usernames.set(key, user.username);
  return user.username;
}

export function createHandlers(deps: AuthDeps) {
  const handlers = {
    status: () => authStatus(deps),

    async lists(): Promise<Lists> {
      const connection = await requireConnection(deps);
      const me = await usernameFor(connection, deps);
      const [mine, review, issues] = await Promise.all([
        graphql<Pick<RawLists, "currentUser">>(connection, LISTS_QUERIES.mergeRequests, {}, deps.fetch),
        graphql<Pick<RawLists, "currentUser">>(connection, LISTS_QUERIES.review, {}, deps.fetch),
        graphql<Pick<RawLists, "assignedIssues" | "authoredIssues">>(
          connection,
          LISTS_QUERIES.issues,
          { me },
          deps.fetch,
        ),
      ]);
      return toLists({
        currentUser: {
          authoredMergeRequests: mine.currentUser?.authoredMergeRequests,
          assignedMergeRequests: mine.currentUser?.assignedMergeRequests,
          reviewRequestedMergeRequests: review.currentUser?.reviewRequestedMergeRequests,
          todos: review.currentUser?.todos,
        },
        assignedIssues: issues.assignedIssues,
        authoredIssues: issues.authoredIssues,
      });
    },

    async detail(ref: ItemRef): Promise<Detail> {
      const connection = await requireConnection(deps);
      const variables = { path: ref.projectPath, iid: ref.iid };
      const raw =
        ref.kind === "issue"
          ? (await graphql<RawIssueDetail>(connection, ISSUE_QUERY, variables, deps.fetch)).project?.issue
          : (await graphql<RawMergeRequestDetail>(connection, MERGE_REQUEST_QUERY, variables, deps.fetch))
              .project?.mergeRequest;
      if (!raw) {
        throw new Error(`${ref.projectPath}${ref.kind === "issue" ? "#" : "!"}${ref.iid} was not found.`);
      }
      return toDetail(ref.kind, raw, await usernameFor(connection, deps));
    },

    async addNote(input: {
      noteableId: string;
      body: string;
      discussionId?: string;
      mode?: "comment" | "thread";
    }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      if (!input.discussionId && input.mode === "thread") {
        return mutate(
          connection,
          deps,
          CREATE_DISCUSSION_MUTATION,
          { noteableId: input.noteableId, body: input.body },
          "start the thread",
        );
      }
      return mutate(
        connection,
        deps,
        CREATE_NOTE_MUTATION,
        { noteableId: input.noteableId, body: input.body, discussionId: input.discussionId ?? null },
        "post the comment",
      );
    },

    async updateNote(input: { id: string; body: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(connection, deps, UPDATE_NOTE_MUTATION, input, "save the comment");
    },

    async deleteNote(input: { id: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(connection, deps, DESTROY_NOTE_MUTATION, input, "delete the comment");
    },

    async updateItem(
      input: ItemRef & { title?: string; description?: string; state?: "close" | "reopen"; draft?: boolean },
    ): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      const target = { projectPath: input.projectPath, iid: input.iid };
      if (input.kind === "issue") {
        return mutate(
          connection,
          deps,
          UPDATE_ISSUE_MUTATION,
          {
            ...target,
            title: input.title ?? null,
            description: input.description ?? null,
            stateEvent: input.state ? input.state.toUpperCase() : null,
          },
          "update the issue",
        );
      }
      if (input.title !== undefined || input.description !== undefined || input.state) {
        await mutate(
          connection,
          deps,
          UPDATE_MERGE_REQUEST_MUTATION,
          {
            ...target,
            title: input.title ?? null,
            description: input.description ?? null,
            state: input.state === "close" ? "CLOSED" : input.state === "reopen" ? "OPEN" : null,
          },
          "update the merge request",
        );
      }
      if (input.draft !== undefined) {
        await mutate(
          connection,
          deps,
          SET_DRAFT_MUTATION,
          { ...target, draft: input.draft },
          "change the draft status",
        );
      }
      return { ok: true };
    },

    async setPeople(
      input: ItemRef & { field: "assignees" | "reviewers"; usernames: string[] },
    ): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      if (input.kind === "issue" && input.field === "reviewers") {
        throw new Error("Issues have no reviewers.");
      }
      const mutation =
        input.kind === "issue"
          ? SET_PEOPLE_MUTATIONS.issueAssignees
          : input.field === "assignees"
            ? SET_PEOPLE_MUTATIONS.mrAssignees
            : SET_PEOPLE_MUTATIONS.mrReviewers;
      return mutate(
        connection,
        deps,
        mutation,
        { projectPath: input.projectPath, iid: input.iid, usernames: input.usernames },
        `change the ${input.field}`,
      );
    },

    async setLabels(input: ItemRef & { labelIds: string[] }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      const variables = { projectPath: input.projectPath, iid: input.iid, labelIds: input.labelIds };
      return input.kind === "issue"
        ? mutate(connection, deps, UPDATE_ISSUE_MUTATION, variables, "change the labels")
        : mutate(connection, deps, SET_MERGE_REQUEST_LABELS_MUTATION, variables, "change the labels");
    },

    async searchUsers(input: { projectPath: string; search: string }): Promise<{ users: Person[] }> {
      const connection = await requireConnection(deps);
      const data = await graphql<{ project: { autocompleteUsers: Person[] | null } | null }>(
        connection,
        SEARCH_USERS_QUERY,
        { path: input.projectPath, search: input.search },
        deps.fetch,
      );
      return { users: (data.project?.autocompleteUsers ?? []).slice(0, 20) };
    },

    async searchLabels(input: { projectPath: string; search: string }): Promise<{ labels: DetailLabel[] }> {
      const connection = await requireConnection(deps);
      const data = await graphql<{ project: { labels: { nodes: DetailLabel[] } | null } | null }>(
        connection,
        SEARCH_LABELS_QUERY,
        { path: input.projectPath, search: input.search || null },
        deps.fetch,
      );
      return { labels: data.project?.labels?.nodes ?? [] };
    },

    async diffs(input: {
      projectPath: string;
      iid: string;
    }): Promise<{ files: DiffFile[]; truncated: boolean }> {
      const connection = await requireConnection(deps);
      return fetchDiffs(connection, input.projectPath, input.iid, deps.fetch);
    },

    async addDiffNote(input: {
      noteableId: string;
      body: string;
      diffRefs: DiffRefs;
      oldPath: string;
      newPath: string;
      oldLine: number | null;
      newLine: number | null;
    }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(
        connection,
        deps,
        CREATE_DIFF_NOTE_MUTATION,
        {
          noteableId: input.noteableId,
          body: input.body,
          position: {
            ...input.diffRefs,
            paths: { oldPath: input.oldPath, newPath: input.newPath },
            oldLine: input.oldLine,
            newLine: input.newLine,
          },
        },
        "post the code comment",
      );
    },

    async resolve(input: { discussionId: string; resolve: boolean }): Promise<{ resolved: boolean }> {
      const connection = await requireConnection(deps);
      const data = await graphql<{
        discussionToggleResolve: { errors?: string[]; discussion: { resolved: boolean } | null } | null;
      }>(connection, TOGGLE_RESOLVE_MUTATION, { id: input.discussionId, resolve: input.resolve }, deps.fetch);
      assertNoMutationErrors(data.discussionToggleResolve, "change the thread");
      return { resolved: data.discussionToggleResolve?.discussion?.resolved ?? input.resolve };
    },

    async pipeline(ref: PipelineRef): Promise<Pipeline> {
      const connection = await requireConnection(deps);
      const data = await graphql<RawPipeline>(
        connection,
        PIPELINE_QUERY,
        { path: ref.projectPath, iid: ref.iid },
        deps.fetch,
      );
      const raw = data.project?.pipeline;
      if (!raw) {
        throw new Error(`Pipeline #${ref.iid} in ${ref.projectPath} was not found.`);
      }
      return toPipeline(ref.projectPath, raw, connection.host);
    },

    async jobLog(input: { projectPath: string; jobId: string; full?: boolean }): Promise<JobLog> {
      const connection = await requireConnection(deps);
      const id = numericId(input.jobId);
      if (!id) {
        throw new Error("Unknown job.");
      }
      const response = await deps.fetch(
        `${connection.host}/api/v4/projects/${encodeURIComponent(input.projectPath)}/jobs/${id}/trace`,
        {
          headers: { Authorization: `Bearer ${connection.token}` },
          signal: AbortSignal.timeout(LOG_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        throw new GitLabError(`GitLab returned ${response.status} for the job log.`, response.status);
      }
      return parseJobLog(await response.text(), input.full ? FULL_LOG_LINES : MAX_LOG_LINES);
    },

    async jobAction(input: { jobId: string; action: "retry" | "play" | "cancel" }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(
        connection,
        deps,
        JOB_MUTATIONS[input.action],
        { id: input.jobId },
        `${input.action} the job`,
      );
    },

    async pipelineAction(input: { pipelineId: string; action: "retry" | "cancel" }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(
        connection,
        deps,
        PIPELINE_MUTATIONS[input.action],
        { id: input.pipelineId },
        `${input.action} the pipeline`,
      );
    },

    async todoDone(input: { id: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(connection, deps, TODO_DONE_MUTATION, { id: input.id }, "mark the to-do as done");
    },

    async image(input: { src: string }): Promise<{ dataUrl: string | null }> {
      const connection = await requireConnection(deps);
      return { dataUrl: await fetchImage(connection, input.src, deps.fetch) };
    },

    async createIssue(input: { projectPath: string; title: string; description: string }): Promise<ItemRef> {
      const connection = await requireConnection(deps);
      const data = await graphql<{
        createIssue: { issue: { iid: string } | null; errors?: string[] } | null;
      }>(connection, CREATE_ISSUE_MUTATION, input, deps.fetch);
      assertNoMutationErrors(data.createIssue, "create the issue");
      const iid = data.createIssue?.issue?.iid;
      if (!iid) {
        throw new Error("GitLab did not return the new issue.");
      }
      return { kind: "issue", projectPath: input.projectPath, iid };
    },

    async createMergeRequest(input: {
      projectPath: string;
      title: string;
      description: string;
      sourceBranch: string;
      targetBranch: string;
    }): Promise<ItemRef> {
      const connection = await requireConnection(deps);
      const data = await graphql<{
        mergeRequestCreate: { mergeRequest: { iid: string } | null; errors?: string[] } | null;
      }>(connection, CREATE_MERGE_REQUEST_MUTATION, input, deps.fetch);
      assertNoMutationErrors(data.mergeRequestCreate, "create the merge request");
      const iid = data.mergeRequestCreate?.mergeRequest?.iid;
      if (!iid) {
        throw new Error("GitLab did not return the new merge request.");
      }
      return { kind: "mr", projectPath: input.projectPath, iid };
    },

    async mergeRequestAction(
      input: ItemRef & {
        action: "approve" | "unapprove" | "merge" | "auto_merge" | "cancel_auto_merge" | "rebase";
      },
    ): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      const base = mergeRequestPath(input);
      switch (input.action) {
        case "approve":
        case "unapprove":
          await restWrite(connection, "POST", `${base}/${input.action}`, undefined, deps.fetch);
          return { ok: true };
        case "rebase":
          await restWrite(connection, "PUT", `${base}/rebase`, undefined, deps.fetch);
          return { ok: true };
        case "cancel_auto_merge":
          await restWrite(
            connection,
            "POST",
            `${base}/cancel_merge_when_pipeline_succeeds`,
            undefined,
            deps.fetch,
          );
          return { ok: true };
        case "merge":
        case "auto_merge": {
          const detail = await handlers.detail(input);
          if (!detail.diffRefs) {
            throw new Error("GitLab did not report the MR's head commit.");
          }
          return mutate(
            connection,
            deps,
            MERGE_MUTATION,
            {
              projectPath: input.projectPath,
              iid: input.iid,
              sha: detail.diffRefs.headSha,
              strategy: input.action === "auto_merge" ? "MERGE_WHEN_CHECKS_PASS" : null,
            },
            input.action === "merge" ? "merge" : "set auto-merge",
          );
        }
      }
    },

    async applySuggestion(input: { id: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      const id = numericId(input.id);
      if (!id) {
        throw new Error("Unknown suggestion.");
      }
      await restWrite(connection, "PUT", `/suggestions/${id}/apply`, undefined, deps.fetch);
      return { ok: true };
    },

    async toggleReaction(input: { awardableId: string; name: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(connection, deps, TOGGLE_REACTION_MUTATION, input, "change the reaction");
    },

    async drafts(input: { projectPath: string; iid: string }): Promise<{ drafts: DraftNote[] }> {
      const connection = await requireConnection(deps);
      const raw = await rest<RawDraftNote[]>(
        connection,
        `${mergeRequestPath(input)}/draft_notes`,
        deps.fetch,
      );
      return { drafts: raw.map(toDraftNote) };
    },

    async addDraft(input: {
      projectPath: string;
      iid: string;
      body: string;
      discussionId?: string;
      code?: {
        diffRefs: DiffRefs;
        oldPath: string;
        newPath: string;
        oldLine: number | null;
        newLine: number | null;
      };
    }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      await restWrite(
        connection,
        "POST",
        `${mergeRequestPath(input)}/draft_notes`,
        {
          note: input.body,
          ...(input.discussionId ? { in_reply_to_discussion_id: discussionHash(input.discussionId) } : {}),
          ...(input.code
            ? {
                position: {
                  position_type: "text",
                  base_sha: input.code.diffRefs.baseSha,
                  head_sha: input.code.diffRefs.headSha,
                  start_sha: input.code.diffRefs.startSha,
                  old_path: input.code.oldPath,
                  new_path: input.code.newPath,
                  old_line: input.code.oldLine,
                  new_line: input.code.newLine,
                },
              }
            : {}),
        },
        deps.fetch,
      );
      return { ok: true };
    },

    async deleteDraft(input: { projectPath: string; iid: string; id: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      await restWrite(
        connection,
        "DELETE",
        `${mergeRequestPath(input)}/draft_notes/${encodeURIComponent(input.id)}`,
        undefined,
        deps.fetch,
      );
      return { ok: true };
    },

    async submitReview(input: { projectPath: string; iid: string; approve: boolean }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      const base = mergeRequestPath(input);
      await restWrite(connection, "POST", `${base}/draft_notes/bulk_publish`, undefined, deps.fetch);
      if (input.approve) {
        await restWrite(connection, "POST", `${base}/approve`, undefined, deps.fetch);
      }
      return { ok: true };
    },

    async referenceSearch(input: { projectPath: string; kind: "issue" | "mr"; term: string }): Promise<{
      items: { iid: string; title: string }[];
    }> {
      const connection = await requireConnection(deps);
      const data = await graphql<{
        project: {
          issues?: { nodes: { iid: string; title: string }[] };
          mergeRequests?: { nodes: { iid: string; title: string }[] };
        } | null;
      }>(
        connection,
        REFERENCE_SEARCH_QUERY[input.kind],
        referenceVariables(input.projectPath, input.term),
        deps.fetch,
      );
      const rows = input.kind === "issue" ? data.project?.issues?.nodes : data.project?.mergeRequests?.nodes;
      return { items: (rows ?? []).map(({ iid, title }) => ({ iid, title })) };
    },

    async markdownPreview(input: { projectPath: string; text: string }): Promise<{ html: string }> {
      const connection = await requireConnection(deps);
      const result = await restWrite<{ html: string }>(
        connection,
        "POST",
        "/markdown",
        { text: input.text, gfm: true, project: input.projectPath },
        deps.fetch,
      );
      return { html: result?.html ?? "" };
    },

    async upload(input: {
      projectPath: string;
      filename: string;
      contentType: string;
      base64: string;
    }): Promise<{
      markdown: string;
    }> {
      const connection = await requireConnection(deps);
      const bytes = Buffer.from(input.base64, "base64");
      if (bytes.length > MAX_UPLOAD_BYTES) {
        throw new Error("The file is larger than 10 MB.");
      }
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: input.contentType || "application/octet-stream" }),
        input.filename,
      );
      const response = await deps.fetch(
        `${connection.host}/api/v4/projects/${encodeURIComponent(input.projectPath)}/uploads`,
        { method: "POST", headers: { Authorization: `Bearer ${connection.token}` }, body: form },
      );
      if (!response.ok) {
        throw new GitLabError(`GitLab returned ${response.status} for the upload.`, response.status);
      }
      const uploaded = (await response.json()) as { markdown?: string };
      if (!uploaded.markdown) {
        throw new Error("GitLab did not return the uploaded file.");
      }
      return { markdown: uploaded.markdown };
    },

    async search(input: SearchQuery): Promise<{ items: ListItem[] }> {
      const connection = await requireConnection(deps);
      const raw = await graphql<RawSearchResult>(
        connection,
        searchQuery(input.kind),
        searchVariables(input),
        deps.fetch,
      );
      return { items: toSearchResults(input.kind, raw) };
    },

    savedQueries(): { queries: SavedQuery[] } {
      return { queries: readSavedQueries<SavedQuery>() };
    },

    saveQuery(input: SearchQuery & { name: string }): { queries: SavedQuery[] } {
      const queries = [...readSavedQueries<SavedQuery>(), { ...input, id: randomUUID() }].slice(
        -SAVED_QUERY_LIMIT,
      );
      writeSavedQueries(queries);
      return { queries };
    },

    deleteQuery(input: { id: string }): { queries: SavedQuery[] } {
      const queries = readSavedQueries<SavedQuery>().filter((query) => query.id !== input.id);
      writeSavedQueries(queries);
      return { queries };
    },

    async runPipeline(input: {
      projectPath: string;
      ref: string;
      mergeRequestIid?: string;
    }): Promise<PipelineRef> {
      const connection = await requireConnection(deps);
      const data = await graphql<{
        pipelineCreate: { pipeline: { iid: string } | null; errors?: string[] } | null;
      }>(
        connection,
        RUN_PIPELINE_MUTATION,
        { projectPath: input.projectPath, ref: input.ref, mergeRequestIid: input.mergeRequestIid ?? null },
        deps.fetch,
      );
      assertNoMutationErrors(data.pipelineCreate, "start the pipeline");
      const iid = data.pipelineCreate?.pipeline?.iid;
      if (!iid) {
        throw new Error("GitLab did not return the new pipeline.");
      }
      return { projectPath: input.projectPath, iid };
    },

    async addCodeComment(input: {
      projectPath: string;
      iid: string;
      body: string;
      diffRefs: DiffRefs;
      oldPath: string;
      newPath: string;
      start: Pick<DiffLine, "kind" | "oldLine" | "newLine" | "oldPos" | "newPos">;
      end: Pick<DiffLine, "kind" | "oldLine" | "newLine" | "oldPos" | "newPos">;
      asDraft: boolean;
    }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      const position = codePosition(input);
      await restWrite(
        connection,
        "POST",
        `${mergeRequestPath(input)}/${input.asDraft ? "draft_notes" : "discussions"}`,
        input.asDraft ? { note: input.body, position } : { body: input.body, position },
        deps.fetch,
      );
      return { ok: true };
    },

    async versions(input: {
      projectPath: string;
      iid: string;
    }): Promise<{ versions: MergeRequestVersion[] }> {
      const connection = await requireConnection(deps);
      const raw = await rest<
        {
          id: number;
          head_commit_sha: string;
          base_commit_sha: string;
          start_commit_sha: string;
          created_at: string;
        }[]
      >(connection, `${mergeRequestPath(input)}/versions`, deps.fetch);
      return {
        versions: raw.map((version) => ({
          id: String(version.id),
          headSha: version.head_commit_sha,
          baseSha: version.base_commit_sha,
          startSha: version.start_commit_sha,
          createdAt: version.created_at,
        })),
      };
    },

    async commits(input: { projectPath: string; iid: string }): Promise<{ commits: Commit[] }> {
      const connection = await requireConnection(deps);
      const raw = await rest<RawCommit[]>(
        connection,
        `${mergeRequestPath(input)}/commits?per_page=100`,
        deps.fetch,
      );
      return { commits: raw.map(toCommit) };
    },

    async boards(input: { projectPath: string }): Promise<{ boards: BoardSummary[] }> {
      const connection = await requireConnection(deps);
      const raw = await graphql<RawBoards>(connection, BOARDS_QUERY, { path: input.projectPath }, deps.fetch);
      return {
        boards: (raw.project?.boards?.nodes ?? []).map(({ id, name, webUrl }) => ({ id, name, webUrl })),
      };
    },

    async boardColumns(input: { projectPath: string; boardId: string }): Promise<{ columns: BoardColumn[] }> {
      const connection = await requireConnection(deps);
      const raw = await graphql<RawBoardColumns>(
        connection,
        BOARD_COLUMNS_QUERY,
        { path: input.projectPath, id: input.boardId },
        deps.fetch,
      );
      return { columns: toBoardColumns(raw) };
    },

    async boardCards(input: {
      columnId: string;
      after: string | null;
      filters: BoardFilters;
    }): Promise<{ cards: BoardCard[]; count: number; endCursor: string | null; hasNextPage: boolean }> {
      const connection = await requireConnection(deps);
      const raw = await graphql<RawBoardCards>(
        connection,
        BOARD_CARDS_QUERY,
        {
          id: input.columnId,
          first: BOARD_PAGE_SIZE,
          after: input.after,
          filters: boardFilterVariables(input.filters),
        },
        deps.fetch,
      );
      return toBoardCards(raw);
    },

    async moveBoardCard(input: {
      projectPath: string;
      iid: string;
      boardId: string;
      fromColumnId: string;
      toColumnId: string;
      moveBeforeId?: string;
      moveAfterId?: string;
    }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(
        connection,
        deps,
        MOVE_BOARD_CARD_MUTATION,
        {
          projectPath: input.projectPath,
          iid: input.iid,
          boardId: input.boardId,
          fromListId: input.fromColumnId,
          toListId: input.toColumnId,
          moveBeforeId: input.moveBeforeId ?? null,
          moveAfterId: input.moveAfterId ?? null,
        },
        "move the issue",
      );
    },

    async createBoard(input: { projectPath: string; name: string }): Promise<BoardSummary> {
      const connection = await requireConnection(deps);
      const data = await graphql<{
        createBoard: { board: BoardSummary | null; errors?: string[] } | null;
      }>(
        connection,
        CREATE_BOARD_MUTATION,
        { projectPath: input.projectPath, name: input.name.trim() },
        deps.fetch,
      );
      assertNoMutationErrors(data.createBoard, "create the board");
      const board = data.createBoard?.board;
      if (!board) {
        throw new Error("GitLab did not return the new board.");
      }
      return { id: board.id, name: board.name, webUrl: board.webUrl };
    },

    async updateBoard(input: { boardId: string; name: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(
        connection,
        deps,
        UPDATE_BOARD_MUTATION,
        { id: input.boardId, name: input.name.trim() },
        "rename the board",
      );
    },

    async deleteBoard(input: { boardId: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(connection, deps, DESTROY_BOARD_MUTATION, { id: input.boardId }, "delete the board");
    },

    async addBoardColumn(input: { boardId: string; labelId: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(connection, deps, CREATE_BOARD_LIST_MUTATION, input, "add the list");
    },

    async removeBoardColumn(input: { columnId: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(
        connection,
        deps,
        DESTROY_BOARD_LIST_MUTATION,
        { listId: input.columnId },
        "remove the list",
      );
    },

    async createBoardCard(input: {
      projectPath: string;
      title: string;
      labelId: string | null;
    }): Promise<ItemRef> {
      const connection = await requireConnection(deps);
      const data = await graphql<{
        createIssue: { issue: { iid: string } | null; errors?: string[] } | null;
      }>(
        connection,
        CREATE_BOARD_ISSUE_MUTATION,
        {
          projectPath: input.projectPath,
          title: input.title.trim(),
          labelIds: input.labelId ? [input.labelId] : null,
        },
        deps.fetch,
      );
      assertNoMutationErrors(data.createIssue, "create the issue");
      const iid = data.createIssue?.issue?.iid;
      if (!iid) {
        throw new Error("GitLab did not return the new issue.");
      }
      return { kind: "issue", projectPath: input.projectPath, iid };
    },

    async milestones(input: { projectPath: string }): Promise<{ milestones: Milestone[] }> {
      const connection = await requireConnection(deps);
      const raw = await graphql<{
        project: { milestones: { nodes: Milestone[] } | null } | null;
      }>(connection, MILESTONES_QUERY, { path: input.projectPath }, deps.fetch);
      return {
        milestones: (raw.project?.milestones?.nodes ?? []).map(({ id, title, dueDate }) => ({
          id,
          title,
          dueDate: dueDate ?? null,
        })),
      };
    },

    async repoTree(input: {
      projectPath: string;
      ref: string;
      path: string;
    }): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
      const connection = await requireConnection(deps);
      const entries: TreeEntry[] = [];
      for (let page = 1; page <= MAX_TREE_PAGES; page += 1) {
        const batch = await rest<{ name: string; path: string; type: string }[]>(
          connection,
          `${projectPath(input.projectPath)}/repository/tree?ref=${encodeURIComponent(input.ref)}&path=${encodeURIComponent(input.path)}&per_page=100&page=${page}`,
          deps.fetch,
        );
        for (const entry of batch) {
          if (entry.type === "tree" || entry.type === "blob") {
            entries.push({ name: entry.name, path: entry.path, type: entry.type });
          }
        }
        if (batch.length < 100) {
          return { entries: sortEntries(entries), truncated: false };
        }
      }
      return { entries: sortEntries(entries), truncated: true };
    },

    async refCommits(input: {
      projectPath: string;
      ref: string;
      path?: string;
      page: number;
    }): Promise<{ commits: Commit[]; more: boolean }> {
      const connection = await requireConnection(deps);
      const pathFilter = input.path ? `&path=${encodeURIComponent(input.path)}` : "";
      const raw = await rest<RawCommit[]>(
        connection,
        `${projectPath(input.projectPath)}/repository/commits?ref_name=${encodeURIComponent(input.ref)}${pathFilter}&per_page=${COMMITS_PER_PAGE}&page=${input.page}`,
        deps.fetch,
      );
      return { commits: raw.map(toCommit), more: raw.length === COMMITS_PER_PAGE };
    },

    async branches(input: {
      projectPath: string;
      search: string;
    }): Promise<{ branches: Branch[]; defaultBranch: string | null }> {
      const connection = await requireConnection(deps);
      const search = input.search.trim() ? `&search=${encodeURIComponent(input.search.trim())}` : "";
      const [raw, project] = await Promise.all([
        rest<
          {
            name: string;
            default: boolean;
            protected: boolean;
            merged: boolean;
            can_push: boolean;
            web_url: string;
            commit: RawCommit;
          }[]
        >(
          connection,
          `${projectPath(input.projectPath)}/repository/branches?per_page=100${search}`,
          deps.fetch,
        ),
        rest<{ default_branch?: string | null }>(connection, projectPath(input.projectPath), deps.fetch),
      ]);
      const branches = raw
        .map((branch) => ({
          name: branch.name,
          isDefault: branch.default,
          protected: branch.protected,
          merged: branch.merged,
          canPush: branch.can_push,
          webUrl: branch.web_url,
          commit: toCommit(branch.commit),
        }))
        .sort((a, b) =>
          a.isDefault !== b.isDefault
            ? a.isDefault
              ? -1
              : 1
            : b.commit.createdAt.localeCompare(a.commit.createdAt),
        );
      return { branches, defaultBranch: project.default_branch ?? null };
    },

    async aheadBehind(input: {
      projectPath: string;
      branch: string;
      base: string;
    }): Promise<{ ahead: number; behind: number }> {
      const connection = await requireConnection(deps);
      const count = async (from: string, to: string) => {
        const result = await rest<{ commits: unknown[] }>(
          connection,
          `${projectPath(input.projectPath)}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          deps.fetch,
        );
        return result.commits.length;
      };
      const [ahead, behind] = await Promise.all([
        count(input.base, input.branch),
        count(input.branch, input.base),
      ]);
      return { ahead, behind };
    },

    async createBranch(input: { projectPath: string; name: string; ref: string }): Promise<{ name: string }> {
      const connection = await requireConnection(deps);
      const created = await restWrite<{ name: string }>(
        connection,
        "POST",
        `${projectPath(input.projectPath)}/repository/branches?branch=${encodeURIComponent(input.name)}&ref=${encodeURIComponent(input.ref)}`,
        undefined,
        deps.fetch,
      );
      return { name: created?.name ?? input.name };
    },

    async deleteBranch(input: { projectPath: string; name: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      await restWrite(
        connection,
        "DELETE",
        `${projectPath(input.projectPath)}/repository/branches/${encodeURIComponent(input.name)}`,
        undefined,
        deps.fetch,
      );
      return { ok: true };
    },

    async scopedDiffs(scope: DiffScope): Promise<{ files: DiffFile[]; truncated: boolean }> {
      const connection = await requireConnection(deps);
      switch (scope.kind) {
        case "mr":
          return fetchDiffs(connection, scope.projectPath, scope.iid, deps.fetch);
        case "compare":
          return fetchCompare(
            connection,
            scope.projectPath,
            scope.from,
            scope.to,
            deps.fetch,
            scope.mergeBase,
          );
        case "commit":
          return fetchCommitDiffs(connection, scope.projectPath, scope.sha, deps.fetch);
      }
    },

    async fileLines(input: {
      projectPath: string;
      path: string;
      ref: string;
    }): Promise<{ lines: string[] | null }> {
      const connection = await requireConnection(deps);
      const response = await deps.fetch(
        `${connection.host}/api/v4/projects/${encodeURIComponent(input.projectPath)}/repository/files/${encodeURIComponent(input.path)}/raw?ref=${encodeURIComponent(input.ref)}`,
        {
          headers: { Authorization: `Bearer ${connection.token}` },
          signal: AbortSignal.timeout(LOG_TIMEOUT_MS),
        },
      );
      if (response.status === 404) {
        return { lines: null };
      }
      if (!response.ok) {
        throw new GitLabError(`GitLab returned ${response.status} for the file.`, response.status);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_FILE_BYTES || bytes.subarray(0, 8000).includes(0)) {
        return { lines: null };
      }
      return { lines: bytes.toString("utf8").split("\n") };
    },

    async workspace(input: { directory: string }): Promise<WorkspaceState> {
      const connection = await requireConnection(deps);
      const checkout = await readCheckout(input.directory, connection.host);
      if (!checkout) {
        return { checkout: null, defaultBranch: null, mergeRequest: null, unresolvedThreads: 0 };
      }
      const raw = await graphql<RawWorkspace>(
        connection,
        WORKSPACE_QUERY,
        { path: checkout.projectPath, branch: checkout.branch },
        deps.fetch,
      );
      return {
        checkout,
        defaultBranch: raw.project?.repository?.rootRef ?? null,
        ...toWorkspaceMergeRequest(raw),
      };
    },

    async failedJobLogs(detail: Detail): Promise<FailedJobLog[]> {
      if (detail.kind !== "mr" || !detail.pipelineIid) {
        return [];
      }
      const pipeline = await handlers
        .pipeline({ projectPath: detail.projectPath, iid: detail.pipelineIid })
        .catch(() => null);
      return Promise.all(
        failedJobsOf(pipeline).map(async (job) => ({
          name: job.name,
          stage: job.stage,
          log: await handlers
            .jobLog({ projectPath: detail.projectPath, jobId: job.id })
            .catch(() => ({ lines: [], totalLines: 0 })),
        })),
      );
    },

    async agentPrompt(
      input:
        | { item: ItemRef }
        | { conflicts: ItemRef }
        | {
            job: {
              projectPath: string;
              jobId: string;
              name: string;
              webUrl: string;
              pipelineIid: string | null;
            };
          },
    ): Promise<{ title: string; text: string }> {
      if ("item" in input) {
        const detail = await handlers.detail(input.item);
        const failed = await handlers.failedJobLogs(detail);
        return {
          title: `${detail.reference}: ${detail.title}`.slice(0, 120),
          text: agentPrompt(detail, failed),
        };
      }
      if ("conflicts" in input) {
        const detail = await handlers.detail(input.conflicts);
        return {
          title: `Resolve conflicts in ${detail.reference}`.slice(0, 120),
          text: conflictPrompt(detail),
        };
      }
      const { job } = input;
      const [log, pipeline] = await Promise.all([
        handlers.jobLog({ projectPath: job.projectPath, jobId: job.jobId }),
        job.pipelineIid
          ? handlers.pipeline({ projectPath: job.projectPath, iid: job.pipelineIid }).catch(() => null)
          : Promise.resolve(null),
      ]);
      return { title: `Fix ${job.name}`.slice(0, 120), text: jobPrompt(job.name, job.webUrl, pipeline, log) };
    },

    async attachmentSearch(input: { query: string }): Promise<PluginAttachmentSearchPayload> {
      const connection = await requireConnection(deps);
      const lists = await cachedLists();
      const defaultProject =
        lists.mergeRequests[0]?.projectPath ??
        lists.issues[0]?.projectPath ??
        lists.reviewMergeRequests[0]?.projectPath ??
        null;
      const parsed = parseReference(input.query, connection.host, defaultProject);
      if (parsed?.kind === "job") {
        const log = await handlers.jobLog({ projectPath: parsed.projectPath, jobId: parsed.jobId });
        const id = numericId(parsed.jobId);
        const url = `${connection.host}/${parsed.projectPath}/-/jobs/${id}`;
        return {
          items: [
            {
              id: parsed.jobId,
              identifier: `job ${id}`,
              title: `Job ${id} log`,
              subtitle: parsed.projectPath,
              url,
              text: `GitLab job ${url}, last lines of its log:\n\`\`\`\n${logTail(log, 200)}\n\`\`\``,
              resourceType: "gitlab-job",
            },
          ],
        };
      }
      let refs: ItemRef[];
      if (parsed?.kind === "item") {
        refs = [parsed.ref];
      } else if (input.query.trim()) {
        refs = defaultProject
          ? searchHits(
              await graphql<RawSearchItems>(
                connection,
                SEARCH_ITEMS_QUERY,
                { search: input.query.trim(), path: defaultProject },
                deps.fetch,
              ),
            )
          : [];
      } else {
        refs = [...lists.reviewMergeRequests, ...lists.mergeRequests, ...lists.issues];
      }
      const unique = [
        ...new Map(refs.map((ref) => [`${ref.kind}:${ref.projectPath}:${ref.iid}`, ref])).values(),
      ].slice(0, 8);
      const details = await Promise.all(unique.map((ref) => handlers.detail(ref).catch(() => null)));
      return {
        items: details
          .filter((detail): detail is Detail => detail !== null)
          .map((detail) => ({
            id: `${detail.kind}:${detail.projectPath}:${detail.iid}`,
            identifier: detail.reference.replace(/^.*\//, ""),
            title: detail.title,
            subtitle: `${detail.kind === "mr" ? "Merge request" : "Issue"} · ${detail.state}`,
            url: detail.webUrl,
            text: itemContext(detail, []),
            resourceType: detail.kind === "mr" ? "gitlab-merge-request" : "gitlab-issue",
          })),
      };
    },
  };

  let listsCache: { at: number; lists: Promise<Lists> } | null = null;
  function cachedLists(): Promise<Lists> {
    if (!listsCache || Date.now() - listsCache.at > LISTS_CACHE_MS) {
      const lists = handlers.lists();
      listsCache = { at: Date.now(), lists };
      lists.catch(() => {
        listsCache = null;
      });
    }
    return listsCache.lists;
  }

  return handlers;
}
