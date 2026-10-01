import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitLabDaemon } from "../src/daemon.js";
import { GitLabEventDispatcher } from "../src/dispatcher.js";
import { SubscriptionRegistry } from "../src/subscriptions.js";
import { HealthMonitor } from "../src/health.js";

function fakeClock(startMs = 0) {
  let ms = startMs;
  return {
    now: () => ms,
    advance: (deltaMs) => {
      ms += deltaMs;
    },
  };
}

function tempRegistry() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gitlab-router-test-")), "subscriptions.json");
  return new SubscriptionRegistry(file);
}

function makeDaemon({ registry, thresholdMs = 120_000, clock = fakeClock(), sendToPaseo }) {
  const health = new HealthMonitor({ thresholdMs, now: clock.now });
  const dispatcher = new GitLabEventDispatcher({ registry, config: {} });
  dispatcher.sendToPaseo = sendToPaseo;
  const daemon = new GitLabDaemon({
    client: {},
    dispatcher,
    registry,
    config: {},
    health,
  });
  return { daemon, clock };
}

test("a delivery failure keeps the alert pending and retries on the next failing tick", async () => {
  const registry = tempRegistry();
  registry.setCoordinator("COORD");

  const calls = [];
  let failNextSend = true;
  const { daemon, clock } = makeDaemon({
    registry,
    thresholdMs: 100,
    sendToPaseo: async (agentId) => {
      calls.push(agentId);
      if (failNextSend) {
        return { success: false, error: "paseo send: connection refused" };
      }
      return { success: true, stdout: "", stderr: "" };
    },
  });

  const failure = [{ source: "todos", error: new Error("boom") }];

  // First failing tick starts the streak; below threshold, no dispatch yet.
  await daemon.handlePollFailure(failure);
  assert.equal(calls.length, 0);

  // Past threshold, but sendToPaseo fails: dispatch is attempted, alert stays undelivered.
  clock.advance(150);
  await daemon.handlePollFailure(failure);
  assert.equal(calls.length, 1);
  assert.equal(daemon.health.alertDelivered, false);

  // Still failing: must retry, not skip, because the previous attempt never delivered.
  clock.advance(10);
  await daemon.handlePollFailure(failure);
  assert.equal(calls.length, 2);
  assert.equal(daemon.health.alertDelivered, false);

  // Now delivery succeeds: alert is finally marked delivered.
  failNextSend = false;
  clock.advance(10);
  await daemon.handlePollFailure(failure);
  assert.equal(calls.length, 3);
  assert.equal(daemon.health.alertDelivered, true);

  // Further failures must not re-dispatch until a recovery.
  clock.advance(10);
  await daemon.handlePollFailure(failure);
  assert.equal(calls.length, 3);
});

test("a catch-all subscription does not receive health events, only the coordinator does", async () => {
  const registry = tempRegistry();
  registry.setCoordinator("COORD");
  registry.add({ agentId: "WORKER", eventType: "all" });

  const calls = [];
  const { daemon, clock } = makeDaemon({
    registry,
    thresholdMs: 100,
    sendToPaseo: async (agentId) => {
      calls.push(agentId);
      return { success: true, stdout: "", stderr: "" };
    },
  });

  const failure = [{ source: "events", error: new Error("502") }];
  await daemon.handlePollFailure(failure); // starts the streak
  clock.advance(200);
  await daemon.handlePollFailure(failure); // past threshold

  assert.deepEqual(calls, ["COORD"]);
});

test("the alert names the failing check and its error", async () => {
  const registry = tempRegistry();
  registry.setCoordinator("COORD");

  let prompt = null;
  const { daemon, clock } = makeDaemon({
    registry,
    thresholdMs: 100,
    sendToPaseo: async (agentId, p) => {
      prompt = p;
      return { success: true, stdout: "", stderr: "" };
    },
  });

  const failure = [{ source: "pipelines", error: new Error("GitLab API error 403 (Forbidden)") }];
  await daemon.handlePollFailure(failure); // starts the streak
  clock.advance(200);
  await daemon.handlePollFailure(failure); // past threshold, dispatches

  assert.ok(prompt, "expected a prompt to be dispatched");
  assert.match(prompt, /pipelines/);
  assert.match(prompt, /403/);
  assert.doesNotMatch(prompt, /polling has been failing/);
});

test("recovered message names what recovered and retries if delivery fails first", async () => {
  const registry = tempRegistry();
  registry.setCoordinator("COORD");

  const calls = [];
  let failRecovered = true;
  const { daemon, clock } = makeDaemon({
    registry,
    thresholdMs: 100,
    sendToPaseo: async (agentId, prompt) => {
      calls.push(prompt);
      if (prompt.includes("RECOVERED") && failRecovered) {
        return { success: false, error: "timeout" };
      }
      return { success: true, stdout: "", stderr: "" };
    },
  });

  const failure = [{ source: "pipelines", error: new Error("403") }];
  await daemon.handlePollFailure(failure); // starts the streak
  clock.advance(200);
  await daemon.handlePollFailure(failure); // alert delivered
  assert.equal(daemon.health.alertDelivered, true);

  await daemon.handlePollSuccess();
  assert.equal(
    daemon.health.alertDelivered,
    true,
    "recovery not yet delivered, must not clear alertDelivered",
  );

  failRecovered = false;
  await daemon.handlePollSuccess();
  assert.equal(daemon.health.alertDelivered, false);

  const recoveredPrompt = calls.find((p) => p.includes("RECOVERED"));
  assert.match(recoveredPrompt, /pipelines/);
});
