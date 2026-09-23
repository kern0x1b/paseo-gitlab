import type { Detail, Discussion, ItemKind, ItemRef, Job, Label, ListItem, Lists, Person, Pipeline, Todo } from "../shared/contract";

/**
 * GraphQL rather than REST: it returns GitLab's own rendered HTML for descriptions
 * and notes (`descriptionHtml`, `bodyHtml`), so references, task lists, tables and
 * code blocks look the way they do on the site without a markdown renderer here.
 */

const PERSON = "username name";
const LABELS = "labels { nodes { title color textColor } }";

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
      notes { nodes { id bodyHtml system createdAt author { ${PERSON} } } }
    }
  }`;

export const ISSUE_QUERY = `
query PaseoGitLabIssue($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    issue(iid: $iid) {
      id iid title state webUrl reference(full: true) createdAt descriptionHtml confidential
      author { ${PERSON} }
      assignees { nodes { ${PERSON} } }
      milestone { title }
      ${LABELS}
      ${DISCUSSIONS}
    }
  }
}`;

export const MERGE_REQUEST_QUERY = `
query PaseoGitLabMergeRequest($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      id iid title state webUrl reference(full: true) createdAt descriptionHtml draft
      sourceBranch targetBranch detailedMergeStatus approved
      headPipeline { iid status }
      author { ${PERSON} }
      assignees { nodes { ${PERSON} } }
      reviewers { nodes { ${PERSON} } }
      milestone { title }
      ${LABELS}
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

interface RawNote {
  id: string;
  bodyHtml: string | null;
  system: boolean;
  createdAt: string;
  author: Person | null;
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
  descriptionHtml: string | null;
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
  labels?: Nodes<RawLabel>;
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
      bodyHtml: note.bodyHtml ?? "",
      system: note.system,
    })),
  };
}

export function toDetail(kind: ItemKind, raw: RawDetail): Detail {
  return {
    kind,
    id: raw.id,
    projectPath: projectPathOf(raw.reference),
    iid: raw.iid,
    reference: raw.reference,
    title: raw.title,
    state: raw.state,
    webUrl: raw.webUrl,
    createdAt: raw.createdAt,
    author: raw.author,
    descriptionHtml: raw.descriptionHtml ?? "",
    labels: labels(raw.labels),
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
