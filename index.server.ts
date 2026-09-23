import type { PluginServerContext } from "@getpaseo/plugin/server";
import { connect, defaultAuthDeps, disconnect } from "./server/auth";
import { createHandlers } from "./server/handlers";
import {
  addDiffNoteRpc,
  addNoteRpc,
  deleteNoteRpc,
  diffsRpc,
  searchLabelsRpc,
  searchUsersRpc,
  setLabelsRpc,
  setPeopleRpc,
  updateItemRpc,
  updateNoteRpc,
  authConnectRpc,
  authDisconnectRpc,
  authStatusRpc,
  clientLogRpc,
  detailRpc,
  imageRpc,
  jobActionRpc,
  jobLogRpc,
  listsRpc,
  pipelineActionRpc,
  pipelineRpc,
  resolveRpc,
  todoDoneRpc,
} from "./shared/contract";

/** Server entry: the token and every GitLab request stay on this side. */
export default function contribute(server: PluginServerContext) {
  const deps = defaultAuthDeps();
  const handlers = createHandlers(deps);
  server.handle(authStatusRpc, handlers.status);
  server.handle(authConnectRpc, (input) => connect(deps, input));
  server.handle(authDisconnectRpc, () => disconnect(deps));
  server.handle(listsRpc, handlers.lists);
  server.handle(detailRpc, (input) => handlers.detail(input));
  server.handle(addNoteRpc, (input) => handlers.addNote(input));
  server.handle(updateNoteRpc, (input) => handlers.updateNote(input));
  server.handle(deleteNoteRpc, (input) => handlers.deleteNote(input));
  server.handle(updateItemRpc, (input) => handlers.updateItem(input));
  server.handle(setPeopleRpc, (input) => handlers.setPeople(input));
  server.handle(setLabelsRpc, (input) => handlers.setLabels(input));
  server.handle(searchUsersRpc, (input) => handlers.searchUsers(input));
  server.handle(searchLabelsRpc, (input) => handlers.searchLabels(input));
  server.handle(diffsRpc, (input) => handlers.diffs(input));
  server.handle(addDiffNoteRpc, (input) => handlers.addDiffNote(input));
  server.handle(resolveRpc, (input) => handlers.resolve(input));
  server.handle(imageRpc, (input) => handlers.image(input));
  server.handle(pipelineRpc, (input) => handlers.pipeline(input));
  server.handle(jobLogRpc, (input) => handlers.jobLog(input));
  server.handle(jobActionRpc, (input) => handlers.jobAction(input));
  server.handle(pipelineActionRpc, (input) => handlers.pipelineAction(input));
  server.handle(todoDoneRpc, (input) => handlers.todoDone(input));
  server.handle(clientLogRpc, ({ message }) => {
    console.error(`[gitlab client] ${message}`);
    return { ok: true as const };
  });
  return () => {};
}
