import { defineRpc as defineSdkRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import type { ZodType } from "zod";
import { z } from "zod";

const AccountFieldSchema = z.object({ account: z.string().optional() });

function defineRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(definition: {
  name: string;
  input: InputSchema;
  output: OutputSchema;
}) {
  return defineSdkRpc({ ...definition, input: z.intersection(definition.input, AccountFieldSchema) });
}

export const PersonSchema = z.object({
  username: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullish(),
});

export const LabelSchema = z.object({
  title: z.string(),
  color: z.string(),
  textColor: z.string(),
});

export const ItemKindSchema = z.enum(["issue", "mr"]);

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
  roles: z.array(z.enum(["author", "assignee"])),
  author: PersonSchema.nullable(),
  assignees: z.array(PersonSchema),
  reviewers: z.array(PersonSchema),
});

export const TodoSchema = z.object({
  id: z.string(),
  action: z.string(),
  author: PersonSchema.nullable(),
  createdAt: z.string(),
  body: z.string(),
  title: z.string(),
  reference: z.string().nullable(),
  webUrl: z.string().nullable(),
  target: ItemRefSchema.nullable(),
});

export const ListsSchema = z.object({
  todos: z.array(TodoSchema),
  issues: z.array(ListItemSchema),
  mergeRequests: z.array(ListItemSchema),
  reviewMergeRequests: z.array(ListItemSchema),
});

export const ReactionSchema = z.object({ name: z.string(), emoji: z.string(), users: z.array(z.string()) });

export const NotePositionSchema = z.object({
  path: z.string(),
  newLine: z.number().nullable(),
  oldLine: z.number().nullable(),
});

export const NoteSchema = z.object({
  id: z.string(),
  author: PersonSchema.nullable(),
  createdAt: z.string(),
  body: z.string(),
  bodyHtml: z.string(),
  system: z.boolean(),
  canEdit: z.boolean(),
  position: NotePositionSchema.nullable(),
  reactions: z.array(z.lazy(() => ReactionSchema)),
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
  id: z.string(),
  canEdit: z.boolean(),
  canComment: z.boolean(),
  description: z.string(),
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
  viewer: z.string(),
  approvedBy: z.array(z.string()),
  canApprove: z.boolean(),
  canMerge: z.boolean(),
  canPush: z.boolean(),
  mergeable: z.boolean(),
  hasConflicts: z.boolean(),
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
  artifacts: z.array(
    z.object({ name: z.string(), fileType: z.string(), size: z.number().nullable(), url: z.string() }),
  ),
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
  input: AccountFieldSchema,
  output: AuthStatusSchema,
});

export const authConnectRpc = defineRpc({
  name: "auth.connect",
  input: z.object({ host: z.string(), token: z.string() }),
  output: AuthStatusSchema,
});

export const authDisconnectRpc = defineRpc({
  name: "auth.disconnect",
  input: AccountFieldSchema,
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
    discussionId: z.string().optional(),
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
  output: z.object({ dataUrl: z.string().nullable() }),
});

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
    z.object({ conflicts: ItemRefSchema }),
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

export const DiffScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mr"), projectPath: z.string(), iid: z.string() }),
  z.object({
    kind: z.literal("compare"),
    projectPath: z.string(),
    from: z.string(),
    to: z.string(),
    mergeBase: z.boolean().optional(),
  }),
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
  output: z.object({ lines: z.array(z.string()).nullable() }),
});

export const TreeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["tree", "blob"]),
});

export type TreeEntry = z.output<typeof TreeEntrySchema>;

export const repoTreeRpc = defineRpc({
  name: "gitlab.repo.tree",
  input: z.object({ projectPath: z.string(), ref: z.string(), path: z.string() }),
  output: z.object({ entries: z.array(TreeEntrySchema), truncated: z.boolean() }),
});

export const refCommitsRpc = defineRpc({
  name: "gitlab.repo.commits",
  input: z.object({
    projectPath: z.string(),
    ref: z.string(),
    path: z.string().optional(),
    page: z.number().int().min(1),
  }),
  output: z.object({ commits: z.array(CommitSchema), more: z.boolean() }),
});

export const BranchSchema = z.object({
  name: z.string(),
  isDefault: z.boolean(),
  protected: z.boolean(),
  merged: z.boolean(),
  canPush: z.boolean(),
  webUrl: z.string(),
  commit: CommitSchema,
});

export type Branch = z.output<typeof BranchSchema>;

export const branchesRpc = defineRpc({
  name: "gitlab.repo.branches",
  input: z.object({ projectPath: z.string(), search: z.string() }),
  output: z.object({ branches: z.array(BranchSchema), defaultBranch: z.string().nullable() }),
});

