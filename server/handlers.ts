import type { Detail, ItemRef, Lists } from "../shared/contract";
import { authStatus, requireConnection, type AuthDeps } from "./auth";
import { assertNoMutationErrors, graphql, rest, type Connection } from "./gitlab";
import { fetchImage } from "./images";
import {
  CREATE_NOTE_MUTATION,
  ISSUE_QUERY,
  LISTS_QUERY,
  MERGE_REQUEST_QUERY,
  TOGGLE_RESOLVE_MUTATION,
  toDetail,
  toLists,
  type RawIssueDetail,
  type RawLists,
  type RawMergeRequestDetail,
} from "./queries";

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

    async image(input: { src: string }): Promise<{ dataUrl: string | null }> {
      const connection = await requireConnection(deps);
      return { dataUrl: await fetchImage(connection, input.src, deps.fetch) };
    },
  };
}
