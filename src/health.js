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

  resetStreakIfPending() {
    if (this.alertDelivered) return false;
    this.failingSince = null;
    return true;
  }
}
