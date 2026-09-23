import type {
  Detail,
  Discussion,
  ItemKind,
  ItemRef,
  Job,
  Label,
  ListItem,
  Lists,
  Person,
  Pipeline,
  Reaction,
  Todo,
} from "../shared/contract";

/**
 * GraphQL rather than REST: it returns GitLab's own rendered HTML for descriptions
 * and notes (`descriptionHtml`, `bodyHtml`), so references, task lists, tables and
 * code blocks look the way they do on the site without a markdown renderer here.
 */

const PERSON = "username name";
const LABELS = "labels { nodes { title color textColor } }";
const LABELS_WITH_ID = "labels { nodes { id title color textColor } }";

const MR_ROW = `
  iid title webUrl reference(full: true) updatedAt userNotesCount draft detailedMergeStatus
  headPipeline { iid status }
  ${LABELS}`;

const ISSUE_ROW = `iid title webUrl reference(full: true) updatedAt userNotesCount confidential ${LABELS}`;

const LIST_ARGS = "state: opened, first: 50, sort: UPDATED_DESC";

/**
 * Issues and MRs where you are the author or the assignee, the MRs waiting for
 * your review, and your pending to-dos, in one round trip.
 */
export const LISTS_QUERY = `
query PaseoGitLabLists($me: String!) {
  currentUser {
    authoredMergeRequests(${LIST_ARGS}) { nodes { ${MR_ROW} } }
    assignedMergeRequests(${LIST_ARGS}) { nodes { ${MR_ROW} } }
    reviewRequestedMergeRequests(${LIST_ARGS}) { nodes { ${MR_ROW} } }
    todos(state: [pending], first: 50) {
      nodes {
        id action body createdAt targetType targetUrl
        author { ${PERSON} }
        target { webUrl ... on Issue { iid title reference(full: true) } ... on MergeRequest { iid title reference(full: true) } }
      }
    }
  }
  assignedIssues: issues(assigneeUsernames: [$me], ${LIST_ARGS}) { nodes { ${ISSUE_ROW} } }
  authoredIssues: issues(authorUsername: $me, ${LIST_ARGS}) { nodes { ${ISSUE_ROW} } }
}`;

const DISCUSSIONS = `
  discussions(first: 100) {
    nodes {
      id resolvable resolved
      notes {
        nodes {
          id body bodyHtml system createdAt
          author { ${PERSON} }
          userPermissions { adminNote }
          position { filePath newLine oldLine positionType }
          awardEmoji { nodes { name emoji user { username } } }
          suggestions { nodes { id applied } }
        }
      }
    }
  }`;

export const ISSUE_QUERY = `
query PaseoGitLabIssue($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    issue(iid: $iid) {
      id iid title state webUrl reference(full: true) createdAt description descriptionHtml confidential
      userPermissions { canEdit: updateIssue canComment: createNote }
      author { ${PERSON} }
      assignees { nodes { ${PERSON} } }
      milestone { title }
      ${LABELS_WITH_ID}
      ${DISCUSSIONS}
    }
  }
}`;

export const MERGE_REQUEST_QUERY = `
query PaseoGitLabMergeRequest($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      id iid title state webUrl reference(full: true) createdAt description descriptionHtml draft
      sourceBranch targetBranch detailedMergeStatus approved
      userPermissions {
        canEdit: updateMergeRequest canComment: createNote canApprove canMerge canPush: pushToSourceBranch
      }
      diffRefs { baseSha headSha startSha }
      approvedBy { nodes { username } }
      mergeable autoMergeEnabled availableAutoMergeStrategies shouldBeRebased rebaseInProgress
      awardEmoji { nodes { name emoji user { username } } }
      headPipeline { iid status }
      author { ${PERSON} }
      assignees { nodes { ${PERSON} } }
      reviewers { nodes { ${PERSON} } }
      milestone { title }
      ${LABELS_WITH_ID}
      ${DISCUSSIONS}
    }
  }
}`;

