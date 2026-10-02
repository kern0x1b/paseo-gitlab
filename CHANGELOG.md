# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `gitlab snapshot`: pending to-dos, open merge requests you author, review or are assigned to (with pipeline, merge status and approvals), and assigned issues as one `paseo-fleet/v1` document for `fleet sweep`.

## [1.1.0] - 2026-10-02

### Added

- Support for the **Paseo Fleet Protocol v1** (`paseo-fleet/v1`) event envelope.
- Multi-instance disambiguation with `instance` (`host`), `scope` (`projectPath`), and fully qualified `urn:gitlab:<host>:<project>:<type>:<id>`.
- Deterministic `reply_action` mapping directly to `gitlab_create_mr_note` or `gitlab_create_issue_note` with project and item coordinates.

## [1.0.0] - 2026-09-25

### Added

- Standalone CLI (`gitlab` / `paseo-gitlab`): inspect MRs, issues, todos, pipelines, manage subscriptions, daemon, and MCP server
- Background event router daemon (`gitlab daemon`): real-time event polling, working-hours gating, and direct push delivery to Paseo agents via `paseo send`
- Fleet subscription registry (`src/subscriptions.js`): specificity-based routing (MR, issue, branch ref, event type, author) with coordinator fallback
- Daemon health monitor (`src/health.js`): streak-based failure detection, alert delivery to coordinator agent, threshold gating, and recovery notifications
- Stdio Model Context Protocol (MCP) server (`gitlab mcp`): exposes GitLab tools, todos, MR/issue notes, pipelines, and daemon subscription controls to AI agents
- Issue board panel: board switcher with create, rename, and delete; drag-and-drop cards between and within columns; column add/remove; create issue in column; author and milestone filters
- Tabs in main area for Issues and MRs: open items in persistent workspace tabs
- Label filter on Issues, MRs, and Review tabs with persistent choices per tab

## [0.1.0] - 2026-09-23

### Added

- The GitLab panel in the explorer sidebar: **To-Do**, **Issues**, **MRs**, **Review** and
  **Search** tabs, each with a count, a role filter (Assigned / Created / All), and a header
  button whose badge counts what is waiting on you
- Issue and merge-request detail rendered from GitLab's own HTML: edit title, description,
  assignees, reviewers and labels; close/reopen and toggle draft; threads with reply, resolve,
  edit/delete of your own notes, emoji reactions, and applying suggestions; Comment vs Start thread
- Merge-request review in the main area: a resizable, collapsible file tree; syntax-highlighted
  diff with wrap toggle, side-by-side, hide-whitespace, and expandable context; **Viewed** per
  file (remembered by a fingerprint of the diff); scopes for the whole MR, since your last review,
  a push, or a single commit; keyboard navigation (`j`/`k`/`v`/`s`/`w`/`x`/`t`)
- Line and range comments that stack into a local review, then **Submit your review** to one of the
  workspace's agents (as a single message) or to GitLab (drafts published together, optionally with
  an approval); or ask an agent about a line immediately
- Merge controls behind confirmations: approve/revoke, merge, merge-when-checks-pass, cancel
  auto-merge, and rebase; a conflict badge with **Resolve with agent**
- Pipelines and jobs: stages, job status and logs, retry/play/cancel, run a pipeline, artifacts,
  full log, and sending a failed job to an agent with its log
- Repository browser: file tree at any ref with a syntax-highlighted viewer, commit history with
  per-commit diffs, and branches with ahead/behind counts, compare, create-MR, create and delete
- Send any issue, MR or failed job to a Paseo agent; a `@GitLab` attachment source for composers
- Several GitLab accounts, each with its own keychain token; a workspace uses the GitLab its
  `origin` points at, with a per-workspace switcher and isolated per-account caches
- A built-in demo backend (`https://demo.gitlab.local`) that serves fictional data with no
  account, no token, and no network

### Security

- The token is verified, stored in the OS keychain (written through stdin, one item per host), and
  never returned to the client; https-only hosts; server-side image proxy limited to the connected
  host with magic-byte sniffing and no inline SVG; GitLab HTML sanitised against an allowlist

[Unreleased]: https://github.com/kern0x1b/paseo-gitlab/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kern0x1b/paseo-gitlab/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/kern0x1b/paseo-gitlab/releases/tag/v0.1.0
