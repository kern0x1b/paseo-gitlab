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
  /** Why the item is in the list: an issue or MR can be yours as author, as assignee, or both. */
  roles: z.array(z.enum(["author", "assignee"])),
});

/** A GitLab to-do: a mention, an assignment, a review request, a failed pipeline. */
export const TodoSchema = z.object({
  id: z.string(),
  action: z.string(),
  author: PersonSchema.nullable(),
  createdAt: z.string(),
  body: z.string(),
  title: z.string(),
  reference: z.string().nullable(),
  webUrl: z.string().nullable(),
  /** Set when the target is an issue or MR the panel can open. */
  target: ItemRefSchema.nullable(),
});

export const ListsSchema = z.object({
  todos: z.array(TodoSchema),
  issues: z.array(ListItemSchema),
  mergeRequests: z.array(ListItemSchema),
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
  pipelineIid: z.string().nullable(),
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

export const PipelineRefSchema = z.object({ projectPath: z.string(), iid: z.string() });

export const JobSchema = z.object({
  /** Global id, e.g. `gid://gitlab/Ci::Build/123`; the mutations take it as is. */
  id: z.string(),
  name: z.string(),
  status: z.string(),
  duration: z.number().nullable(),
  startedAt: z.string().nullable(),
  allowFailure: z.boolean(),
  manual: z.boolean(),
  retryable: z.boolean(),
  playable: z.boolean(),
  cancelable: z.boolean(),
  webUrl: z.string(),
  /** A trigger job's child or multi-project pipeline. */
  downstream: PipelineRefSchema.extend({ status: z.string() }).nullable(),
});

export const StageSchema = z.object({
  name: z.string(),
  status: z.string(),
  jobs: z.array(JobSchema),
});

export const PipelineSchema = PipelineRefSchema.extend({
  id: z.string(),
  status: z.string(),
  statusLabel: z.string().nullable(),
  ref: z.string(),
  sha: z.string(),
  duration: z.number().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  user: PersonSchema.nullable(),
  webUrl: z.string(),
  retryable: z.boolean(),
  cancelable: z.boolean(),
  stages: z.array(StageSchema),
});

export const LogColorSchema = z.enum(["red", "green", "yellow", "blue", "magenta", "cyan", "gray"]);

export const LogLineSchema = z.object({
  /** Set for a `section_start` marker: the line is the section's title. */
  section: z.boolean(),
  segments: z.array(z.object({ text: z.string(), color: LogColorSchema.nullable(), bold: z.boolean() })),
});

export const JobLogSchema = z.object({
  lines: z.array(LogLineSchema),
  totalLines: z.number(),
});

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
export type Todo = z.output<typeof TodoSchema>;
export type PipelineRef = z.output<typeof PipelineRefSchema>;
export type Job = z.output<typeof JobSchema>;
export type Stage = z.output<typeof StageSchema>;
export type Pipeline = z.output<typeof PipelineSchema>;
export type LogColor = z.output<typeof LogColorSchema>;
export type LogLine = z.output<typeof LogLineSchema>;
export type JobLog = z.output<typeof JobLogSchema>;

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

/**
 * Client code runs in Paseo's renderer, whose console nobody sees. Failures it
 * cannot show on screen are reported here and land in `paseo plugin logs gitlab`.
 */
export const clientLogRpc = defineRpc({
  name: "client.log",
  input: z.object({ message: z.string().max(2000) }),
  output: z.object({ ok: z.literal(true) }),
});

export const pipelineRpc = defineRpc({
  name: "gitlab.pipeline",
  input: PipelineRefSchema,
  output: PipelineSchema,
});

export const jobLogRpc = defineRpc({
  name: "gitlab.job.log",
  input: z.object({ projectPath: z.string(), jobId: z.string() }),
  output: JobLogSchema,
});

export const jobActionRpc = defineRpc({
  name: "gitlab.job.action",
  input: z.object({ jobId: z.string(), action: z.enum(["retry", "play", "cancel"]) }),
  output: z.object({ ok: z.literal(true) }),
});

export const pipelineActionRpc = defineRpc({
  name: "gitlab.pipeline.action",
  input: z.object({ pipelineId: z.string(), action: z.enum(["retry", "cancel"]) }),
  output: z.object({ ok: z.literal(true) }),
});

export const todoDoneRpc = defineRpc({
  name: "gitlab.todo.done",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