export const CREATE_NOTE_MUTATION = `
mutation PaseoGitLabCreateNote($noteableId: NoteableID!, $body: String!, $discussionId: DiscussionID) {
  createNote(input: { noteableId: $noteableId, body: $body, discussionId: $discussionId }) {
    note { id }
    errors
  }
}`;

export const PIPELINE_QUERY = `
query PaseoGitLabPipeline($path: ID!, $iid: ID!) {
  project(fullPath: $path) {
    pipeline(iid: $iid) {
      id iid status ref sha duration createdAt finishedAt path retryable cancelable
      user { ${PERSON} }
      detailedStatus { label }
      stages {
        nodes {
          name status
          jobs(first: 100) {
            nodes {
              id name status duration startedAt allowFailure manualJob retryable cancelable playable webPath
              downstreamPipeline { iid status project { fullPath } }
            }
          }
        }
      }
    }
  }
}`;

const MUTATION_RESULT = "errors";

export const JOB_MUTATIONS = {
  retry: `mutation PaseoGitLabJobRetry($id: CiProcessableID!) { jobRetry(input: { id: $id }) { ${MUTATION_RESULT} } }`,
  play: `mutation PaseoGitLabJobPlay($id: CiProcessableID!) { jobPlay(input: { id: $id }) { ${MUTATION_RESULT} } }`,
  cancel: `mutation PaseoGitLabJobCancel($id: CiBuildID!) { jobCancel(input: { id: $id }) { ${MUTATION_RESULT} } }`,
} as const;

export const PIPELINE_MUTATIONS = {
  retry: `mutation PaseoGitLabPipelineRetry($id: CiPipelineID!) { pipelineRetry(input: { id: $id }) { ${MUTATION_RESULT} } }`,
  cancel: `mutation PaseoGitLabPipelineCancel($id: CiPipelineID!) { pipelineCancel(input: { id: $id }) { ${MUTATION_RESULT} } }`,
} as const;

export const TODO_DONE_MUTATION = `
mutation PaseoGitLabTodoDone($id: TodoID!) { todoMarkDone(input: { id: $id }) { ${MUTATION_RESULT} } }`;

export const CREATE_DISCUSSION_MUTATION = `
mutation PaseoGitLabCreateDiscussion($noteableId: NoteableID!, $body: String!) {
  createDiscussion(input: { noteableId: $noteableId, body: $body }) { ${MUTATION_RESULT} }
}`;

export const CREATE_DIFF_NOTE_MUTATION = `
mutation PaseoGitLabCreateDiffNote($noteableId: NoteableID!, $body: String!, $position: DiffPositionInput!) {
  createDiffNote(input: { noteableId: $noteableId, body: $body, position: $position }) { ${MUTATION_RESULT} }
}`;

export const UPDATE_NOTE_MUTATION = `
mutation PaseoGitLabUpdateNote($id: NoteID!, $body: String!) { updateNote(input: { id: $id, body: $body }) { ${MUTATION_RESULT} } }`;

export const DESTROY_NOTE_MUTATION = `
mutation PaseoGitLabDestroyNote($id: NoteID!) { destroyNote(input: { id: $id }) { ${MUTATION_RESULT} } }`;

export const UPDATE_ISSUE_MUTATION = `
mutation PaseoGitLabUpdateIssue(
  $projectPath: ID!, $iid: String!, $title: String, $description: String, $stateEvent: IssueStateEvent, $labelIds: [ID!]
) {
  updateIssue(input: {
    projectPath: $projectPath, iid: $iid, title: $title, description: $description, stateEvent: $stateEvent, labelIds: $labelIds
  }) { ${MUTATION_RESULT} }
}`;

export const UPDATE_MERGE_REQUEST_MUTATION = `
mutation PaseoGitLabUpdateMergeRequest(
  $projectPath: ID!, $iid: String!, $title: String, $description: String, $state: MergeRequestNewState
) {
  mergeRequestUpdate(input: { projectPath: $projectPath, iid: $iid, title: $title, description: $description, state: $state }) {
    ${MUTATION_RESULT}
  }
}`;

