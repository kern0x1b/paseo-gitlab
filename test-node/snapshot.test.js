import { test } from "node:test";
import assert from "node:assert/strict";
import { GitLabSnapshot } from "../src/snapshot.js";

function createFakeClient({ failing = [] } = {}) {
  const mergeRequest = {
    id: 1,
    iid: 42,
    project_id: 7,
    title: "Add payment gateway",
    web_url: "https://gitlab.example.com/core/backend/-/merge_requests/42",
    updated_at: "2026-10-01T10:00:00Z",
    references: { full: "core/backend!42" },
    author: { username: "dev.user", name: "Dev User" },
    reviewers: [{ username: "me.user" }],
    source_branch: "feature/payments",
    target_branch: "main",
  };
  return {
    host: "https://gitlab.example.com",
    async getCurrentUser() {
      return { username: "me.user" };
    },
    async getTodos() {
      if (failing.includes("todos")) throw new Error("todos unavailable");
      return [
        {
          id: 900,
          action_name: "review_requested",
          target_type: "MergeRequest",
          target: { iid: 42, title: "Add payment gateway" },
          target_url: mergeRequest.web_url,
          project: { id: 7, path_with_namespace: "core/backend" },
          author: { username: "dev.user", name: "Dev User" },
          body: "Add payment gateway",
          updated_at: "2026-10-01T09:00:00Z",
        },
      ];
    },
    async getOpenedMergeRequests({ reviewerUsername }) {
      return reviewerUsername ? [mergeRequest] : [];
    },
    async getOpenedIssues() {
      return [
        {
          iid: 5,
          project_id: 7,
          title: "Broken login",
          web_url: "https://gitlab.example.com/core/backend/-/issues/5",
          updated_at: "2026-10-01T11:00:00Z",
          references: { full: "core/backend#5" },
          labels: ["bug"],
          author: { username: "qa.user" },
        },
      ];
    },
    async getMergeRequest() {
      return { ...mergeRequest, head_pipeline: { id: 77, status: "failed", web_url: "https://ci/77" } };
    },
    async call() {
      return { approved_by: [], approvals_left: 1 };
    },
  };
}

test("GitLabSnapshot merges a review to-do into the merge request it points at", async () => {
  const snapshot = await new GitLabSnapshot({ client: createFakeClient() }).collect();

  assert.equal(snapshot.protocol, "paseo-fleet/v1");
  assert.equal(snapshot.source, "gitlab");
  assert.equal(snapshot.actor, "me.user");
  assert.equal(snapshot.items.length, 2);

  const mergeRequestItem = snapshot.items.find((item) => item.target.type === "mr");
  assert.equal(mergeRequestItem.urn, "urn:gitlab:gitlab.example.com:core/backend:mr:42");
  assert.equal(mergeRequestItem.event_type, "mr_review_requested");
  assert.deepEqual(mergeRequestItem.snapshot.reasons, ["mr_reviewer", "todo_review_requested"]);
  assert.equal(mergeRequestItem.snapshot.state.pipeline.status, "failed");
  assert.deepEqual(mergeRequestItem.snapshot.state.todo_ids, [900]);
  assert.equal(mergeRequestItem.reply_action.tool, "gitlab_create_mr_note");
  assert.equal(mergeRequestItem.reply_action.params.mr_iid, 42);
});

test("GitLabSnapshot keeps the other sources when one of them fails", async () => {
  const snapshot = await new GitLabSnapshot({ client: createFakeClient({ failing: ["todos"] }) }).collect();

  assert.deepEqual(snapshot.errors, [{ source: "todos", error: "todos unavailable" }]);
  assert.equal(snapshot.items.length, 2);
  const issueItem = snapshot.items.find((item) => item.target.type === "issue");
  assert.equal(issueItem.event_type, "issue_assigned");
  assert.deepEqual(issueItem.snapshot.state.labels, ["bug"]);
});
