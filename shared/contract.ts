import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Everything the client and the plugin server exchange. The token never appears
 * here: it goes in once through `auth.connect` and stays on the server, in the
 * Keychain.
 */

export const PersonSchema = z.object({
  username: z.string(),
  name: z.string(),
});

export const LabelSchema = z.object({
  title: z.string(),
  color: z.string(),
  textColor: z.string(),
});

export const ItemKindSchema = z.enum(["issue", "mr"]);

/** Enough to address an item again: GraphQL looks issues and MRs up by project path and iid. */
export const ItemRefSchema = z.object({
  kind: ItemKindSchema,
  projectPath: z.string(),
  iid: z.string(),
});

export const ListItemSchema = ItemRefSchema.extend({
  reference: z.string(),
  title: z.string(),
  webUrl: z.string(),
  updatedAt: z.string(),
  userNotesCount: z.number(),
  labels: z.array(LabelSchema),
  draft: z.boolean(),
  confidential: z.boolean(),
  pipelineStatus: z.string().nullable(),
  mergeStatus: z.string().nullable(),
});

export const ListsSchema = z.object({
  issues: z.array(ListItemSchema),
  authoredMergeRequests: z.array(ListItemSchema),
  reviewMergeRequests: z.array(ListItemSchema),
});

export const NoteSchema = z.object({
  id: z.string(),
  author: PersonSchema.nullable(),
  createdAt: z.string(),
  bodyHtml: z.string(),
  system: z.boolean(),
});

export const DiscussionSchema = z.object({
  id: z.string(),
  resolvable: z.boolean(),
  resolved: z.boolean(),
  notes: z.array(NoteSchema),
});

export const DetailSchema = ItemRefSchema.extend({
  /** Global id; `createNote` addresses the issue or MR by it. */
  id: z.string(),
  reference: z.string(),
  title: z.string(),
  state: z.string(),
  webUrl: z.string(),
  createdAt: z.string(),
  author: PersonSchema.nullable(),
  descriptionHtml: z.string(),
  labels: z.array(LabelSchema),
  assignees: z.array(PersonSchema),
  reviewers: z.array(PersonSchema),
  milestone: z.string().nullable(),
  draft: z.boolean(),
  sourceBranch: z.string().nullable(),
  targetBranch: z.string().nullable(),
  pipelineStatus: z.string().nullable(),
  mergeStatus: z.string().nullable(),
  approved: z.boolean().nullable(),
  discussions: z.array(DiscussionSchema),
});

export const AuthStatusSchema = z.discriminatedUnion("connected", [
  z.object({
    connected: z.literal(false),
    host: z.string().nullable(),
    /** Why a stored token no longer works, when that is the reason. */
    error: z.string().nullable(),
  }),
  z.object({
    connected: z.literal(true),
    host: z.string(),
    user: PersonSchema,
    token: z.object({
      name: z.string(),
      scopes: z.array(z.string()),
      expiresAt: z.string().nullable(),
    }),
  }),
]);

export type Person = z.output<typeof PersonSchema>;
export type Label = z.output<typeof LabelSchema>;
export type ItemKind = z.output<typeof ItemKindSchema>;
export type ItemRef = z.output<typeof ItemRefSchema>;
export type ListItem = z.output<typeof ListItemSchema>;
export type Lists = z.output<typeof ListsSchema>;
export type Note = z.output<typeof NoteSchema>;
export type Discussion = z.output<typeof DiscussionSchema>;
export type Detail = z.output<typeof DetailSchema>;
export type AuthStatus = z.output<typeof AuthStatusSchema>;

export const authStatusRpc = defineRpc({
  name: "auth.status",
  input: z.object({}),
  output: AuthStatusSchema,
});

export const authConnectRpc = defineRpc({
  name: "auth.connect",
  input: z.object({ host: z.string(), token: z.string() }),
  output: AuthStatusSchema,
});

export const authDisconnectRpc = defineRpc({
  name: "auth.disconnect",
  input: z.object({}),
  output: AuthStatusSchema,
});

export const listsRpc = defineRpc({
  name: "gitlab.lists",
  input: z.object({}),
  output: ListsSchema,
});

export const detailRpc = defineRpc({
  name: "gitlab.detail",
  input: ItemRefSchema,
  output: DetailSchema,
});

export const addNoteRpc = defineRpc({
  name: "gitlab.note.add",
  input: z.object({
    noteableId: z.string(),
    body: z.string().min(1),
    /** Set to reply inside a thread; left out, the note starts a new one. */
    discussionId: z.string().optional(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const resolveRpc = defineRpc({
  name: "gitlab.discussion.resolve",
  input: z.object({ discussionId: z.string(), resolve: z.boolean() }),
  output: z.object({ resolved: z.boolean() }),
});

export const imageRpc = defineRpc({
  name: "gitlab.image",
  input: z.object({ src: z.string() }),
  /** Null when GitLab will not hand the file to this token; the client links to it instead. */
  output: z.object({ dataUrl: z.string().nullable() }),
});