export const SET_DRAFT_MUTATION = `
mutation PaseoGitLabSetDraft($projectPath: ID!, $iid: String!, $draft: Boolean!) {
  mergeRequestSetDraft(input: { projectPath: $projectPath, iid: $iid, draft: $draft }) { ${MUTATION_RESULT} }
}`;

export const SET_MERGE_REQUEST_LABELS_MUTATION = `
mutation PaseoGitLabSetMergeRequestLabels($projectPath: ID!, $iid: String!, $labelIds: [LabelID!]!) {
  mergeRequestSetLabels(input: { projectPath: $projectPath, iid: $iid, labelIds: $labelIds, operationMode: REPLACE }) {
    ${MUTATION_RESULT}
  }
}`;

export const SET_PEOPLE_MUTATIONS = {
  issueAssignees: `
mutation PaseoGitLabIssueAssignees($projectPath: ID!, $iid: String!, $usernames: [String!]!) {
  issueSetAssignees(input: { projectPath: $projectPath, iid: $iid, assigneeUsernames: $usernames, operationMode: REPLACE }) {
    ${MUTATION_RESULT}
  }
}`,
  mrAssignees: `
mutation PaseoGitLabMergeRequestAssignees($projectPath: ID!, $iid: String!, $usernames: [String!]!) {
  mergeRequestSetAssignees(input: { projectPath: $projectPath, iid: $iid, assigneeUsernames: $usernames, operationMode: REPLACE }) {
    ${MUTATION_RESULT}
  }
}`,
  mrReviewers: `
mutation PaseoGitLabMergeRequestReviewers($projectPath: ID!, $iid: String!, $usernames: [String!]!) {
  mergeRequestSetReviewers(input: { projectPath: $projectPath, iid: $iid, reviewerUsernames: $usernames, operationMode: REPLACE }) {
    ${MUTATION_RESULT}
  }
}`,
} as const;

export const SEARCH_USERS_QUERY = `
query PaseoGitLabSearchUsers($path: ID!, $search: String!) {
  project(fullPath: $path) { autocompleteUsers(search: $search) { ${PERSON} } }
}`;

export const SEARCH_LABELS_QUERY = `
query PaseoGitLabSearchLabels($path: ID!, $search: String) {
  project(fullPath: $path) {
    labels(searchTerm: $search, includeAncestorGroups: true, first: 40) { nodes { id title color textColor } }
  }
}`;

export const TOGGLE_RESOLVE_MUTATION = `
mutation PaseoGitLabToggleResolve($id: DiscussionID!, $resolve: Boolean!) {
  discussionToggleResolve(input: { id: $id, resolve: $resolve }) {
    discussion { resolved }
    errors
  }
}`;

type Nodes<T> = { nodes: T[] } | null | undefined;

interface RawLabel {
  title: string;
  color: string;
  textColor: string;
}

interface RawRow {
  iid: string;
  title: string;
  webUrl: string;
  reference: string;
  updatedAt: string;
  userNotesCount?: number | null;
  draft?: boolean | null;
  confidential?: boolean | null;
  detailedMergeStatus?: string | null;
  headPipeline?: { iid?: string; status: string } | null;
  labels?: Nodes<RawLabel>;
}

interface RawTodo {
  id: string;
  action: string;
  body: string | null;
  createdAt: string;
  targetType: string;
  targetUrl: string | null;
  author: Person | null;
  target: { webUrl?: string | null; iid?: string; title?: string; reference?: string } | null;
}

export interface RawLists {
  currentUser: {
    authoredMergeRequests: Nodes<RawRow>;
    assignedMergeRequests: Nodes<RawRow>;
    reviewRequestedMergeRequests: Nodes<RawRow>;
    todos: Nodes<RawTodo>;
  } | null;
  assignedIssues: Nodes<RawRow>;
  authoredIssues: Nodes<RawRow>;
}

