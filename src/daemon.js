import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GitLabClient } from "./gitlab-client.js";
import { GitLabEventDispatcher } from "./dispatcher.js";
import { SubscriptionRegistry } from "./subscriptions.js";
import { loadConfig } from "./config.js";
import { HealthMonitor } from "./health.js";

const STATE_FILE = path.join(os.homedir(), ".config", "gitlab-router", "daemon-state.json");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function logWarn(...args) {
  console.warn(new Date().toISOString(), ...args);
}

function logError(...args) {
  console.error(new Date().toISOString(), ...args);
}

function isWorkingHours() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const isWeekday = day >= 1 && day <= 5;
  const isWorkTime = hour >= 8 && hour < 21;
  return isWeekday && isWorkTime;
}

export class GitLabDaemon {
  constructor({
    client = new GitLabClient(),
    dispatcher = null,
    registry = new SubscriptionRegistry(),
    config = loadConfig(),
    pollIntervalMs = null,
    workHoursOnly = true,
    dryRun = false,
    health = new HealthMonitor(),
  } = {}) {
    this.client = client;
    this.config = config;
    this.registry = registry;
    this.explicitIntervalMs = pollIntervalMs;
    this.baseIntervalMs = (config.pollIntervalSeconds || 60) * 1000;
    this.workHoursOnly = workHoursOnly;
    this.dryRun = dryRun;
    this.dispatcher =
      dispatcher ||
      new GitLabEventDispatcher({
        registry: this.registry,
        config: this.config,
      });

    if (this.dryRun) {
      this.dispatcher.sendToPaseo = async (agentId, prompt) => {
        log(`[GitLab Daemon] [dry-run] Would dispatch to ${agentId}:\n${prompt}`);
        return { success: true, stdout: "", stderr: "" };
      };
    }

    this.running = false;
    this.startedAt = null;
    this.lastPollAt = null;
    this.eventsProcessed = 0;
    this.timer = null;

    this.seenTodoIds = new Set();
    this.seenEventIds = new Set();
    this.pipelineStatuses = new Map();
    this.currentUser = null;
    this.relevantMrIids = new Set();
    this.relevantIssueIids = new Set();
    this.lastRelevantRefreshAt = 0;
    this.health = health;
    this.failingSourcesThisStreak = new Set();
  }