export const aheadBehindRpc = defineRpc({
  name: "gitlab.repo.ahead-behind",
  input: z.object({ projectPath: z.string(), branch: z.string(), base: z.string() }),
  output: z.object({ ahead: z.number(), behind: z.number() }),
});

export const createBranchRpc = defineRpc({
  name: "gitlab.repo.branch.create",
  input: z.object({ projectPath: z.string(), name: z.string().min(1), ref: z.string().min(1) }),
  output: z.object({ name: z.string() }),
});

export const deleteBranchRpc = defineRpc({
  name: "gitlab.repo.branch.delete",
  input: z.object({ projectPath: z.string(), name: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});

export const accountsRpc = defineRpc({
  name: "auth.accounts",
  input: z.object({ directory: z.string().optional() }),
  output: z.object({
    hosts: z.array(z.string()),
    active: z.string().nullable(),
    forDirectory: z.string().nullable(),
  }),
});

export const BoardSummarySchema = z.object({ id: z.string(), name: z.string(), webUrl: z.string() });

export type BoardSummary = z.output<typeof BoardSummarySchema>;

export const boardsRpc = defineRpc({
  name: "gitlab.boards",
  input: z.object({ projectPath: z.string() }),
  output: z.object({ boards: z.array(BoardSummarySchema) }),
});

export const BoardColumnSchema = z.object({
  id: z.string(),
  title: z.string(),
  listType: z.string(),
  collapsed: z.boolean(),
  issuesCount: z.number(),
  label: DetailLabelSchema.nullable(),
});

export type BoardColumn = z.output<typeof BoardColumnSchema>;

export const boardColumnsRpc = defineRpc({
  name: "gitlab.board.columns",
  input: z.object({ projectPath: z.string(), boardId: z.string() }),
  output: z.object({ columns: z.array(BoardColumnSchema) }),
});

export const BoardFiltersSchema = z.object({
  search: z.string(),
  assignee: z.string().nullable(),
  labels: z.array(z.string()),
  author: z.string().nullable().default(null),
  milestone: z.string().nullable().default(null),
});

export type BoardFilters = z.output<typeof BoardFiltersSchema>;

export const BoardCardSchema = z.object({
  id: z.string(),
  kind: z.literal("issue"),
  projectPath: z.string(),
  iid: z.string(),
  reference: z.string(),
  title: z.string(),
  webUrl: z.string(),
  labels: z.array(LabelSchema),
  assignees: z.array(PersonSchema),
  milestone: z.string().nullable(),
  dueDate: z.string().nullable(),
  confidential: z.boolean(),
  userNotesCount: z.number(),
});

export type BoardCard = z.output<typeof BoardCardSchema>;

export const boardCardsRpc = defineRpc({
  name: "gitlab.board.cards",
  input: z.object({ columnId: z.string(), after: z.string().nullable(), filters: BoardFiltersSchema }),
  output: z.object({
    cards: z.array(BoardCardSchema),
    count: z.number(),
    endCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
  }),
});

export const moveBoardCardRpc = defineRpc({
  name: "gitlab.board.move",
  input: z.object({
    projectPath: z.string(),
    iid: z.string(),
    boardId: z.string(),
    fromColumnId: z.string(),
    toColumnId: z.string(),
    moveBeforeId: z.string().optional(),
    moveAfterId: z.string().optional(),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const createBoardRpc = defineRpc({
  name: "gitlab.board.create",
  input: z.object({ projectPath: z.string(), name: z.string().min(1) }),
  output: BoardSummarySchema,
});

export const updateBoardRpc = defineRpc({
  name: "gitlab.board.update",
  input: z.object({ boardId: z.string(), name: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});

export const deleteBoardRpc = defineRpc({
  name: "gitlab.board.delete",
  input: z.object({ boardId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const addBoardColumnRpc = defineRpc({
  name: "gitlab.board.column.add",
  input: z.object({ boardId: z.string(), labelId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const removeBoardColumnRpc = defineRpc({
  name: "gitlab.board.column.remove",
  input: z.object({ columnId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const createBoardCardRpc = defineRpc({
  name: "gitlab.board.card.create",
  input: z.object({ projectPath: z.string(), title: z.string().min(1), labelId: z.string().nullable() }),
  output: ItemRefSchema,
});

export const MilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueDate: z.string().nullable(),
});

export const milestonesRpc = defineRpc({
  name: "gitlab.milestones",
  input: z.object({ projectPath: z.string() }),
  output: z.object({ milestones: z.array(MilestoneSchema) }),
});

export type Milestone = z.output<typeof MilestoneSchema>;
