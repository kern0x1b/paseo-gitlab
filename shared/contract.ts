import { defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Everything the client and the plugin server exchange. The token never appears
 * here: it goes in once through `auth.connect` and stays on the server, in the
 * Keychain.
 */

export const PersonSchema = z.object({
  username: z.string(),
  name: z.string(),
  /** Absolute (gravatar) or relative to the GitLab host (uploaded avatars). */
  avatarUrl: z.string().nullish(),
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
  author: PersonSchema.nullable(),
  assignees: z.array(PersonSchema),
  /** MRs only. */
  reviewers: z.array(PersonSchema),
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

/** One emoji on a note or MR, with who gave it. */
export const ReactionSchema = z.object({ name: z.string(), emoji: z.string(), users: z.array(z.string()) });

/** Where a code comment sits: the file and the line on either side of the diff. */
export const NotePositionSchema = z.object({
  path: z.string(),
  newLine: z.number().nullable(),
  oldLine: z.number().nullable(),
});

export const NoteSchema = z.object({
  id: z.string(),
  author: PersonSchema.nullable(),
  createdAt: z.string(),
  /** Markdown source, for editing. */
  body: z.string(),
  bodyHtml: z.string(),
  system: z.boolean(),
  /** GitLab's `adminNote`: your own notes, or any note if you administer the project. */
  canEdit: z.boolean(),
  position: NotePositionSchema.nullable(),
  reactions: z.array(z.lazy(() => ReactionSchema)),
  /** Suggested changes in the note; applying one commits it to the source branch. */
  suggestions: z.array(z.object({ id: z.string(), applied: z.boolean() })),
});

export const DiscussionSchema = z.object({
  id: z.string(),
  resolvable: z.boolean(),
  resolved: z.boolean(),
  notes: z.array(NoteSchema),
});

export const DetailLabelSchema = LabelSchema.extend({ id: z.string() });

export const DiffRefsSchema = z.object({ baseSha: z.string(), headSha: z.string(), startSha: z.string() });

export const DetailSchema = ItemRefSchema.extend({
  /** Global id; `createNote` addresses the issue or MR by it. */
  id: z.string(),
  canEdit: z.boolean(),
  canComment: z.boolean(),
  /** Markdown source, for editing. */
  description: z.string(),
  /** MRs only: the commits a code comment is anchored to. */
  diffRefs: DiffRefsSchema.nullable(),
  reference: z.string(),
  title: z.string(),
  state: z.string(),
  webUrl: z.string(),
  createdAt: z.string(),
  author: PersonSchema.nullable(),
  descriptionHtml: z.string(),
  labels: z.array(DetailLabelSchema),
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
  /** The connected user, for "you approved" and your own reactions. */
  viewer: z.string(),
  approvedBy: z.array(z.string()),
  canApprove: z.boolean(),
  canMerge: z.boolean(),
  /** Pushing to the source branch is what applying a suggestion or rebasing needs. */
  canPush: z.boolean(),
  mergeable: z.boolean(),
  autoMergeEnabled: z.boolean(),
  autoMergeStrategies: z.array(z.string()),
  shouldBeRebased: z.boolean(),
  rebaseInProgress: z.boolean(),
  reactions: z.array(ReactionSchema),
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
  /** Downloadable files the job kept; the log itself is left out. */
  artifacts: z.array(
    z.object({ name: z.string(), fileType: z.string(), size: z.number().nullable(), url: z.string() }),
  ),
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
export type NotePosition = z.output<typeof NotePositionSchema>;
export type Reaction = z.output<typeof ReactionSchema>;
export type DetailLabel = z.output<typeof DetailLabelSchema>;
export type DiffRefs = z.output<typeof DiffRefsSchema>;
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
    /** Set to reply inside a thread. */
    discussionId: z.string().optional(),
    /** Without `discussionId`: a plain comment, or a new resolvable thread. */
    mode: z.enum(["comment", "thread"]).default("comment"),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const updateNoteRpc = defineRpc({
  name: "gitlab.note.update",
  input: z.object({ id: z.string(), body: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});

export const deleteNoteRpc = defineRpc({
  name: "gitlab.note.delete",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const updateItemRpc = defineRpc({
  name: "gitlab.item.update",
  input: ItemRefSchema.extend({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    state: z.enum(["close", "reopen"]).optional(),
    /** MRs only. */
    draft: z.boolean().optional(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const setPeopleRpc = defineRpc({
  name: "gitlab.item.people",
  input: ItemRefSchema.extend({
    field: z.enum(["assignees", "reviewers"]),
    usernames: z.array(z.string()),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const setLabelsRpc = defineRpc({
  name: "gitlab.item.labels",
  input: ItemRefSchema.extend({ labelIds: z.array(z.string()) }),
  output: z.object({ ok: z.literal(true) }),
});

export const searchUsersRpc = defineRpc({
  name: "gitlab.users.search",
  input: z.object({ projectPath: z.string(), search: z.string() }),
  output: z.object({ users: z.array(PersonSchema) }),
});

export const searchLabelsRpc = defineRpc({
  name: "gitlab.labels.search",
  input: z.object({ projectPath: z.string(), search: z.string() }),
  output: z.object({ labels: z.array(DetailLabelSchema) }),
});

export const DiffLineSchema = z.object({
  kind: z.enum(["hunk", "context", "added", "removed"]),
  oldLine: z.number().nullable(),
  newLine: z.number().nullable(),
  /**
   * Where the line sits on both sides even when it exists on only one: GitLab's
   * `line_code` for multi-line comments is built from these two counters.
   */
  oldPos: z.number(),
  newPos: z.number(),
  text: z.string(),
});

export const DiffFileSchema = z.object({
  oldPath: z.string(),
  newPath: z.string(),
  newFile: z.boolean(),
  deletedFile: z.boolean(),
  renamedFile: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  /** Too large or collapsed by GitLab: no lines, only a link. */
  truncated: z.boolean(),
  lines: z.array(DiffLineSchema),
});

export type DiffLine = z.output<typeof DiffLineSchema>;
export type DiffFile = z.output<typeof DiffFileSchema>;

export const diffsRpc = defineRpc({
  name: "gitlab.mr.diffs",
  input: z.object({ projectPath: z.string(), iid: z.string() }),
  output: z.object({ files: z.array(DiffFileSchema), truncated: z.boolean() }),
});

export const addDiffNoteRpc = defineRpc({
  name: "gitlab.note.diff",
  input: z.object({
    noteableId: z.string(),
    body: z.string().min(1),
    diffRefs: DiffRefsSchema,
    oldPath: z.string(),
    newPath: z.string(),
    /** An added line has only `newLine`, a removed one only `oldLine`, context both. */
    oldLine: z.number().nullable(),
    newLine: z.number().nullable(),
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
  /** `full` lifts the usual cap on how many lines come back. */
  input: z.object({ projectPath: z.string(), jobId: z.string(), full: z.boolean().optional() }),
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

export const WorkspaceStateSchema = z.object({
  /** Null when the workspace is not a checkout of a project on the connected GitLab. */
  checkout: z.object({ branch: z.string(), projectPath: z.string() }).nullable(),
  defaultBranch: z.string().nullable(),
  mergeRequest: ListItemSchema.nullable(),
  unresolvedThreads: z.number(),
});

export type WorkspaceState = z.output<typeof WorkspaceStateSchema>;

export const workspaceRpc = defineRpc({
  name: "gitlab.workspace",
  input: z.object({ directory: z.string() }),
  output: WorkspaceStateSchema,
});

export const agentPromptRpc = defineRpc({
  name: "gitlab.agent.prompt",
  input: z.union([
    z.object({ item: ItemRefSchema }),
    z.object({
      job: z.object({
        projectPath: z.string(),
        jobId: z.string(),
        name: z.string(),
        webUrl: z.string(),
        pipelineIid: z.string().nullable(),
      }),
    }),
  ]),
  output: z.object({ title: z.string(), text: z.string() }),
});

/** Paseo's attachment picker calls this with `{ query }` as you type after `@GitLab`. */
export const attachmentSearchRpc = defineRpc({
  name: "gitlab.attachments.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const createIssueRpc = defineRpc({
  name: "gitlab.issue.create",
  input: z.object({ projectPath: z.string(), title: z.string().min(1), description: z.string() }),
  output: ItemRefSchema,
});

export const createMergeRequestRpc = defineRpc({
  name: "gitlab.mr.create",
  input: z.object({
    projectPath: z.string(),
    title: z.string().min(1),
    description: z.string(),
    sourceBranch: z.string(),
    targetBranch: z.string(),
  }),
  output: ItemRefSchema,
});

export const mergeRequestActionRpc = defineRpc({
  name: "gitlab.mr.action",
  input: ItemRefSchema.extend({
    action: z.enum(["approve", "unapprove", "merge", "auto_merge", "cancel_auto_merge", "rebase"]),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const applySuggestionRpc = defineRpc({
  name: "gitlab.suggestion.apply",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const toggleReactionRpc = defineRpc({
  name: "gitlab.reaction.toggle",
  input: z.object({ awardableId: z.string(), name: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const DraftNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  discussionId: z.string().nullable(),
  position: NotePositionSchema.nullable(),
});

export type DraftNote = z.output<typeof DraftNoteSchema>;

const MergeRequestRefSchema = z.object({ projectPath: z.string(), iid: z.string() });

export const draftsRpc = defineRpc({
  name: "gitlab.review.drafts",
  input: MergeRequestRefSchema,
  output: z.object({ drafts: z.array(DraftNoteSchema) }),
});

export const addDraftRpc = defineRpc({
  name: "gitlab.review.add",
  input: MergeRequestRefSchema.extend({
    body: z.string().min(1),
    discussionId: z.string().optional(),
    code: z
      .object({
        diffRefs: DiffRefsSchema,
        oldPath: z.string(),
        newPath: z.string(),
        oldLine: z.number().nullable(),
        newLine: z.number().nullable(),
      })
      .optional(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const deleteDraftRpc = defineRpc({
  name: "gitlab.review.delete",
  input: MergeRequestRefSchema.extend({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const submitReviewRpc = defineRpc({
  name: "gitlab.review.submit",
  input: MergeRequestRefSchema.extend({ approve: z.boolean() }),
  output: z.object({ ok: z.literal(true) }),
});

export const referenceSearchRpc = defineRpc({
  name: "gitlab.references.search",
  input: z.object({ projectPath: z.string(), kind: ItemKindSchema, term: z.string() }),
  output: z.object({ items: z.array(z.object({ iid: z.string(), title: z.string() })) }),
});

export const markdownPreviewRpc = defineRpc({
  name: "gitlab.markdown.preview",
  input: z.object({ projectPath: z.string(), text: z.string() }),
  output: z.object({ html: z.string() }),
});

export const uploadRpc = defineRpc({
  name: "gitlab.upload",
  input: z.object({
    projectPath: z.string(),
    filename: z.string().min(1).max(200),
    contentType: z.string(),
    /** Base64 of the file; capped so a pasted screenshot fits and a video does not. */
    base64: z.string().max(14_000_000),
  }),
  output: z.object({ markdown: z.string() }),
});

export const SearchQuerySchema = z.object({
  kind: ItemKindSchema,
  projectPath: z.string(),
  search: z.string(),
  state: z.enum(["opened", "closed", "merged", "all"]),
  label: z.string(),
  author: z.string(),
  assignee: z.string(),
});

export const SavedQuerySchema = SearchQuerySchema.extend({ id: z.string(), name: z.string() });

export type SearchQuery = z.output<typeof SearchQuerySchema>;
export type SavedQuery = z.output<typeof SavedQuerySchema>;

export const searchRpc = defineRpc({
  name: "gitlab.search",
  input: SearchQuerySchema,
  output: z.object({ items: z.array(ListItemSchema) }),
});

export const savedQueriesRpc = defineRpc({
  name: "gitlab.queries.list",
  input: z.object({}),
  output: z.object({ queries: z.array(SavedQuerySchema) }),
});

export const saveQueryRpc = defineRpc({
  name: "gitlab.queries.save",
  input: SearchQuerySchema.extend({ name: z.string().min(1).max(60) }),
  output: z.object({ queries: z.array(SavedQuerySchema) }),
});

export const deleteQueryRpc = defineRpc({
  name: "gitlab.queries.delete",
  input: z.object({ id: z.string() }),
  output: z.object({ queries: z.array(SavedQuerySchema) }),
});

export const runPipelineRpc = defineRpc({
  name: "gitlab.pipeline.run",
  input: z.object({ projectPath: z.string(), ref: z.string(), mergeRequestIid: z.string().optional() }),
  output: PipelineRefSchema,
});

const CodeLineSchema = DiffLineSchema.pick({
  kind: true,
  oldLine: true,
  newLine: true,
  oldPos: true,
  newPos: true,
});

/** A comment on one line or a range of lines of an MR's diff, published or saved to the review. */
export const addCodeCommentRpc = defineRpc({
  name: "gitlab.note.code",
  input: z.object({
    projectPath: z.string(),
    iid: z.string(),
    body: z.string().min(1),
    diffRefs: DiffRefsSchema,
    oldPath: z.string(),
    newPath: z.string(),
    start: CodeLineSchema,
    end: CodeLineSchema,
    asDraft: z.boolean(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

/** One push to the MR: GitLab keeps a version per head commit it saw. */
export const MergeRequestVersionSchema = z.object({
  id: z.string(),
  headSha: z.string(),
  baseSha: z.string(),
  startSha: z.string(),
  createdAt: z.string(),
});

export type MergeRequestVersion = z.output<typeof MergeRequestVersionSchema>;

export const versionsRpc = defineRpc({
  name: "gitlab.mr.versions",
  input: z.object({ projectPath: z.string(), iid: z.string() }),
  output: z.object({ versions: z.array(MergeRequestVersionSchema) }),
});

export const CommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  /** The first parent: a comment on the commit's own diff is anchored between the two. */
  parentSha: z.string().nullable(),
  title: z.string(),
  author: z.string(),
  createdAt: z.string(),
  webUrl: z.string(),
});

export type Commit = z.output<typeof CommitSchema>;

export const commitsRpc = defineRpc({
  name: "gitlab.mr.commits",
  input: z.object({ projectPath: z.string(), iid: z.string() }),
  output: z.object({ commits: z.array(CommitSchema) }),
});

/** What the diff panel shows: an MR's whole change, the change between two commits, or one commit. */
export const DiffScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mr"), projectPath: z.string(), iid: z.string() }),
  z.object({ kind: z.literal("compare"), projectPath: z.string(), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal("commit"), projectPath: z.string(), sha: z.string() }),
]);

export type DiffScope = z.output<typeof DiffScopeSchema>;

export const scopedDiffsRpc = defineRpc({
  name: "gitlab.diffs.scoped",
  input: DiffScopeSchema,
  output: z.object({ files: z.array(DiffFileSchema), truncated: z.boolean() }),
});

export const fileLinesRpc = defineRpc({
  name: "gitlab.file.lines",
  input: z.object({ projectPath: z.string(), path: z.string(), ref: z.string() }),
  /** The file split into lines, or null when it is binary or too large to show. */
  output: z.object({ lines: z.array(z.string()).nullable() }),
});
