/**
 * Tracks consecutive poll failures and decides when the daemon should alert
 * the coordinator, and when it should announce recovery.
 *
 * An alert stays "due" every tick until markAlertDelivered() confirms it was
 * actually sent — a dropped or failed dispatch retries on the next failing
 * tick instead of being silently consumed. The same rule applies to the
 * recovered message via markRecoveredDelivered().
 */
export class HealthMonitor {
  constructor({ thresholdMs = 2 * 60 * 1000, now = () => Date.now() } = {}) {
    this.thresholdMs = thresholdMs;
    this.now = now;
    this.failingSince = null;
    this.alertDelivered = false;
  }

  recordFailure() {
    const ts = this.now();
    if (this.failingSince === null) {
      this.failingSince = ts;
    }

    const shouldAlert = !this.alertDelivered && ts - this.failingSince >= this.thresholdMs;
    return { shouldAlert, since: this.failingSince };
  }

  markAlertDelivered() {
    this.alertDelivered = true;
  }

  recordSuccess() {
    this.failingSince = null;
    return { shouldRecover: this.alertDelivered };
  }

  markRecoveredDelivered() {
    this.alertDelivered = false;
  }

  // Called when entering an off-hours pause: a pending (not yet alerted)
  // streak should not carry wall-clock time across the pause. A streak that
  // already alerted is left alone so the outage isn't re-announced.
  resetStreakIfPending() {
    if (this.alertDelivered) return false;
    this.failingSince = null;
    return true;
  }
}
