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
    const prompt = this.buildEventPrompt(event);
    const specificAgent = this.registry.findMatchingAgent(event);

    if (specificAgent) {
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
      const result = await this.sendToPaseo(coordinatorId, prompt);
      return {
        routed: true,
        type: "coordinator",
        targetAgent: coordinatorId,
        delivery: result,
      };
    }

    return {
      routed: false,
      reason: "No matching subscription and no coordinator configured",
      eventPrompt: prompt,
    };
  }

  async dispatchToCoordinator(event) {
    const prompt = this.buildEventPrompt(event);
    const coordinatorId = this.registry.getCoordinator() || this.config.coordinatorAgentId;

    if (!coordinatorId) {
      return {
        routed: false,
        reason: "No coordinator configured",
        eventPrompt: prompt,
      };
    }

    const result = await this.sendToPaseo(coordinatorId, prompt);
    return {
      routed: true,
      type: "coordinator",
      targetAgent: coordinatorId,
      delivery: result,
    };
  }
}

export { GitLabEventDispatcher as EventDispatcher };
