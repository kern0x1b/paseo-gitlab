import type { PluginServerContext } from "@getpaseo/plugin/server";
import { connect, defaultAuthDeps, disconnect } from "./server/auth";
import { createHandlers } from "./server/handlers";
import {
  addCodeCommentRpc,
  addDiffNoteRpc,
  agentPromptRpc,
  attachmentSearchRpc,
  addDraftRpc,
  addNoteRpc,
  applySuggestionRpc,
  deleteDraftRpc,
  draftsRpc,
  mergeRequestActionRpc,
  submitReviewRpc,
  toggleReactionRpc,
  deleteNoteRpc,
  diffsRpc,
  searchLabelsRpc,
  searchUsersRpc,
  setLabelsRpc,
  setPeopleRpc,
  updateItemRpc,
  updateNoteRpc,
  workspaceRpc,
  authConnectRpc,
  authDisconnectRpc,
  authStatusRpc,
  clientLogRpc,
  aheadBehindRpc,
  branchesRpc,
  commitsRpc,
  createBranchRpc,
  deleteBranchRpc,
  refCommitsRpc,
  repoTreeRpc,
  fileLinesRpc,
  scopedDiffsRpc,
  versionsRpc,
  deleteQueryRpc,
  markdownPreviewRpc,
  referenceSearchRpc,
  runPipelineRpc,
  savedQueriesRpc,
  saveQueryRpc,
  searchRpc,
  uploadRpc,
  createIssueRpc,
  createMergeRequestRpc,
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
  server.handle(workspaceRpc, (input) => handlers.workspace(input));
  server.handle(versionsRpc, (input) => handlers.versions(input));
  server.handle(commitsRpc, (input) => handlers.commits(input));
  server.handle(scopedDiffsRpc, (input) => handlers.scopedDiffs(input));
  server.handle(fileLinesRpc, (input) => handlers.fileLines(input));
  server.handle(repoTreeRpc, (input) => handlers.repoTree(input));
  server.handle(refCommitsRpc, (input) => handlers.refCommits(input));
  server.handle(branchesRpc, (input) => handlers.branches(input));
  server.handle(aheadBehindRpc, (input) => handlers.aheadBehind(input));
  server.handle(createBranchRpc, (input) => handlers.createBranch(input));
  server.handle(deleteBranchRpc, (input) => handlers.deleteBranch(input));
  server.handle(addCodeCommentRpc, (input) => handlers.addCodeComment(input));
  server.handle(referenceSearchRpc, (input) => handlers.referenceSearch(input));
  server.handle(markdownPreviewRpc, (input) => handlers.markdownPreview(input));
  server.handle(uploadRpc, (input) => handlers.upload(input));
  server.handle(searchRpc, (input) => handlers.search(input));
  server.handle(savedQueriesRpc, () => handlers.savedQueries());
  server.handle(saveQueryRpc, (input) => handlers.saveQuery(input));
  server.handle(deleteQueryRpc, (input) => handlers.deleteQuery(input));
  server.handle(runPipelineRpc, (input) => handlers.runPipeline(input));
  server.handle(mergeRequestActionRpc, (input) => handlers.mergeRequestAction(input));
  server.handle(applySuggestionRpc, (input) => handlers.applySuggestion(input));
  server.handle(toggleReactionRpc, (input) => handlers.toggleReaction(input));
  server.handle(draftsRpc, (input) => handlers.drafts(input));
  server.handle(addDraftRpc, (input) => handlers.addDraft(input));
  server.handle(deleteDraftRpc, (input) => handlers.deleteDraft(input));
  server.handle(submitReviewRpc, (input) => handlers.submitReview(input));
  server.handle(createIssueRpc, (input) => handlers.createIssue(input));
  server.handle(createMergeRequestRpc, (input) => handlers.createMergeRequest(input));
  server.handle(agentPromptRpc, (input) => handlers.agentPrompt(input));
  server.handle(attachmentSearchRpc, (input) => handlers.attachmentSearch(input));
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
