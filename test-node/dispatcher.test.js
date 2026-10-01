import { test } from "node:test";
import assert from "node:assert/strict";
import { GitLabEventDispatcher } from "../src/dispatcher.js";

test("GitLabEventDispatcher buildFleetEnvelope generates valid paseo-fleet/v1 schema", () => {
  const dispatcher = new GitLabEventDispatcher({
    config: { host: "https://gitlab.corp.net", defaultProjectId: "core/backend" },
    myUsername: "bot.user",
  });

  const event = {
    category: "MergeRequest",
    actionName: "merge_request_opened",
    author: "dev.user",
    mrIid: 42,
    projectPath: "core/backend",
    title: "Add payment gateway",
    body: "Implements Stripe v3 integration",
    url: "https://gitlab.corp.net/core/backend/-/merge_requests/42",
  };

  const envelope = dispatcher.buildFleetEnvelope(event);

  assert.equal(envelope.protocol, "paseo-fleet/v1");
  assert.equal(envelope.source, "gitlab");
  assert.equal(envelope.instance, "https://gitlab.corp.net");
  assert.equal(envelope.scope, "core/backend");
  assert.equal(envelope.urn, "urn:gitlab:gitlab.corp.net:core/backend:mr:42");
  assert.equal(envelope.actor.id, "dev.user");
  assert.equal(envelope.actor.is_bot, false);
  assert.equal(envelope.content, "Implements Stripe v3 integration");
  assert.equal(envelope.reply_action.type, "mcp");
  assert.equal(envelope.reply_action.tool, "gitlab_create_mr_note");
  assert.equal(envelope.reply_action.params.project_id, "core/backend");
  assert.equal(envelope.reply_action.params.mr_iid, 42);
});

test("GitLabEventDispatcher dispatches fleet envelope to coordinator", async () => {
  const calls = [];
  const fakeRegistry = {
    findMatchingAgent: () => null,
    getCoordinator: () => "coordinator-999",
  };

  const dispatcher = new GitLabEventDispatcher({
    registry: fakeRegistry,
    config: { host: "https://gitlab.com", defaultProjectId: "my-org/web" },
    myUsername: "bot.user",
  });

  dispatcher.sendToPaseo = async (agentId, prompt) => {
    calls.push({ agentId, prompt });
    return { success: true, stdout: "ok", stderr: "" };
  };

  const event = {
    category: "Issue",
    actionName: "issue_created",
    author: "qa.lead",
    issueIid: 15,
    title: "Bug in auth",
    body: "Token expired too early",
  };

  const result = await dispatcher.dispatch(event);

  assert.equal(result.routed, true);
  assert.equal(result.type, "coordinator");
  assert.equal(result.targetAgent, "coordinator-999");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentId, "coordinator-999");

  const parsed = JSON.parse(calls[0].prompt);
  assert.equal(parsed.protocol, "paseo-fleet/v1");
  assert.equal(parsed.instance, "https://gitlab.com");
  assert.equal(parsed.scope, "my-org/web");
  assert.equal(parsed.urn, "urn:gitlab:gitlab.com:my-org/web:issue:15");
  assert.equal(parsed.reply_action.tool, "gitlab_create_issue_note");
  assert.equal(parsed.reply_action.params.issue_iid, 15);
});
