import type { PluginServerContext } from "@getpaseo/plugin/server";
import { connect, defaultAuthDeps, disconnect } from "./server/auth";
import { createHandlers } from "./server/handlers";
import { withDemo } from "./server/demo";
import { readAccounts, withAccount } from "./server/state";
import { hostForDirectory } from "./server/workspace";
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
  accountsRpc,
  aheadBehindRpc,
  boardCardsRpc,
  boardColumnsRpc,
  boardsRpc,
  moveBoardCardRpc,
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
  const deps = withDemo(defaultAuthDeps());
  const handlers = createHandlers(deps);
  // Runs each request as the account it names, and hands the handler its input without that field.
  const handle: PluginServerContext["handle"] = (contract, handler) =>
    server.handle(contract, (input, context) => {
      const { account, ...rest } = input as { account?: string };
      return withAccount(account, () => handler(rest as typeof input, context));
    });
  handle(accountsRpc, async (input) => {
    const { hosts, active } = readAccounts();
    return {
      hosts,
      active,
      forDirectory: input.directory ? await hostForDirectory(input.directory, hosts) : null,
    };
  });
  handle(authStatusRpc, handlers.status);
  handle(authConnectRpc, (input) => connect(deps, input));
  handle(authDisconnectRpc, () => disconnect(deps));
  handle(listsRpc, handlers.lists);
  handle(detailRpc, (input) => handlers.detail(input));
  handle(addNoteRpc, (input) => handlers.addNote(input));
  handle(updateNoteRpc, (input) => handlers.updateNote(input));
  handle(deleteNoteRpc, (input) => handlers.deleteNote(input));
  handle(updateItemRpc, (input) => handlers.updateItem(input));
  handle(setPeopleRpc, (input) => handlers.setPeople(input));
  handle(setLabelsRpc, (input) => handlers.setLabels(input));
  handle(searchUsersRpc, (input) => handlers.searchUsers(input));
  handle(searchLabelsRpc, (input) => handlers.searchLabels(input));
  handle(diffsRpc, (input) => handlers.diffs(input));
  handle(addDiffNoteRpc, (input) => handlers.addDiffNote(input));
  handle(workspaceRpc, (input) => handlers.workspace(input));
  handle(versionsRpc, (input) => handlers.versions(input));
  handle(commitsRpc, (input) => handlers.commits(input));
  handle(scopedDiffsRpc, (input) => handlers.scopedDiffs(input));
  handle(fileLinesRpc, (input) => handlers.fileLines(input));
  handle(repoTreeRpc, (input) => handlers.repoTree(input));
  handle(boardsRpc, (input) => handlers.boards(input));
  handle(boardColumnsRpc, (input) => handlers.boardColumns(input));
  handle(boardCardsRpc, (input) => handlers.boardCards(input));
  handle(moveBoardCardRpc, (input) => handlers.moveBoardCard(input));
  handle(refCommitsRpc, (input) => handlers.refCommits(input));
  handle(branchesRpc, (input) => handlers.branches(input));
  handle(aheadBehindRpc, (input) => handlers.aheadBehind(input));
  handle(createBranchRpc, (input) => handlers.createBranch(input));
  handle(deleteBranchRpc, (input) => handlers.deleteBranch(input));
  handle(addCodeCommentRpc, (input) => handlers.addCodeComment(input));
  handle(referenceSearchRpc, (input) => handlers.referenceSearch(input));
  handle(markdownPreviewRpc, (input) => handlers.markdownPreview(input));
  handle(uploadRpc, (input) => handlers.upload(input));
  handle(searchRpc, (input) => handlers.search(input));
  handle(savedQueriesRpc, () => handlers.savedQueries());
  handle(saveQueryRpc, (input) => handlers.saveQuery(input));
  handle(deleteQueryRpc, (input) => handlers.deleteQuery(input));
  handle(runPipelineRpc, (input) => handlers.runPipeline(input));
  handle(mergeRequestActionRpc, (input) => handlers.mergeRequestAction(input));
  handle(applySuggestionRpc, (input) => handlers.applySuggestion(input));
  handle(toggleReactionRpc, (input) => handlers.toggleReaction(input));
  handle(draftsRpc, (input) => handlers.drafts(input));
  handle(addDraftRpc, (input) => handlers.addDraft(input));
  handle(deleteDraftRpc, (input) => handlers.deleteDraft(input));
  handle(submitReviewRpc, (input) => handlers.submitReview(input));
  handle(createIssueRpc, (input) => handlers.createIssue(input));
  handle(createMergeRequestRpc, (input) => handlers.createMergeRequest(input));
  handle(agentPromptRpc, (input) => handlers.agentPrompt(input));
  handle(attachmentSearchRpc, (input) => handlers.attachmentSearch(input));
  handle(resolveRpc, (input) => handlers.resolve(input));
  handle(imageRpc, (input) => handlers.image(input));
  handle(pipelineRpc, (input) => handlers.pipeline(input));
  handle(jobLogRpc, (input) => handlers.jobLog(input));
  handle(jobActionRpc, (input) => handlers.jobAction(input));
  handle(pipelineActionRpc, (input) => handlers.pipelineAction(input));
  handle(todoDoneRpc, (input) => handlers.todoDone(input));
  handle(clientLogRpc, ({ message }) => {
    console.error(`[gitlab client] ${message}`);
    return { ok: true as const };
  });
  return () => {};
}
