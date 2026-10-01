#!/usr/bin/env node

import { GitLabClient } from "../src/gitlab-client.js";
import { SubscriptionRegistry } from "../src/subscriptions.js";
import { EventDispatcher } from "../src/dispatcher.js";
import { GitLabDaemon } from "../src/daemon.js";
import { McpServer } from "../src/mcp.js";
import { loadConfig, saveConfig, getConfigPath } from "../src/config.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const args = process.argv.slice(2);
const command = args[0] || "help";

function parseFlags(rawArgs) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (rawArgs[i + 1] && !rawArgs[i + 1].startsWith("--")) {
        flags[key] = rawArgs[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function printHelp() {
  console.log(`
gitlab-agent-router (gitlab / paseo-gitlab) - Unified GitLab CLI, Real-Time Router & MCP Server for AI Fleets

USAGE:
  gitlab <command> [arguments...] [options...]

COMMANDS:
  whoami                           Test authentication and print current GitLab user
  todos                            List pending todos (mentions, review requests, assignments)
                                   Options: --state <pending|done> --limit <n>
  mr <iid>                         View Merge Request details
                                   Options: --project <id> (or configured default)
  mr-notes <iid>                   View comments and discussions on an MR
                                   Options: --project <id> --limit <n>
  mr-comment <iid> <text>          Add a comment to a Merge Request
                                   Options: --project <id>
  issue <iid>                      View Issue details
                                   Options: --project <id>
  issue-notes <iid>                View comments on an Issue
                                   Options: --project <id> --limit <n>
  issue-comment <iid> <text>       Add a comment to an Issue
                                   Options: --project <id>
  pipelines                        View recent CI/CD pipelines
                                   Options: --project <id> --scope <branches|finished> --limit <n>

  subscribe                        Subscribe a Paseo agent to receive real-time push events
                                   Options: --agent <id> [--mr <iid>] [--issue <iid>] [--type <type>] [--project <id>]
  unsubscribe                      Remove an active subscription
                                   Options: --id <sub_id> | --agent <id> | --mr <iid> | --issue <iid>
  subscriptions (subs)             List all active subscriptions & current coordinator
  set-coordinator <agent-id>       Set the default Coordinator Paseo Agent (pass 'none' or --clear to unset)
  unset-coordinator                Clear the default Coordinator Paseo Agent

  daemon                           Start the real-time event router daemon (push updates to Paseo agents)
                                   Options: --interval <seconds> (default: 60s) --dry-run (log dispatches instead of sending)
  mcp                              Run the stdio MCP server for Paseo / Claude / Antigravity / OpenCode
  api <endpoint> [key=value...]    Call any GitLab REST API v4 endpoint directly
  config [key=value...]            View or update configuration
                                   (Config file: ${getConfigPath()})

EXAMPLES:
  gitlab whoami
  gitlab todos
  gitlab mr 101
  gitlab subscribe --agent agent-worker-1 --mr 101
  gitlab set-coordinator agent-coord-1
  gitlab daemon
`);
}

async function main() {
  const { flags, positional } = parseFlags(args.slice(1));
  const client = new GitLabClient();
  const registry = new SubscriptionRegistry();

  try {
    switch (command) {
      case "help":
      case "--help":
      case "-h": {
        printHelp();
        break;
      }

      case "whoami": {
        const user = await client.getCurrentUser();
        console.log(`User:     ${user.name} (@${user.username})`);
        console.log(`ID:       ${user.id}`);
        console.log(`Email:    ${user.email}`);
        console.log(`Web URL:  ${user.web_url}`);
        break;
      }

      case "todos": {
        const todos = await client.getTodos({
          state: flags.state || "pending",
          perPage: parseInt(flags.limit, 10) || 20,
        });

        if (flags.json) {
          console.log(JSON.stringify(todos, null, 2));
        } else {
          console.log(`Pending Todos (${todos.length}):`);
          for (const t of todos) {
            const author = t.author ? `@${t.author.username}` : "someone";
            const target =
              t.target_type === "MergeRequest" ? `!${t.target?.iid}` : `#${t.target?.iid || t.target_id}`;
            console.log(
              `- [${t.id}] [${t.action_name}] ${target} by ${author}: ${t.body || t.target?.title}`,
            );
          }
        }
        break;
      }

      case "mr": {
        const mrIid = positional[0] || flags.mr || flags.iid;
        if (!mrIid) {
          console.error("Error: MR IID is required. Usage: gitlab mr <iid>");
          process.exit(1);
        }

        const projectId = flags.project || client.defaultProjectId;
        const mr = await client.getMergeRequest({ projectId, mrIid: Number(mrIid) });

        if (flags.json) {
          console.log(JSON.stringify(mr, null, 2));
        } else {
          console.log(`MR !${mr.iid}: ${mr.title} (${mr.state})`);
          console.log(`Author:   @${mr.author?.username} (${mr.author?.name})`);
          console.log(`Branch:   ${mr.source_branch} -> ${mr.target_branch}`);
          console.log(`URL:      ${mr.web_url}`);
          console.log(
            `Pipeline: ${mr.head_pipeline ? `${mr.head_pipeline.status} (#${mr.head_pipeline.id})` : "none"}`,
          );
          if (mr.description) {
            console.log(`\nDescription:\n${mr.description}`);
          }
        }
        break;
      }

      case "mr-notes":
      case "notes": {
        const mrIid = positional[0] || flags.mr || flags.iid;
        if (!mrIid) {
          console.error("Error: MR IID is required. Usage: gitlab mr-notes <iid>");
          process.exit(1);
        }

        const projectId = flags.project || client.defaultProjectId;
        const notes = await client.getMergeRequestNotes({
          projectId,
          mrIid: Number(mrIid),
          perPage: parseInt(flags.limit, 10) || 20,
        });

        if (flags.json) {
          console.log(JSON.stringify(notes, null, 2));
        } else {
          console.log(`Notes for MR !${mrIid} (${notes.length}):`);
          for (const n of notes) {
            if (n.system) continue;
            console.log(`----------------------------------------`);
            console.log(`[${n.id}] @${n.author?.username} at ${n.created_at}:`);
            console.log(n.body);
          }
        }
        break;
      }

      case "mr-comment":
      case "comment": {
        const mrIid = positional[0];
        const text = positional[1] || flags.text || flags.body;
        if (!mrIid || !text) {
          console.error('Error: MR IID and text are required. Usage: gitlab mr-comment <iid> "<text>"');
          process.exit(1);
        }

        const projectId = flags.project || client.defaultProjectId;
        const note = await client.createMergeRequestNote({
          projectId,
          mrIid: Number(mrIid),
          body: text,
        });

        console.log(`Note posted to MR !${mrIid} (Note ID: ${note.id})`);
        break;
      }

      case "issue": {
        const issueIid = positional[0] || flags.issue || flags.iid;
        if (!issueIid) {
          console.error("Error: Issue IID is required. Usage: gitlab issue <iid>");
          process.exit(1);
        }

        const projectId = flags.project || client.defaultProjectId;
        const issue = await client.getIssue({ projectId, issueIid: Number(issueIid) });

        if (flags.json) {
          console.log(JSON.stringify(issue, null, 2));
        } else {
          console.log(`Issue #${issue.iid}: ${issue.title} (${issue.state})`);
          console.log(`Author:   @${issue.author?.username}`);
          console.log(`URL:      ${issue.web_url}`);
          if (issue.description) {
            console.log(`\nDescription:\n${issue.description}`);
          }
        }
        break;
      }

      case "issue-notes": {
        const issueIid = positional[0] || flags.issue || flags.iid;
        if (!issueIid) {
          console.error("Error: Issue IID is required. Usage: gitlab issue-notes <iid>");
          process.exit(1);
        }

        const projectId = flags.project || client.defaultProjectId;
        const notes = await client.getIssueNotes({
          projectId,
          issueIid: Number(issueIid),
          perPage: parseInt(flags.limit, 10) || 20,
        });

        if (flags.json) {
          console.log(JSON.stringify(notes, null, 2));
        } else {
          for (const n of notes) {
            if (n.system) continue;
            console.log(`----------------------------------------`);
            console.log(`[${n.id}] @${n.author?.username} at ${n.created_at}:`);
            console.log(n.body);
          }
        }
        break;
      }

      case "issue-comment": {
        const issueIid = positional[0];
        const text = positional[1] || flags.text || flags.body;
        if (!issueIid || !text) {
          console.error('Error: Issue IID and text are required. Usage: gitlab issue-comment <iid> "<text>"');
          process.exit(1);
        }

        const projectId = flags.project || client.defaultProjectId;
        const note = await client.createIssueNote({
          projectId,
          issueIid: Number(issueIid),
          body: text,
        });

        console.log(`Note posted to Issue #${issueIid} (Note ID: ${note.id})`);
        break;
      }

      case "pipelines": {
        const projectId = flags.project || client.defaultProjectId;
        const pipelines = await client.getPipelines({
          projectId,
          scope: flags.scope || "branches",
          perPage: parseInt(flags.limit, 10) || 10,
        });

        if (flags.json) {
          console.log(JSON.stringify(pipelines, null, 2));
        } else {
          console.log(`Recent Pipelines for Project ${projectId}:`);
          for (const p of pipelines) {
            console.log(`- [#${p.id}] status: ${p.status.padEnd(8)} ref: ${p.ref} (${p.web_url})`);
          }
        }
        break;
      }

      case "subscribe": {
        const agentId = flags.agent || flags.agent_id || positional[0];
        if (!agentId) {
          console.error("Error: --agent <id> is required.");
          process.exit(1);
        }

        const sub = registry.add({
          agentId,
          projectId: flags.project || client.defaultProjectId,
          mrIid: flags.mr || flags.mr_iid,
          issueIid: flags.issue || flags.issue_iid,
          eventType: flags.type || flags.event_type,
          author: flags.author || flags.user || flags.from,
          ref: flags.ref || flags.branch,
        });

        console.log(`Subscribed agent ${sub.agentId} (ID: ${sub.id})`);
        if (sub.mrIid) console.log(`  MR: !${sub.mrIid}`);
        if (sub.issueIid) console.log(`  Issue: #${sub.issueIid}`);
        if (sub.ref) console.log(`  Ref/Branch: ${sub.ref}`);
        if (sub.author) console.log(`  Author: @${sub.author}`);
        if (sub.eventType) console.log(`  Event Type: ${sub.eventType}`);
        break;
      }

      case "unsubscribe": {
        const count = registry.remove({
          id: flags.id,
          agentId: flags.agent || flags.agent_id,
          mrIid: flags.mr || flags.mr_iid,
          issueIid: flags.issue || flags.issue_iid,
          ref: flags.ref || flags.branch,
          author: flags.author || flags.user || flags.from,
        });
        console.log(`Removed ${count} subscription(s).`);
        break;
      }

      case "subscriptions":
      case "subs": {
        const coordinator = registry.getCoordinator();
        const subs = registry.list();

        console.log(`Coordinator Agent: ${coordinator || "(none configured)"}`);
        console.log(`Active Subscriptions (${subs.length}):`);
        for (const s of subs) {
          console.log(
            `- [${s.id}] Agent: ${s.agentId} | Project: ${s.projectId} | MR: ${s.mrIid || "*"} | Issue: ${s.issueIid || "*"} | Ref: ${s.ref || "*"} | Author: ${s.author || "*"} | Type: ${s.eventType || "*"}`,
          );
        }
        break;
      }

      case "unset-coordinator":
      case "clear-coordinator": {
        registry.setCoordinator(null);
        console.log("GitLab coordinator agent cleared.");
        break;
      }

      case "set-coordinator": {
        const agentId = positional[0] || flags.agent;
        if (!agentId || agentId === "none" || agentId === "clear" || flags.clear) {
          registry.setCoordinator(null);
          console.log("GitLab coordinator agent cleared.");
          break;
        }
        registry.setCoordinator(agentId);
        console.log(`GitLab coordinator agent set to: ${agentId}`);
        break;
      }

      case "daemon": {
        const subCmd = positional[0] || "start";
        const stateFile = path.join(os.homedir(), ".config", "gitlab-router", "daemon-state.json");

        if (subCmd === "status") {
          if (fs.existsSync(stateFile)) {
            try {
              const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
              if (state.pid) {
                try {
                  process.kill(state.pid, 0);
                  console.log(JSON.stringify(state, null, 2));
                  break;
                } catch {
                  fs.unlinkSync(stateFile);
                }
              }
            } catch {}
          }
          console.log(
            JSON.stringify({ running: false, activeSubscriptions: registry.list().length }, null, 2),
          );
          break;
        }

        if (subCmd === "stop") {
          if (fs.existsSync(stateFile)) {
            try {
              const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
              if (state.pid) {
                process.kill(state.pid, "SIGTERM");
                fs.unlinkSync(stateFile);
                console.log(`Stopped GitLab daemon PID ${state.pid}`);
                break;
              }
            } catch (err) {
              console.error(`Failed to stop daemon: ${err.message}`);
            }
          }
          console.log("No active daemon was running.");
          break;
        }

        if (fs.existsSync(stateFile)) {
          try {
            const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
            if (state.pid) {
              try {
                process.kill(state.pid, 0);
                console.error(
                  `A GitLab daemon is already running (PID ${state.pid}). Use 'gitlab daemon stop' first.`,
                );
                process.exit(1);
              } catch {
                fs.unlinkSync(stateFile);
              }
            }
          } catch {}
        }

        const dispatcher = new EventDispatcher({ registry, config: client.config });
        const intervalMs = flags.interval ? parseInt(flags.interval, 10) * 1000 : undefined;
        const workHoursOnly = !flags.force && (flags["all-hours"] ? false : true);
        const dryRun = Boolean(flags["dry-run"]);
        const daemon = new GitLabDaemon({
          client,
          dispatcher,
          registry,
          pollIntervalMs: intervalMs,
          workHoursOnly,
          dryRun,
        });

        process.on("SIGINT", () => {
          daemon.stop();
          process.exit(0);
        });
        process.on("SIGTERM", () => {
          daemon.stop();
          process.exit(0);
        });

        console.log(`Starting gitlab-agent-router daemon...${dryRun ? " (dry-run)" : ""}`);
        await daemon.start();
        break;
      }

      case "mcp": {
        const server = new McpServer({ client, registry });
        server.startStdio();
        break;
      }

      case "api": {
        const endpoint = positional[0];
        if (!endpoint) {
          console.error("Error: API endpoint required. Usage: gitlab api <endpoint> [key=value...]");
          process.exit(1);
        }

        const params = {};
        for (let i = 1; i < positional.length; i++) {
          const [k, v] = positional[i].split("=");
          if (k && v !== undefined) params[k] = v;
        }
        for (const [k, v] of Object.entries(flags)) {
          params[k] = v;
        }

        const method = flags.method || "GET";
        const res = await client.request(endpoint, { method, params });
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case "config": {
        if (positional.length === 0 && Object.keys(flags).length === 0) {
          console.log(JSON.stringify(loadConfig(), null, 2));
        } else {
          const updates = {};
          for (const item of positional) {
            const [k, v] = item.split("=");
            if (k && v !== undefined) updates[k] = v;
          }
          for (const [k, v] of Object.entries(flags)) {
            updates[k] = v;
          }
          const saved = saveConfig(updates);
          console.log("Updated configuration:");
          console.log(JSON.stringify(saved, null, 2));
        }
        break;
      }

      default: {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
