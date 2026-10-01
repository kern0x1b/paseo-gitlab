---
name: gitlab-fleet
description: Interact with GitLab issues, merge requests, CI/CD pipelines, and coordinate multi-agent fleets via the event router daemon and MCP tools.
---

# GitLab Fleet & Router Skill

Use this skill when interacting with GitLab resources (MRs, issues, pipelines, to-dos) or coordinating AI agent fleets in response to GitLab events.

## Overview

The repository provides three complementary interfaces:

1. **Paseo Plugin:** Native in-editor UI (explorer panels, diff review, issue boards, item tabs).
2. **Unified CLI (`gitlab`):** Direct terminal access to GitLab resources and fleet daemon management.
3. **MCP Server (`gitlab mcp`):** Stdio MCP server exposing tools to AI agents.

---

## Agent Fleet Coordination & Event Router

The event router daemon (`gitlab daemon`) polls GitLab for real-time activity and pushes events directly to Paseo agents via `paseo send <agentId>`.

### 1. Subscription Routing

Agents can subscribe to specific GitLab events or catch-all updates:

- **By Merge Request (`mr_iid`):** Routes reviews, comments, approvals, and push updates for that MR to the assigned agent.
- **By Issue (`issue_iid`):** Routes discussion updates on that issue.
- **By Branch/Ref (`ref`):** Routes pipeline and push events for a specific branch.
- **By Author (`author`):** Routes events created by a specific user.
- **Coordinator Agent:** Receives unmatched events or system-level alerts.

### 2. Available MCP Tools

| Tool                        | Purpose                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `gitlab_start_daemon`       | Start the background event router daemon with smart polling and working-hours gating.  |
| `gitlab_stop_daemon`        | Stop the background event router.                                                      |
| `gitlab_daemon_status`      | Check daemon process status, uptime, and active subscription count.                    |
| `gitlab_subscribe`          | Register an agent to receive push notifications for MRs, issues, refs, or event types. |
| `gitlab_unsubscribe`        | Remove an active subscription.                                                         |
| `gitlab_list_subscriptions` | List all active agent subscriptions and the current coordinator.                       |
| `gitlab_set_coordinator`    | Set the coordinator agent for unmatched events and health alerts.                      |
| `gitlab_get_todos`          | List pending to-dos (mentions, assignments, review requests).                          |
| `gitlab_mark_todo_done`     | Mark a specific to-do as done.                                                         |
| `gitlab_get_mr`             | Fetch full details of a Merge Request.                                                 |
| `gitlab_get_mr_notes`       | Read discussion comments and reviews on an MR.                                         |
| `gitlab_create_mr_note`     | Post a Markdown comment or reply to an MR.                                             |
| `gitlab_get_issue`          | Fetch issue details.                                                                   |
| `gitlab_get_issue_notes`    | Read comments on an issue.                                                             |
| `gitlab_create_issue_note`  | Post a comment to an issue.                                                            |
| `gitlab_get_pipelines`      | View recent CI/CD pipeline statuses.                                                   |
| `gitlab_get_pipeline`       | Fetch detailed pipeline and job info.                                                  |
| `gitlab_api_call`           | Call any GitLab REST API v4 endpoint directly.                                         |

---

## CLI Usage

When operating in a terminal environment:

```bash
# Check current authenticated user
gitlab whoami

# Check pending to-dos
gitlab todos

# View MR details and discussions
gitlab mr 101
gitlab mr-notes 101

# Comment on an MR
gitlab mr-comment 101 "LGTM! Verified locally."

# Subscribe an agent to an MR
gitlab subscribe --agent <agent-id> --mr 101

# Set the coordinator agent
gitlab set-coordinator <agent-id>

# Run daemon in dry-run mode (logs dispatches instead of sending)
gitlab daemon --dry-run
```

---

## Environment & Configuration

Configuration is stored in `~/.config/gitlab-router/config.json`. The following environment variables override file configuration:

- `GITLAB_HOST`: GitLab host (e.g. `https://gitlab.example.com`, default: `https://gitlab.com`).
- `GITLAB_TOKEN`: Personal Access Token with `api` scope (automatically read from macOS Keychain if available).
- `GITLAB_PROJECT_ID`: Default numeric project ID when querying without `--project`.
- `PASEO_BIN`: Path to Paseo executable (default: `paseo`).