interface RawJob {
  id: string;
  name: string;
  status: string;
  duration: number | null;
  startedAt: string | null;
  allowFailure: boolean;
  manualJob: boolean | null;
  retryable: boolean;
  cancelable: boolean;
  playable: boolean;
  webPath: string | null;
  downstreamPipeline: { iid: string; status: string; project: { fullPath: string } | null } | null;
}

export interface RawPipeline {
  project: {
    pipeline: {
      id: string;
      iid: string;
      status: string;
      ref: string | null;
      sha: string | null;
      duration: number | null;
      createdAt: string;
      finishedAt: string | null;
      path: string | null;
      retryable: boolean;
      cancelable: boolean;
      user: Person | null;
      detailedStatus: { label: string | null } | null;
      stages: Nodes<{ name: string; status: string; jobs: Nodes<RawJob> }>;
    } | null;
  } | null;
}

interface RawAward {
  name: string;
  emoji: string;
  user: { username: string } | null;
}

/** GitLab lists one award per user; the UI wants one chip per emoji with its people. */
export function toReactions(connection: Nodes<RawAward>): Reaction[] {
  const byName = new Map<string, Reaction>();
  for (const award of nodes(connection)) {
    const reaction = byName.get(award.name) ?? { name: award.name, emoji: award.emoji, users: [] };
    if (award.user) {
      reaction.users.push(award.user.username);
    }
    byName.set(award.name, reaction);
  }
  return [...byName.values()];
}

interface RawNote {
  id: string;
  body?: string | null;
  bodyHtml: string | null;
  system: boolean;
  createdAt: string;
  author: Person | null;
  userPermissions?: { adminNote: boolean } | null;
  awardEmoji?: Nodes<RawAward>;
  suggestions?: Nodes<{ id: string; applied: boolean }>;
  position?: { filePath: string; newLine: number | null; oldLine: number | null; positionType: string } | null;
}

interface RawDiscussion {
  id: string;
  resolvable: boolean;
  resolved: boolean;
  notes: Nodes<RawNote>;
}

export interface RawDetail {
  id: string;
  iid: string;
  title: string;
  state: string;
  webUrl: string;
  reference: string;
  createdAt: string;
  description?: string | null;
  descriptionHtml: string | null;
  userPermissions?: {
    canEdit: boolean;
    canComment: boolean;
    canApprove?: boolean;
    canMerge?: boolean;
    canPush?: boolean;
  } | null;
  approvedBy?: Nodes<{ username: string }>;
  mergeable?: boolean | null;
  autoMergeEnabled?: boolean | null;
  availableAutoMergeStrategies?: string[] | null;
  shouldBeRebased?: boolean | null;
  rebaseInProgress?: boolean | null;
  awardEmoji?: Nodes<RawAward>;
  diffRefs?: { baseSha: string; headSha: string; startSha: string } | null;
  draft?: boolean | null;
  sourceBranch?: string | null;
  targetBranch?: string | null;
  detailedMergeStatus?: string | null;
  approved?: boolean | null;
  headPipeline?: { iid?: string; status: string } | null;
  author: Person | null;
  assignees?: Nodes<Person>;
  reviewers?: Nodes<Person>;
  milestone?: { title: string } | null;
  labels?: Nodes<RawLabel & { id: string }>;
  discussions?: Nodes<RawDiscussion>;
}

export interface RawIssueDetail {
  project: { issue: RawDetail | null } | null;
}

export interface RawMergeRequestDetail {
  project: { mergeRequest: RawDetail | null } | null;
}

function nodes<T>(connection: Nodes<T>): T[] {
  return connection?.nodes ?? [];
}

