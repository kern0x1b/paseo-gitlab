import { test } from "node:test";
import assert from "node:assert/strict";
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

test("does not alert before the threshold elapses", () => {
  const clock = fakeClock();
  const health = new HealthMonitor({ thresholdMs: 120_000, now: clock.now });

  let result = health.recordFailure();
  assert.equal(result.shouldAlert, false);

  clock.advance(60_000);
  result = health.recordFailure();
  assert.equal(result.shouldAlert, false);
});

test("alerts exactly once after failing past the threshold and delivery is confirmed", () => {
  const clock = fakeClock();
  const health = new HealthMonitor({ thresholdMs: 120_000, now: clock.now });

  health.recordFailure();
  clock.advance(119_000);
  assert.equal(health.recordFailure().shouldAlert, false);

  clock.advance(2_000);
  const alert = health.recordFailure();
  assert.equal(alert.shouldAlert, true);
  assert.equal(alert.since, 0);
  health.markAlertDelivered();

  clock.advance(60_000);
  assert.equal(health.recordFailure().shouldAlert, false);
  clock.advance(600_000);
  assert.equal(health.recordFailure().shouldAlert, false);
});

test("an undelivered alert stays due on every subsequent failing tick", () => {
  const clock = fakeClock();
  const health = new HealthMonitor({ thresholdMs: 120_000, now: clock.now });

  health.recordFailure();
  clock.advance(121_000);
  assert.equal(health.recordFailure().shouldAlert, true);

  clock.advance(60_000);
  assert.equal(health.recordFailure().shouldAlert, true);
  clock.advance(60_000);
  assert.equal(health.recordFailure().shouldAlert, true);
});

test("recovers once after an alert was delivered, then can alert again on a new streak", () => {
  const clock = fakeClock();
  const health = new HealthMonitor({ thresholdMs: 120_000, now: clock.now });

  health.recordFailure();
  clock.advance(121_000);
  assert.equal(health.recordFailure().shouldAlert, true);
  health.markAlertDelivered();

  const recovered = health.recordSuccess();
  assert.equal(recovered.shouldRecover, true);
  health.markRecoveredDelivered();

  assert.equal(health.recordSuccess().shouldRecover, false);

  health.recordFailure();
  clock.advance(121_000);
  assert.equal(health.recordFailure().shouldAlert, true);
});

test("a recovered message stays due until delivery is confirmed", () => {
  const clock = fakeClock();
  const health = new HealthMonitor({ thresholdMs: 120_000, now: clock.now });

  health.recordFailure();
  clock.advance(121_000);
  assert.equal(health.recordFailure().shouldAlert, true);
  health.markAlertDelivered();

  assert.equal(health.recordSuccess().shouldRecover, true);
  assert.equal(health.recordSuccess().shouldRecover, true);

  health.markRecoveredDelivered();
  assert.equal(health.recordSuccess().shouldRecover, false);
});

test("a success before the threshold clears the streak without a recovered message", () => {
  const clock = fakeClock();
  const health = new HealthMonitor({ thresholdMs: 120_000, now: clock.now });

  health.recordFailure();
  clock.advance(30_000);
  const result = health.recordSuccess();
  assert.equal(result.shouldRecover, false);

  clock.advance(500_000);
  assert.equal(health.recordFailure().shouldAlert, false);
});

test("resetStreakIfPending clears an undelivered streak but leaves a delivered one alone", () => {
  const clock = fakeClock();
  const health = new HealthMonitor({ thresholdMs: 120_000, now: clock.now });

  health.recordFailure();
  clock.advance(10_000);
  assert.equal(health.resetStreakIfPending(), true);
  assert.equal(health.failingSince, null);

  health.recordFailure();
  clock.advance(121_000);
  assert.equal(health.recordFailure().shouldAlert, true);
  health.markAlertDelivered();

  assert.equal(health.resetStreakIfPending(), false);
  assert.notEqual(health.failingSince, null);
});
