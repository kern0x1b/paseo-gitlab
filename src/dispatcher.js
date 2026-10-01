import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SubscriptionRegistry } from "./subscriptions.js";
import { loadConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export class GitLabEventDispatcher {
  constructor({ registry = new SubscriptionRegistry(), config = loadConfig(), myUsername = null } = {}) {
    this.registry = registry;
    this.config = config;
    this.myUsername = myUsername;
  }

  setMyUsername(username) {
    this.myUsername = username;
  }

  buildEventPrompt(event) {
    const lines = [`[GitLab Incoming ${event.category || "Event"}]`];

    if (event.actionName) lines.push(`Action: ${event.actionName}`);
    if (event.author) lines.push(`Author: ${event.author}`);
    if (event.targetType)
      lines.push(`Target: ${event.targetType} ${event.targetIid ? "#" + event.targetIid : ""}`);
    if (event.title) lines.push(`Title: ${event.title}`);
    if (event.body) {
      lines.push(`Content:`);
      lines.push(event.body);
    }
    if (event.url) lines.push(`URL: ${event.url}`);
    lines.push("---");
    lines.push(`Event JSON: ${JSON.stringify(event.raw || event)}`);

    return lines.join("\n");
  }

  buildFleetEnvelope(event) {
    const host = this.config.host || "https://gitlab.com";
    const project = event.projectPath || event.project || this.config.defaultProjectId || "default";
    const eventType = (event.actionName || event.category || "event").toLowerCase().replace(/[\s()]+/g, "_");
    const actorName = event.author || "unknown";
    const id = event.raw?.id
      ? String(event.raw.id)
      : `evt_gl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const iid = event.mrIid || event.issueIid || event.targetIid || "";
    const targetType = event.mrIid
      ? "mr"
      : event.issueIid
        ? "issue"
        : (event.targetType || "project").toLowerCase();
    const cleanHost = host.replace(/^https?:\/\//, "");
    const urn = `urn:gitlab:${cleanHost}:${project}:${targetType}:${iid || id}`;

    let replyAction = { type: "none" };
    if (event.mrIid) {
      replyAction = {
        type: "mcp",
        tool: "gitlab_create_mr_note",
        params: {
          project_id: project,
          mr_iid: Number(event.mrIid),
        },
      };
    } else if (event.issueIid) {
      replyAction = {
        type: "mcp",
        tool: "gitlab_create_issue_note",
        params: {
          project_id: project,
          issue_iid: Number(event.issueIid),
        },
      };
    }

    return {
      protocol: "paseo-fleet/v1",
      id: `evt_gl_${id}`,
      timestamp: new Date().toISOString(),
      source: "gitlab",
      instance: host,
      scope: String(project),
      urn,
      event_type: eventType,
      actor: {
        id: actorName,
        name: actorName,
        is_bot: actorName.includes("bot") || actorName === "GitLab CI/CD",
      },
      target: {
        type: targetType,
        id: String(iid || id),
        title: event.title || "",
        url: event.url || "",
      },
      content:
        event.body ||
        (event.category && event.title
          ? `[${event.category}] ${event.title}`
          : event.title || event.category || ""),
      reply_action: replyAction,
    };
  }

  async sendToPaseo(agentId, prompt) {
    const paseoBin = this.config.paseoBin || "paseo";
    try {
      const { stdout, stderr } = await execFileAsync(paseoBin, ["send", agentId, prompt, "--no-wait"]);
      return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async dispatch(event) {
    const specificAgent = this.registry.findMatchingAgent(event);

    if (specificAgent) {
      const prompt = this.buildEventPrompt(event);
      const result = await this.sendToPaseo(specificAgent, prompt);
      return {
        routed: true,
        type: "specific_agent",
        targetAgent: specificAgent,
        delivery: result,
      };
    }

    const coordinatorId = this.registry.getCoordinator() || this.config.coordinatorAgentId;

    if (coordinatorId) {
      const envelope = this.buildFleetEnvelope(event);
      const envelopeJson = JSON.stringify(envelope, null, 2);
      const result = await this.sendToPaseo(coordinatorId, envelopeJson);
      return {
        routed: true,
        type: "coordinator",
        targetAgent: coordinatorId,
        delivery: result,
        envelope,
      };
    }

    const fallbackPrompt = this.buildEventPrompt(event);
    return {
      routed: false,
      reason: "No matching subscription and no coordinator configured",
      eventPrompt: fallbackPrompt,
    };
  }

  async dispatchToCoordinator(event) {
    const coordinatorId = this.registry.getCoordinator() || this.config.coordinatorAgentId;
    const envelope = this.buildFleetEnvelope(event);
    const envelopeJson = JSON.stringify(envelope, null, 2);

    if (!coordinatorId) {
      return {
        routed: false,
        reason: "No coordinator configured",
        eventPrompt: envelopeJson,
      };
    }

    const result = await this.sendToPaseo(coordinatorId, envelopeJson);
    return {
      routed: true,
      type: "coordinator",
      targetAgent: coordinatorId,
      delivery: result,
      envelope,
    };
  }
}

export { GitLabEventDispatcher as EventDispatcher };
