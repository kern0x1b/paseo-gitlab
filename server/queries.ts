import type { Detail, Discussion, ItemKind, Label, ListItem, Lists, Person } from "../shared/contract";

/**
 * GraphQL rather than REST: it returns GitLab's own rendered HTML for descriptions
 * and notes (`descriptionHtml`, `bodyHtml`), so references, task lists, tables and
 * code blocks look the way they do on the site without a markdown renderer here.
 */

const PERSON = "username name";
const LABELS = "labels { nodes { title color textColor } }";

const MR_ROW = `
  iid title webUrl reference(full: true) updatedAt userNotesCount draft detailedMergeStatus
  headPipeline { status }
  ${LABELS}`;

export const LISTS_QUERY = `
query PaseoGitLabLists($me: String!) {
  currentUser {
    authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ${MR_ROW} } }
    reviewRequestedMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ${MR_ROW} } }
  }
  issues(assigneeUsernames: [$me], state: opened, first: 50, sort: UPDATED_DESC) {
    nodes { iid title webUrl reference(full: true) updatedAt userNotesCount confidential ${LABELS} }
  }
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
      headPipeline { status }
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
  headPipeline?: { status: string } | null;
  labels?: Nodes<RawLabel>;
}

export interface RawLists {
  currentUser: {
    authoredMergeRequests: Nodes<RawRow>;
    reviewRequestedMergeRequests: Nodes<RawRow>;
  } | null;
  issues: Nodes<RawRow>;
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
  headPipeline?: { status: string } | null;
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

function toListItem(kind: ItemKind, row: RawRow): ListItem {
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
  };
}

export function toLists(raw: RawLists): Lists {
  return {
    issues: nodes(raw.issues).map((row) => toListItem("issue", row)),
    authoredMergeRequests: nodes(raw.currentUser?.authoredMergeRequests).map((row) => toListItem("mr", row)),
    reviewMergeRequests: nodes(raw.currentUser?.reviewRequestedMergeRequests).map((row) =>
      toListItem("mr", row),
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
    mergeStatus: raw.detailedMergeStatus ?? null,
    approved: raw.approved ?? null,
    discussions: nodes(raw.discussions).map(toDiscussion),
  };
}
