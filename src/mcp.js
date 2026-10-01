import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GitLabClient } from "./gitlab-client.js";
import { SubscriptionRegistry } from "./subscriptions.js";
import { GitLabDaemon } from "./daemon.js";

const STATE_FILE = path.join(os.homedir(), ".config", "gitlab-router", "daemon-state.json");

export class McpServer {
  constructor({ client = new GitLabClient(), registry = new SubscriptionRegistry() } = {}) {
    this.client = client;
    this.registry = registry;
    this.daemon = null;
  }

  getTools() {
    return [
      {
        name: "gitlab_start_daemon",
        description:
          "Start the GitLab push event router daemon. Recommended during active sessions in working hours (08:00-21:00 Mon-Fri). Pushes new events directly to subscribed Paseo agents.",
        inputSchema: {
          type: "object",
          properties: {
            interval_seconds: {
              type: "number",
              description: "Polling interval in seconds (default: 60s)",
            },
            work_hours_only: {
              type: "boolean",
              description:
                "If true, limits active polling to work hours (08:00-21:00 Mon-Fri) and sleeps off-hours. Default: true",
            },
            force: {
              type: "boolean",
              description: "Force immediate start even outside working hours. Default: false",
            },
          },
        },
      },
      {
        name: "gitlab_stop_daemon",
        description: "Stop the running GitLab event router daemon.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "gitlab_daemon_status",
        description: "Check current GitLab daemon status, uptime, poll interval, and active subscriptions.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "gitlab_subscribe",
        description:
          "Subscribe a Paseo agent to receive real-time push events from GitLab. Supports general subscription (all events) or specific targeting (by MR, Issue, branch/ref, event type, or author).",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: { type: "string", description: "Paseo agent ID to route events to" },
            mr_iid: { type: "number", description: "Specific Merge Request IID (e.g. 101)" },
            issue_iid: { type: "number", description: "Specific Issue IID (e.g. 42)" },
            ref: { type: "string", description: "Branch or ref filter (e.g. main or feature branch)" },
            author: { type: "string", description: "Author username to filter events by (e.g. alex.dev)" },
            event_type: {
              type: "string",
              description: "Event category filter: all, mr, issue, pipeline, todo, comment (default: all)",
            },
            project_id: { type: "number", description: "Project ID (or configured default)" },
          },
          required: ["agent_id"],
        },
      },
      {
        name: "gitlab_unsubscribe",
        description: "Remove an active GitLab event subscription.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Subscription ID" },
            agent_id: { type: "string", description: "Agent ID" },
            mr_iid: { type: "number", description: "Merge Request IID" },
            issue_iid: { type: "number", description: "Issue IID" },
            ref: { type: "string", description: "Branch ref" },
            author: { type: "string", description: "Author username" },
          },
        },
      },
      {
        name: "gitlab_list_subscriptions",
        description: "List all active GitLab event subscriptions and current coordinator agent.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "gitlab_set_coordinator",
        description: "Set the default Coordinator Paseo Agent that receives unmatched GitLab events.",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: { type: "string", description: "Paseo Agent ID for the coordinator" },
          },
          required: ["agent_id"],
        },
      },
      {
        name: "gitlab_get_user",
        description: "Get authenticated GitLab user details.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "gitlab_get_todos",
        description: "Get pending GitLab todos (notifications, mentions, review requests).",
        inputSchema: {
          type: "object",
          properties: {
            state: { type: "string", description: "State: pending or done (default: pending)" },
            per_page: { type: "number", description: "Number of items (default: 20)" },
          },
        },
      },
      {
        name: "gitlab_mark_todo_done",
        description: "Mark a GitLab todo item as done.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Todo ID to mark done" },
          },
          required: ["id"],
        },
      },
      {
        name: "gitlab_get_mr",
        description: "Get GitLab Merge Request details.",
        inputSchema: {
          type: "object",
          properties: {
            mr_iid: { type: "number", description: "Merge Request IID" },
            project_id: { type: "number", description: "Project ID (or configured default)" },
          },
          required: ["mr_iid"],
        },
      },
      {
        name: "gitlab_get_mr_notes",
        description: "Get notes/comments for a Merge Request.",
        inputSchema: {
          type: "object",
          properties: {
            mr_iid: { type: "number", description: "Merge Request IID" },
            project_id: { type: "number", description: "Project ID (or configured default)" },
            per_page: { type: "number", description: "Number of notes (default: 20)" },
          },
          required: ["mr_iid"],
        },
      },
      {
        name: "gitlab_create_mr_note",
        description: "Post a comment/note to a Merge Request.",
        inputSchema: {
          type: "object",
          properties: {
            mr_iid: { type: "number", description: "Merge Request IID" },
            body: { type: "string", description: "Comment text (Markdown)" },
            project_id: { type: "number", description: "Project ID (or configured default)" },
          },
          required: ["mr_iid", "body"],
        },
      },
      {
        name: "gitlab_get_issue",
        description: "Get GitLab Issue details.",
        inputSchema: {
          type: "object",
          properties: {
            issue_iid: { type: "number", description: "Issue IID" },
            project_id: { type: "number", description: "Project ID (or configured default)" },
          },
          required: ["issue_iid"],
        },
      },
      {
        name: "gitlab_get_issue_notes",
        description: "Get notes/comments for an Issue.",
        inputSchema: {
          type: "object",
          properties: {
            issue_iid: { type: "number", description: "Issue IID" },
            project_id: { type: "number", description: "Project ID (or configured default)" },
            per_page: { type: "number", description: "Number of notes (default: 20)" },
          },
          required: ["issue_iid"],
        },
      },
      {
        name: "gitlab_create_issue_note",
        description: "Post a comment/note to an Issue.",
        inputSchema: {
          type: "object",
          properties: {
            issue_iid: { type: "number", description: "Issue IID" },
            body: { type: "string", description: "Comment text (Markdown)" },
            project_id: { type: "number", description: "Project ID (or configured default)" },
          },
          required: ["issue_iid", "body"],
        },
      },
      {
        name: "gitlab_get_pipelines",
        description: "Get recent CI/CD pipelines.",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "number", description: "Project ID (or configured default)" },
            scope: { type: "string", description: "Scope: running, pending, finished, branches, tags" },
            per_page: { type: "number", description: "Number of pipelines (default: 10)" },
          },
        },
      },
      {
        name: "gitlab_get_pipeline",
        description: "Get specific CI/CD pipeline details.",
        inputSchema: {
          type: "object",
          properties: {
            pipeline_id: { type: "number", description: "Pipeline ID" },
            project_id: { type: "number", description: "Project ID (or configured default)" },
          },
          required: ["pipeline_id"],
        },
      },
      {
        name: "gitlab_api_call",
        description: "Call any GitLab REST API v4 endpoint directly.",
        inputSchema: {
          type: "object",
          properties: {
            endpoint: { type: "string", description: "API endpoint (e.g. projects/123/merge_requests)" },
            method: { type: "string", description: "HTTP method (GET, POST, PUT, DELETE, default GET)" },
            params: { type: "object", description: "Query parameters" },
            body: { type: "object", description: "Request body" },
          },
          required: ["endpoint"],
        },
      },
    ];
  }

  async handleToolCall(name, args) {
    switch (name) {
      case "gitlab_start_daemon": {
        if (this.daemon && this.daemon.running) {
          return { status: "already_running", details: this.daemon.getStatus() };
        }

        const intervalMs = args.interval_seconds ? args.interval_seconds * 1000 : null;
        const workHoursOnly = args.work_hours_only !== false;
        const force = Boolean(args.force);

        this.daemon = new GitLabDaemon({
          client: this.client,
          registry: this.registry,
          pollIntervalMs: intervalMs,
          workHoursOnly: !force && workHoursOnly,
        });

        // Start asynchronously so tool call returns promptly
        this.daemon.start().catch((err) => {
          console.error("[MCP GitLabDaemon Error]", err);
        });

        return {
          status: "started",
          message: "GitLab push event router daemon started successfully.",
          details: this.daemon.getStatus(),
        };
      }

      case "gitlab_stop_daemon": {
        if (this.daemon && this.daemon.running) {
          const stats = this.daemon.getStatus();
          this.daemon.stop();
          this.daemon = null;
          return { status: "stopped", details: stats };
        }

        // Also check if an external daemon is running via state file
        if (fs.existsSync(STATE_FILE)) {
          try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            if (state.pid) {
              process.kill(state.pid, "SIGTERM");
              fs.unlinkSync(STATE_FILE);
              return { status: "stopped", message: `Stopped external daemon PID ${state.pid}` };
            }
          } catch {}
        }

        return { status: "not_running", message: "No active daemon is currently running." };
      }

      case "gitlab_daemon_status": {
        if (this.daemon) {
          return this.daemon.getStatus();
        }

        if (fs.existsSync(STATE_FILE)) {
          try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            return { running: true, external: true, ...state };
          } catch {}
        }

        return { running: false, activeSubscriptions: this.registry.list().length };
      }

      case "gitlab_subscribe": {
        const sub = this.registry.add({
          agentId: args.agent_id,
          projectId: args.project_id || this.client.defaultProjectId,
          mrIid: args.mr_iid,
          issueIid: args.issue_iid,
          eventType: args.event_type,
          author: args.author,
          ref: args.ref,
        });
        return { status: "subscribed", subscription: sub };
      }

      case "gitlab_unsubscribe": {
        const count = this.registry.remove({
          id: args.id,
          agentId: args.agent_id,
          mrIid: args.mr_iid,
          issueIid: args.issue_iid,
          ref: args.ref,
          author: args.author,
        });
        return { status: "unsubscribed", count };
      }

      case "gitlab_list_subscriptions": {
        return {
          coordinator: this.registry.getCoordinator(),
          subscriptions: this.registry.list(),
        };
      }

      case "gitlab_set_coordinator": {
        this.registry.setCoordinator(args.agent_id);
        return { status: "coordinator_updated", coordinator: args.agent_id };
      }

      case "gitlab_get_user": {
        return await this.client.getCurrentUser();
      }

      case "gitlab_get_todos": {
        return await this.client.getTodos({
          state: args.state || "pending",
          perPage: args.per_page || 20,
        });
      }

      case "gitlab_mark_todo_done": {
        return await this.client.markTodoDone(args.id);
      }

      case "gitlab_get_mr": {
        return await this.client.getMergeRequest({
          projectId: args.project_id || this.client.defaultProjectId,
          mrIid: args.mr_iid,
        });
      }

      case "gitlab_get_mr_notes": {
        return await this.client.getMergeRequestNotes({
          projectId: args.project_id || this.client.defaultProjectId,
          mrIid: args.mr_iid,
          perPage: args.per_page || 20,
        });
      }

      case "gitlab_create_mr_note": {
        return await this.client.createMergeRequestNote({
          projectId: args.project_id || this.client.defaultProjectId,
          mrIid: args.mr_iid,
          body: args.body,
        });
      }

      case "gitlab_get_issue": {
        return await this.client.getIssue({
          projectId: args.project_id || this.client.defaultProjectId,
          issueIid: args.issue_iid,
        });
      }

      case "gitlab_get_issue_notes": {
        return await this.client.getIssueNotes({
          projectId: args.project_id || this.client.defaultProjectId,
          issueIid: args.issue_iid,
          perPage: args.per_page || 20,
        });
      }

      case "gitlab_create_issue_note": {
        return await this.client.createIssueNote({
          projectId: args.project_id || this.client.defaultProjectId,
          issueIid: args.issue_iid,
          body: args.body,
        });
      }

      case "gitlab_get_pipelines": {
        return await this.client.getPipelines({
          projectId: args.project_id || this.client.defaultProjectId,
          scope: args.scope || "branches",
          perPage: args.per_page || 10,
        });
      }

      case "gitlab_get_pipeline": {
        return await this.client.getPipeline({
          projectId: args.project_id || this.client.defaultProjectId,
          pipelineId: args.pipeline_id,
        });
      }

      case "gitlab_api_call": {
        return await this.client.call(args.endpoint, {
          method: args.method || "GET",
          params: args.params || {},
          body: args.body || null,
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  startStdio() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    const sendResponse = (resp) => {
      process.stdout.write(JSON.stringify(resp) + "\n");
    };

    rl.on("line", async (line) => {
      if (!line.trim()) return;
      try {
        const req = JSON.parse(line);
        if (req.method === "initialize") {
          sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: "2024-11-05",
              serverInfo: { name: "gitlab-agent-router", version: "1.0.0" },
              capabilities: { tools: {} },
            },
          });
        } else if (req.method === "notifications/initialized") {
          // No-op
        } else if (req.method === "tools/list") {
          sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            result: { tools: this.getTools() },
          });
        } else if (req.method === "tools/call") {
          const { name, arguments: args } = req.params;
          try {
            const data = await this.handleToolCall(name, args || {});
            sendResponse({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
              },
            });
          } catch (err) {
            sendResponse({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                isError: true,
                content: [{ type: "text", text: `Tool error: ${err.message}` }],
              },
            });
          }
        } else if (req.id !== undefined) {
          sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: "Method not found" },
          });
        }
      } catch (err) {
        sendResponse({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` },
        });
      }
    });

    const cleanup = () => {
      if (this.daemon && this.daemon.running) {
        this.daemon.stop();
      }
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("exit", cleanup);
  }
}