  saveState() {
    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify(
          {
            pid: process.pid,
            running: this.running,
            startedAt: this.startedAt,
            lastPollAt: this.lastPollAt,
            eventsProcessed: this.eventsProcessed,
            baseIntervalMs: this.baseIntervalMs,
            workHoursOnly: this.workHoursOnly,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch {}
  }

  clearState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
      }
    } catch {}
  }

  getStatus() {
    return {
      running: this.running,
      pid: this.running ? process.pid : null,
      startedAt: this.startedAt,
      lastPollAt: this.lastPollAt,
      uptimeSeconds: this.startedAt
        ? Math.round((Date.now() - new Date(this.startedAt).getTime()) / 1000)
        : 0,
      eventsProcessed: this.eventsProcessed,
      pollIntervalSeconds: Math.round(this.getEffectiveIntervalMs() / 1000),
      isWorkingHours: isWorkingHours(),
      workHoursOnly: this.workHoursOnly,
      activeSubscriptions: this.registry.list().length,
      coordinatorAgentId: this.registry.getCoordinator(),
    };
  }

  getEffectiveIntervalMs() {
    if (this.explicitIntervalMs) {
      return this.explicitIntervalMs;
    }

    const hasActivePipeline = Array.from(this.pipelineStatuses.values()).some(
      (s) => s === "running" || s === "pending",
    );
    if (hasActivePipeline) {
      return 30 * 1000;
    }

    if (isWorkingHours()) {
      return this.baseIntervalMs;
    }

    return 300 * 1000;
  }

  async refreshRelevantItems() {
    if (!this.currentUser?.username) return { success: true, source: "relevantTargets" };
    const username = this.currentUser.username;

    try {
      const [authoredMrs, assignedMrs, reviewerMrs, authoredIssues, assignedIssues] = await Promise.all([
        this.client.getOpenedMergeRequests({ authorUsername: username }),
        this.client.getOpenedMergeRequests({ assigneeUsername: username }),
        this.client.getOpenedMergeRequests({ reviewerUsername: username }),
        this.client.getOpenedIssues({ authorUsername: username }),
        this.client.getOpenedIssues({ assigneeUsername: username }),
      ]);

      const newMrIids = new Set();
      for (const list of [authoredMrs, assignedMrs, reviewerMrs]) {
        if (Array.isArray(list)) {
          for (const mr of list) newMrIids.add(Number(mr.iid));
        }
      }

      const newIssueIids = new Set();
      for (const list of [authoredIssues, assignedIssues]) {
        if (Array.isArray(list)) {
          for (const issue of list) newIssueIids.add(Number(issue.iid));
        }
      }

      this.relevantMrIids = newMrIids;
      this.relevantIssueIids = newIssueIids;
      this.lastRelevantRefreshAt = Date.now();

      const mrList =
        Array.from(this.relevantMrIids)
          .map((id) => `!${id}`)
          .join(", ") || "none";
      const issueList =
        Array.from(this.relevantIssueIids)
          .map((id) => `#${id}`)
          .join(", ") || "none";
      log(
        `[GitLab Daemon] Cached relevant targets: ${this.relevantMrIids.size} MRs (${mrList}), ${this.relevantIssueIids.size} Issues (${issueList})`,
      );
      return { success: true, source: "relevantTargets" };
    } catch (err) {
      logWarn(`[GitLab Daemon] Failed to refresh relevant items: ${err.message}`);
      return { success: false, source: "relevantTargets", error: err };
    }
  }

  async init() {
    this.currentUser = await this.client.getCurrentUser();
    this.dispatcher.setMyUsername(this.currentUser.username);
    log(`[GitLab Daemon] Authenticated as @${this.currentUser.username} (${this.currentUser.name})`);
    log(`[GitLab Daemon] Host: ${this.client.host}, Default Project ID: ${this.client.defaultProjectId}`);

    await this.refreshRelevantItems();

    try {
      const initialTodos = await this.client.getTodos({ perPage: 30 });
      for (const t of initialTodos) {
        this.seenTodoIds.add(t.id);
      }

      const initialEvents = await this.client.getProjectEvents({ perPage: 30 });
      for (const e of initialEvents) {
        this.seenEventIds.add(e.id);
      }

      const initialPipelines = await this.client.getPipelines({
        username: this.currentUser?.username || undefined,
        perPage: 10,
      });
      for (const p of initialPipelines) {
        this.pipelineStatuses.set(p.id, p.status);
      }

      log(
        `[GitLab Daemon] Initialized state: ${this.seenTodoIds.size} todos, ${this.seenEventIds.size} events, ${this.pipelineStatuses.size} pipelines cached.`,
      );
    } catch (err) {
      logWarn(`[GitLab Daemon] Warning during state initialization: ${err.message}`);
    }
  }

  async checkTodos() {
    try {
      const todos = await this.client.getTodos({ state: "pending", perPage: 20 });
      for (const todo of todos) {
        if (this.seenTodoIds.has(todo.id)) continue;
        this.seenTodoIds.add(todo.id);

        const targetType = todo.target_type;
        const targetIid = todo.target?.iid || null;

        const event = {
          category: `To-Do (${todo.action_name})`,
          actionName: todo.action_name,
          author: todo.author?.username || "unknown",
          targetType,
          targetIid,
          mrIid: targetType === "MergeRequest" ? targetIid : null,
          issueIid: targetType === "Issue" ? targetIid : null,
          title: todo.target?.title || todo.body,
          body: todo.body,
          url: todo.target_url,
          raw: todo,
        };

        const result = await this.dispatcher.dispatch(event);
        this.eventsProcessed++;
        log(
          `[GitLab Daemon] New To-Do #${todo.id} (${todo.action_name}): routed=${result.routed} (${result.targetAgent || result.reason})`,
        );
      }
      return { success: true, source: "todos" };
    } catch (err) {
      logError(`[GitLab Daemon] Error checking todos: ${err.message}`);
      return { success: false, source: "todos", error: err };
    }
  }

  async checkEvents() {
    try {
      const events = await this.client.getProjectEvents({ perPage: 30 });
      for (const ev of events) {
        if (this.seenEventIds.has(ev.id)) continue;
        this.seenEventIds.add(ev.id);

        if (ev.author_username === this.currentUser?.username) {
          continue;
        }

        let mrIid = null;
        let issueIid = null;
        let targetType = ev.target_type;
        const note = ev.note;

        if (note) {
          if (note.noteable_type === "MergeRequest") {
            mrIid = note.noteable_iid;
            targetType = "MergeRequestComment";
          } else if (note.noteable_type === "Issue") {
            issueIid = note.noteable_iid;
            targetType = "IssueComment";
          }
        } else if (ev.target_type === "MergeRequest") {
          mrIid = ev.target_iid;
        } else if (ev.target_type === "Issue" || ev.target_type === "WorkItem") {
          issueIid = ev.target_iid;
        }

        const body = note?.body || "";
        const myUsername = this.currentUser?.username;
        const mentionsMe = Boolean(
          myUsername && (body.includes(`@${myUsername}`) || body.includes(myUsername)),
        );
        const isMyMr = Boolean(mrIid && this.relevantMrIids.has(Number(mrIid)));
        const isMyIssue = Boolean(issueIid && this.relevantIssueIids.has(Number(issueIid)));

        const matchingAgent = this.registry.findMatchingAgent({
          mrIid,
          issueIid,
          eventType: ev.action_name,
          author: ev.author_username,
          ref: ev.push_data?.ref,
          targetType,
        });

        if (!matchingAgent && !isMyMr && !isMyIssue && !mentionsMe) {
          continue;
        }

        const event = {
          category: `Project Event (${ev.action_name})`,
          actionName: ev.action_name,
          author: ev.author_username,
          targetType: targetType || ev.action_name,
          targetIid: mrIid || issueIid || ev.target_iid,
          mrIid: mrIid ? Number(mrIid) : null,
          issueIid: issueIid ? Number(issueIid) : null,
          ref: ev.push_data?.ref || null,
          title: ev.target_title || ev.push_data?.commit_title || "",
          body,
          raw: ev,
        };

        const result = await this.dispatcher.dispatch(event);
        this.eventsProcessed++;
        log(
          `[GitLab Daemon] New Event #${ev.id} (${ev.action_name} by @${ev.author_username}): routed=${result.routed} (${result.targetAgent || result.reason})`,
        );
      }
      return { success: true, source: "events" };
    } catch (err) {
      logError(`[GitLab Daemon] Error checking project events: ${err.message}`);
      return { success: false, source: "events", error: err };
    }
  }

  async checkPipelines() {
    try {
      const pipelines = await this.client.getPipelines({
        username: this.currentUser?.username || undefined,
        perPage: 10,
      });
      for (const pipe of pipelines) {
        const prevStatus = this.pipelineStatuses.get(pipe.id);
        this.pipelineStatuses.set(pipe.id, pipe.status);

        if (!prevStatus) continue;

        if (prevStatus !== pipe.status) {
          if (pipe.status === "failed" || pipe.status === "success" || pipe.status === "canceled") {
            const event = {
              category: `Pipeline Alert (${pipe.status.toUpperCase()})`,
              actionName: `pipeline_${pipe.status}`,
              author: "GitLab CI/CD",
              targetType: "Pipeline",
              targetIid: pipe.id,
              ref: pipe.ref,
              title: `Pipeline #${pipe.id} on ${pipe.ref} status changed: ${prevStatus} -> ${pipe.status}`,
              url: pipe.web_url,
              raw: pipe,
            };

            const result = await this.dispatcher.dispatch(event);
            this.eventsProcessed++;
            log(
              `[GitLab Daemon] Pipeline #${pipe.id} status changed to ${pipe.status}: routed=${result.routed}`,
            );
          }
        }
      }
      return { success: true, source: "pipelines" };
    } catch (err) {
      logError(`[GitLab Daemon] Error checking pipelines: ${err.message}`);
      return { success: false, source: "pipelines", error: err };
    }
  }

  async handlePollFailure(failures) {
    for (const f of failures) {
      this.failingSourcesThisStreak.add(f.source);
    }

    const result = this.health.recordFailure();
    const summary = failures.map((f) => `${f.source}: ${f.error.message}`).join("; ");
    logError(`[GitLab Daemon] Poll check(s) failing: ${summary}`);
    if (!result.shouldAlert) return;

    const sinceIso = new Date(result.since).toISOString();
    const sources = Array.from(this.failingSourcesThisStreak).join(", ");
    const event = {
      category: "Daemon Health (ALERT)",
      actionName: "daemon_health_alert",
      author: "GitLab Daemon",
      targetType: "DaemonHealth",
      title: `GitLab daemon checks failing since ${sinceIso} (${sources}): ${summary}`,
      raw: {
        since: sinceIso,
        failures: failures.map((f) => ({ source: f.source, error: f.error.message })),
      },
    };

    const dispatchResult = await this.dispatcher.dispatchToCoordinator(event);
    const delivered = Boolean(dispatchResult.routed && dispatchResult.delivery?.success);
    if (delivered) {
      this.health.markAlertDelivered();
      log(`[GitLab Daemon] Health ALERT delivered to coordinator (since ${sinceIso}, ${sources})`);
    } else {
      const reason = dispatchResult.delivery?.error || dispatchResult.reason || "unknown delivery failure";
      logError(`[GitLab Daemon] Health ALERT delivery failed, will retry next tick: ${reason}`);
    }
  }

  async handlePollSuccess() {
    const recoveredSources = Array.from(this.failingSourcesThisStreak);
    const result = this.health.recordSuccess();

    if (!result.shouldRecover) {
      this.failingSourcesThisStreak.clear();
      return;
    }

    const nowIso = new Date().toISOString();
    const sources = recoveredSources.join(", ") || "unknown";
    const event = {
      category: "Daemon Health (RECOVERED)",
      actionName: "daemon_health_recovered",
      author: "GitLab Daemon",
      targetType: "DaemonHealth",
      title: `GitLab daemon polling recovered at ${nowIso} (previously failing: ${sources})`,
      raw: { recoveredAt: nowIso, previouslyFailing: recoveredSources },
    };

    const dispatchResult = await this.dispatcher.dispatchToCoordinator(event);
    const delivered = Boolean(dispatchResult.routed && dispatchResult.delivery?.success);
    if (delivered) {
      this.health.markRecoveredDelivered();
      this.failingSourcesThisStreak.clear();
      log(`[GitLab Daemon] Health RECOVERED delivered to coordinator (${sources})`);
    } else {
      const reason = dispatchResult.delivery?.error || dispatchResult.reason || "unknown delivery failure";
      logError(
        `[GitLab Daemon] Health RECOVERED delivery failed, will retry next successful tick: ${reason}`,
      );
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date().toISOString();
    await this.init();

    const intervalSec = Math.round(this.getEffectiveIntervalMs() / 1000);
    log(
      `[GitLab Daemon] Event router started. Poll interval: ${intervalSec}s (work hours only: ${this.workHoursOnly})`,
    );
    this.saveState();

    const tick = async () => {
      if (!this.running) return;

      if (this.workHoursOnly && !isWorkingHours()) {
        log("[GitLab Daemon] Sleeping outside working hours (08:00 - 21:00 Mon-Fri). Will recheck later.");
        if (this.health.resetStreakIfPending()) {
          this.failingSourcesThisStreak.clear();
        }
        this.saveState();
        if (this.running) {
          this.timer = setTimeout(tick, 300 * 1000);
        }
        return;
      }

      let refreshResult = { success: true, source: "relevantTargets" };
      if (Date.now() - this.lastRelevantRefreshAt > 300_000) {
        refreshResult = await this.refreshRelevantItems();
      }

      this.lastPollAt = new Date().toISOString();
      const todosResult = await this.checkTodos();
      const eventsResult = await this.checkEvents();
      const pipelinesResult = await this.checkPipelines();
      this.saveState();

      const failures = [refreshResult, todosResult, eventsResult, pipelinesResult].filter(
        (r) => r && !r.success,
      );
      if (failures.length > 0) {
        await this.handlePollFailure(failures);
      } else {
        await this.handlePollSuccess();
      }

      if (this.running) {
        const nextIntervalMs = this.getEffectiveIntervalMs();
        this.timer = setTimeout(tick, nextIntervalMs);
      }
    };

    this.timer = setTimeout(tick, 1000);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearState();
    log("[GitLab Daemon] Stopped.");
  }
}
