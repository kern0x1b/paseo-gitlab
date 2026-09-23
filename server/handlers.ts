import type { Detail, ItemRef, JobLog, Lists, Pipeline, PipelineRef } from "../shared/contract";
import { authStatus, requireConnection, type AuthDeps } from "./auth";
import { assertNoMutationErrors, graphql, GitLabError, rest, type Connection } from "./gitlab";
import { fetchImage } from "./images";
import { parseJobLog } from "./log";
import {
  CREATE_NOTE_MUTATION,
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
  toPipeline,
  type RawPipeline,
  type RawIssueDetail,
  type RawLists,
  type RawMergeRequestDetail,
} from "./queries";

const LOG_TIMEOUT_MS = 30_000;

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
  return {
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

    async addNote(input: { noteableId: string; body: string; discussionId?: string }): Promise<{ ok: true }> {
      const connection = await requireConnection(deps);
      const data = await graphql<{ createNote: { errors?: string[] } | null }>(
        connection,
        CREATE_NOTE_MUTATION,
        { noteableId: input.noteableId, body: input.body, discussionId: input.discussionId ?? null },
        deps.fetch,
      );
      assertNoMutationErrors(data.createNote, "post the comment");
      return { ok: true };
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
  };
}