/** `group/sub/project#12` or `group/project!34` → `group/sub/project`. */
export function projectPathOf(reference: string): string {
  const match = reference.match(/^(.*)[#!]\d+$/);
  return match?.[1] ?? reference;
}

function labels(connection: Nodes<RawLabel>): Label[] {
  return nodes(connection).map(({ title, color, textColor }) => ({ title, color, textColor }));
}

function toListItem(kind: ItemKind, row: RawRow, roles: ListItem["roles"]): ListItem {
  return {
    kind,
    projectPath: projectPathOf(row.reference),
    iid: row.iid,
    reference: row.reference,
    title: row.title,
    webUrl: row.webUrl,
    updatedAt: row.updatedAt,
    userNotesCount: row.userNotesCount ?? 0,
    labels: labels(row.labels),
    draft: row.draft ?? false,
    confidential: row.confidential ?? false,
    pipelineStatus: row.headPipeline?.status ?? null,
    mergeStatus: row.detailedMergeStatus ?? null,
    roles,
  };
}

/** Authored and assigned merged into one list, newest first, each item once with both roles. */
function mine(kind: ItemKind, authored: RawRow[], assigned: RawRow[]): ListItem[] {
  const byReference = new Map<string, ListItem>();
  for (const [rows, role] of [
    [authored, "author"],
    [assigned, "assignee"],
  ] as const) {
    for (const row of rows) {
      const existing = byReference.get(row.reference);
      if (existing) {
        existing.roles.push(role);
      } else {
        byReference.set(row.reference, toListItem(kind, row, [role]));
      }
    }
  }
  return [...byReference.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function targetRef(todo: RawTodo): ItemRef | null {
  const kind = todo.targetType === "ISSUE" ? "issue" : todo.targetType === "MERGEREQUEST" ? "mr" : null;
  const reference = todo.target?.reference;
  const iid = todo.target?.iid;
  return kind && reference && iid ? { kind, projectPath: projectPathOf(reference), iid } : null;
}

function toTodo(todo: RawTodo): Todo {
  return {
    id: todo.id,
    action: todo.action,
    author: todo.author,
    createdAt: todo.createdAt,
    body: todo.body ?? "",
    title: todo.target?.title ?? todo.body ?? "",
    reference: todo.target?.reference ?? null,
    webUrl: todo.target?.webUrl ?? todo.targetUrl,
    target: targetRef(todo),
  };
}

export function toLists(raw: RawLists): Lists {
  return {
    todos: nodes(raw.currentUser?.todos).map(toTodo),
    issues: mine("issue", nodes(raw.authoredIssues), nodes(raw.assignedIssues)),
    mergeRequests: mine(
      "mr",
      nodes(raw.currentUser?.authoredMergeRequests),
      nodes(raw.currentUser?.assignedMergeRequests),
    ),
    reviewMergeRequests: nodes(raw.currentUser?.reviewRequestedMergeRequests).map((row) =>
      toListItem("mr", row, []),
    ),
  };
}

function toDiscussion(raw: RawDiscussion): Discussion {
  return {
    id: raw.id,
    resolvable: raw.resolvable,
    resolved: raw.resolved,
    notes: nodes(raw.notes).map((note) => ({
      id: note.id,
      author: note.author,
      createdAt: note.createdAt,
      body: note.body ?? "",
      bodyHtml: note.bodyHtml ?? "",
      system: note.system,
      canEdit: note.userPermissions?.adminNote ?? false,
      // Image notes on designs carry a position too, but no line to show.
      position:
        note.position && note.position.positionType === "text"
          ? { path: note.position.filePath, newLine: note.position.newLine, oldLine: note.position.oldLine }
          : null,
      reactions: toReactions(note.awardEmoji),
      suggestions: nodes(note.suggestions).map(({ id, applied }) => ({ id, applied })),
    })),
  };
}

export function toDetail(kind: ItemKind, raw: RawDetail, viewer: string): Detail {
  return {
    viewer,
    approvedBy: nodes(raw.approvedBy).map((user) => user.username),
    canApprove: raw.userPermissions?.canApprove ?? false,
    canMerge: raw.userPermissions?.canMerge ?? false,
    canPush: raw.userPermissions?.canPush ?? false,
    mergeable: raw.mergeable ?? false,
    autoMergeEnabled: raw.autoMergeEnabled ?? false,
    autoMergeStrategies: raw.availableAutoMergeStrategies ?? [],
    shouldBeRebased: raw.shouldBeRebased ?? false,
    rebaseInProgress: raw.rebaseInProgress ?? false,
    reactions: toReactions(raw.awardEmoji),
    kind,
    id: raw.id,
    canEdit: raw.userPermissions?.canEdit ?? false,
    canComment: raw.userPermissions?.canComment ?? false,
    description: raw.description ?? "",
    diffRefs: raw.diffRefs ?? null,
    projectPath: projectPathOf(raw.reference),
    iid: raw.iid,
    reference: raw.reference,
    title: raw.title,
    state: raw.state,
    webUrl: raw.webUrl,
    createdAt: raw.createdAt,
    author: raw.author,
    descriptionHtml: raw.descriptionHtml ?? "",
    labels: nodes(raw.labels).map(({ id, title, color, textColor }) => ({ id, title, color, textColor })),
    assignees: nodes(raw.assignees),
    reviewers: nodes(raw.reviewers),
    milestone: raw.milestone?.title ?? null,
    draft: raw.draft ?? false,
    sourceBranch: raw.sourceBranch ?? null,
    targetBranch: raw.targetBranch ?? null,
    pipelineStatus: raw.headPipeline?.status ?? null,
    pipelineIid: raw.headPipeline?.iid ?? null,
    mergeStatus: raw.detailedMergeStatus ?? null,
    approved: raw.approved ?? null,
    discussions: nodes(raw.discussions).map(toDiscussion),
  };
}

function toJob(job: RawJob, host: string): Job {
  const downstreamPath = job.downstreamPipeline?.project?.fullPath;
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    duration: job.duration,
    startedAt: job.startedAt,
    allowFailure: job.allowFailure,
    manual: job.manualJob ?? false,
    retryable: job.retryable,
    playable: job.playable,
    cancelable: job.cancelable,
    webUrl: job.webPath ? `${host}${job.webPath}` : host,
    downstream:
      job.downstreamPipeline && downstreamPath
        ? { projectPath: downstreamPath, iid: job.downstreamPipeline.iid, status: job.downstreamPipeline.status }
        : null,
  };
}

export function toPipeline(projectPath: string, raw: NonNullable<NonNullable<RawPipeline["project"]>["pipeline"]>, host: string): Pipeline {
  return {
    projectPath,
    iid: raw.iid,
    id: raw.id,
    status: raw.status,
    statusLabel: raw.detailedStatus?.label ?? null,
    ref: raw.ref ?? "",
    sha: raw.sha ?? "",
    duration: raw.duration,
    createdAt: raw.createdAt,
    finishedAt: raw.finishedAt,
    user: raw.user,
    webUrl: raw.path ? `${host}${raw.path}` : host,
    retryable: raw.retryable,
    cancelable: raw.cancelable,
    stages: nodes(raw.stages).map((stage) => ({
      name: stage.name,
      status: stage.status,
      jobs: nodes(stage.jobs).map((job) => toJob(job, host)),
    })),
  };
}

/** `gid://gitlab/Ci::Build/1042565` → `1042565`, for the REST trace endpoint. */
export function numericId(globalId: string): string | null {
  const match = globalId.match(/\/(\d+)$/);
  return match?.[1] ?? null;
}

export const WORKSPACE_QUERY = `
query PaseoGitLabWorkspace($path: ID!, $branch: String!) {
  project(fullPath: $path) {
    repository { rootRef }
    mergeRequests(sourceBranches: [$branch], state: opened, first: 1) {
      nodes { ${MR_ROW} discussions(first: 100) { nodes { resolvable resolved } } }
    }
  }
}`;

export interface RawWorkspace {
  project: {
    repository: { rootRef: string | null } | null;
    mergeRequests: Nodes<RawRow & { discussions: Nodes<{ resolvable: boolean; resolved: boolean }> }>;
  } | null;
}

export function toWorkspaceMergeRequest(raw: RawWorkspace): { mergeRequest: ListItem | null; unresolvedThreads: number } {
  const row = nodes(raw.project?.mergeRequests)[0];
  if (!row) {
    return { mergeRequest: null, unresolvedThreads: 0 };
  }
  const unresolvedThreads = nodes(row.discussions).filter((discussion) => discussion.resolvable && !discussion.resolved).length;
  return { mergeRequest: toListItem("mr", row, []), unresolvedThreads };
}

export const SEARCH_ITEMS_QUERY = `
query PaseoGitLabSearchItems($search: String!, $path: ID!) {
  issues(search: $search, state: opened, first: 5, sort: UPDATED_DESC) { nodes { iid reference(full: true) } }
  project(fullPath: $path) {
    mergeRequests(search: $search, state: opened, first: 5, sort: UPDATED_DESC) { nodes { iid reference(full: true) } }
  }
}`;

export interface RawSearchItems {
  issues: Nodes<{ iid: string; reference: string }>;
  project: { mergeRequests: Nodes<{ iid: string; reference: string }> } | null;
}

export function searchHits(raw: RawSearchItems): ItemRef[] {
  return [
    ...nodes(raw.project?.mergeRequests).map((row) => ({ kind: "mr" as const, projectPath: projectPathOf(row.reference), iid: row.iid })),
    ...nodes(raw.issues).map((row) => ({ kind: "issue" as const, projectPath: projectPathOf(row.reference), iid: row.iid })),
  ];
}

/**
 * What a typed reference points at: `!12`, `#34`, `group/project!12`, or a full
 * issue, MR or job URL on the connected host. Bare numbers resolve against the
 * default project.
 */
export type ParsedReference =
  | { kind: "item"; ref: ItemRef }
  | { kind: "job"; projectPath: string; jobId: string }
  | null;

export function parseReference(query: string, host: string, defaultProject: string | null): ParsedReference {
  const text = query.trim();
  try {
    const url = new URL(text);
    if (url.origin !== host) {
      return null;
    }
    const match = url.pathname.match(/^\/(.+?)\/-\/(issues|merge_requests|jobs)\/(\d+)/);
    if (!match) {
      return null;
    }
    const [, projectPath, type, id] = match as unknown as [string, string, string, string];
    if (type === "jobs") {
      return { kind: "job", projectPath, jobId: `gid://gitlab/Ci::Build/${id}` };
    }
    return { kind: "item", ref: { kind: type === "issues" ? "issue" : "mr", projectPath, iid: id } };
  } catch {
    // Not a URL; try a reference.
  }
  const reference = text.match(/^([\w./-]+)?([#!])(\d+)$/);
  if (!reference) {
    return null;
  }
  const projectPath = reference[1] || defaultProject;
  if (!projectPath) {
    return null;
  }
  return { kind: "item", ref: { kind: reference[2] === "!" ? "mr" : "issue", projectPath, iid: reference[3]! } };
}

export const CREATE_ISSUE_MUTATION = `
mutation PaseoGitLabCreateIssue($projectPath: ID!, $title: String!, $description: String) {
  createIssue(input: { projectPath: $projectPath, title: $title, description: $description }) {
    issue { iid }
    errors
  }
}`;

export const CREATE_MERGE_REQUEST_MUTATION = `
mutation PaseoGitLabCreateMergeRequest(
  $projectPath: ID!, $title: String!, $description: String, $sourceBranch: String!, $targetBranch: String!
) {
  mergeRequestCreate(input: {
    projectPath: $projectPath, title: $title, description: $description, sourceBranch: $sourceBranch, targetBranch: $targetBranch
  }) {
    mergeRequest { iid }
    errors
  }
}`;

export const MERGE_MUTATION = `
mutation PaseoGitLabMerge($projectPath: ID!, $iid: String!, $sha: String!, $strategy: MergeStrategyEnum) {
  mergeRequestAccept(input: { projectPath: $projectPath, iid: $iid, sha: $sha, strategy: $strategy }) { ${MUTATION_RESULT} }
}`;

export const TOGGLE_REACTION_MUTATION = `
mutation PaseoGitLabToggleReaction($awardableId: AwardableID!, $name: String!) {
  awardEmojiToggle(input: { awardableId: $awardableId, name: $name }) { ${MUTATION_RESULT} }
}`;
