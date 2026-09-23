import type { PluginServerContext } from "@getpaseo/plugin/server";
import { connect, defaultAuthDeps, disconnect } from "./server/auth";
import { createHandlers } from "./server/handlers";
import {
  addNoteRpc,
  authConnectRpc,
  authDisconnectRpc,
  authStatusRpc,
  detailRpc,
  imageRpc,
  listsRpc,
  resolveRpc,
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
  server.handle(resolveRpc, (input) => handlers.resolve(input));
  server.handle(imageRpc, (input) => handlers.image(input));
  return () => {};
}
