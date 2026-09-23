import type { PluginAttachmentSearchPayload } from "@getpaseo/plugin";
import type {
  Detail,
  DetailLabel,
  DiffFile,
  DiffRefs,
  ItemRef,
  JobLog,
  Lists,
  Person,
  Pipeline,
  PipelineRef,
  WorkspaceState,
} from "../shared/contract";
import { authStatus, requireConnection, type AuthDeps } from "./auth";
import { assertNoMutationErrors, graphql, GitLabError, rest, type Connection } from "./gitlab";
import { fetchDiffs } from "./diff";
import { fetchImage } from "./images";
import { parseJobLog } from "./log";
import { agentPrompt, failedJobsOf, itemContext, jobPrompt, logTail, type FailedJobLog } from "./agent-context";
import { readCheckout } from "./workspace";
import {
  CREATE_DIFF_NOTE_MUTATION,
  CREATE_ISSUE_MUTATION,
  CREATE_MERGE_REQUEST_MUTATION,
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
  LISTS_QUERY,
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
const LISTS_CACHE_MS = 60_000;

/** Every mutation here answers `{ <name>: { errors } }`; one check for all of them. */
async function mutate(
  connection: Connection,
  deps: AuthDeps,
  mutation: string,
  variables: Record<string, unknown>,
  action: string,
): Promise<{ ok: true }> {
  const data = await graphql<Record<string, { errors?: string[] } | null>>(connection, mutation, variables, deps.fetch);
  assertNoMutationErrors(Object.values(data)[0], action);
  return { ok: true };
}

/** The lists need the username; asking for it once per connection is enough. */
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
      return toLists(await graphql<RawLists>(connection, LISTS_QUERY, { me }, deps.fetch));
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
      return toDetail(ref.kind, raw);
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

    async updateItem(input: ItemRef & { title?: string; description?: string; state?: "close" | "reopen"; draft?: boolean }): Promise<{ ok: true }> {
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
        await mutate(connection, deps, SET_DRAFT_MUTATION, { ...target, draft: input.draft }, "change the draft status");
      }
      return { ok: true };
    },

    async setPeople(input: ItemRef & { field: "assignees" | "reviewers"; usernames: string[] }): Promise<{ ok: true }> {
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

    async diffs(input: { projectPath: string; iid: string }): Promise<{ files: DiffFile[]; truncated: boolean }> {
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
      const data = await graphql<RawPipeline>(connection, PIPELINE_QUERY, { path: ref.projectPath, iid: ref.iid }, deps.fetch);
      const raw = data.project?.pipeline;
      if (!raw) {
        throw new Error(`Pipeline #${ref.iid} in ${ref.projectPath} was not found.`);
      }
      return toPipeline(ref.projectPath, raw, connection.host);
    },

    async jobLog(input: { projectPath: string; jobId: string }): Promise<JobLog> {
      const connection = await requireConnection(deps);
      const id = numericId(input.jobId);
      if (!id) {
        throw new Error("Unknown job.");
      }
      const response = await deps.fetch(
        `${connection.host}/api/v4/projects/${encodeURIComponent(input.projectPath)}/jobs/${id}/trace`,
        { headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(LOG_TIMEOUT_MS) },
      );
      if (!response.ok) {
        throw new GitLabError(`GitLab returned ${response.status} for the job log.`, response.status);
      }
      return parseJobLog(await response.text());
    },

    async jobAction(input: { jobId: string; action: "retry" | "play" | "cancel" }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      return mutate(connection, deps, JOB_MUTATIONS[input.action], { id: input.jobId }, `${input.action} the job`);
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
      const data = await graphql<{ createIssue: { issue: { iid: string } | null; errors?: string[] } | null }>(
        connection,
        CREATE_ISSUE_MUTATION,
        input,
        deps.fetch,
      );
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
      const pipeline = await handlers.pipeline({ projectPath: detail.projectPath, iid: detail.pipelineIid }).catch(() => null);
      return Promise.all(
        failedJobsOf(pipeline).map(async (job) => ({
          name: job.name,
          stage: job.stage,
          log: await handlers.jobLog({ projectPath: detail.projectPath, jobId: job.id }).catch(() => ({ lines: [], totalLines: 0 })),
        })),
      );
    },

    async agentPrompt(
      input:
        | { item: ItemRef }
        | { job: { projectPath: string; jobId: string; name: string; webUrl: string; pipelineIid: string | null } },
    ): Promise<{ title: string; text: string }> {
      if ("item" in input) {
        const detail = await handlers.detail(input.item);
        const failed = await handlers.failedJobLogs(detail);
        return { title: `${detail.reference}: ${detail.title}`.slice(0, 120), text: agentPrompt(detail, failed) };
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
        lists.mergeRequests[0]?.projectPath ?? lists.issues[0]?.projectPath ?? lists.reviewMergeRequests[0]?.projectPath ?? null;
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
      const unique = [...new Map(refs.map((ref) => [`${ref.kind}:${ref.projectPath}:${ref.iid}`, ref])).values()].slice(0, 8);
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

  /** The picker searches as you type; the lists behind its defaults change far more slowly. */
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
