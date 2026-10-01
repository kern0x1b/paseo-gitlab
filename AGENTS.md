# AGENTS.md

Guidance for automated agents and new contributors working in this repository. It
describes what the plugin is, how it is laid out, the invariants that must hold, and
the exact commands to verify a change.

## What this is

A [Paseo](https://getpaseo.com) plugin that puts GitLab — to-dos, issues, merge
requests, review, pipelines, the repository, and issue boards — inside the editor, talking to GitLab's
API directly with a personal access token. It also includes a standalone CLI (`gitlab`), real-time
event router daemon (`gitlab daemon`), and stdio Model Context Protocol (MCP) server for AI fleets.
See [README.md](README.md) for the user-facing feature tour.

## Layout

| Path                   | Holds                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/contract.ts`   | Every Zod schema and `defineRpc` definition. The single source of truth for the shapes crossing the server/client boundary.                                                                                                                                                                                                                                                             |
| `server/`              | Runs on the server side only. `auth.ts`, `secrets.ts` (keychain), `state.ts` (which hosts, active account, per-request account), `gitlab.ts` (`rest`/`graphql`/`restWrite`), `queries.ts` (GraphQL text + `Raw*` types + mappers to the contract), `diff.ts`, `log.ts`, `images.ts`, `workspace.ts`, `agent-context.ts`, `handlers.ts` (the RPC handlers), `demo.ts` (the fake GitLab). |
| `client/`              | React Native UI. `account.tsx` (per-account query cache + the `useRpc` wrapper), `plugin-client.ts`, `header-buttons.ts`, stores (`diff-target`, `review-store`, `viewed-store`), and `client/ui/*` for every screen.                                                                                                                                                                   |
| `src/`                 | Standalone CLI, daemon, and MCP tools (`config.js`, `daemon.js`, `dispatcher.js`, `gitlab-client.js`, `health.js`, `mcp.js`, `subscriptions.js`).                                                                                                                                                                                                                                       |
| `bin/`                 | Executable CLI entrypoint `bin/gitlab.js`.                                                                                                                                                                                                                                                                                                                                              |
| `index.server.ts`      | Registers each RPC handler; wraps them so a request runs as the account it names.                                                                                                                                                                                                                                                                                                       |
| `index.client.tsx`     | Registers panels, the header button, settings, command-center items and the `@GitLab` attachment source.                                                                                                                                                                                                                                                                                |
| `test/` & `test-node/` | `node --test` suites (plugin RPCs in TypeScript and daemon/health in JavaScript).                                                                                                                                                                                                                                                                                                       |

## Commands

Run from the repo root. There is no build step — the plugin ships as source.

```bash
npm run typecheck    # tsc --noEmit; must pass
npm test             # node --test; must pass, and must not touch the network
paseo plugin reload gitlab   # load your changes into a running Paseo
```

A change is not done until `typecheck` and `test` both pass. When a change is
visual, reload the plugin and confirm in Paseo before claiming it works.

## Conventions

- **Node strip-only TypeScript.** Types are erased, not compiled: no `enum`, no
  constructor **parameter properties**, no `namespace`. Write a plain field and
  assign it in the constructor body.
- **Prettier**, `printWidth` 110 (`.prettierrc.json`). Run it on files you touch.
- **Conventional Commits**, subject lowercased, ≤ 100 chars. Enforced by
  `.githooks/commit-msg` (installed via `npm install`'s `prepare`).
- **Comments explain why, not what**, and only where the reason is not obvious from
  the code. Match the density of the surrounding file.
- **English everywhere** in code, comments and commits.
- Prefer small, surgical changes; do not reformat or refactor code you are not
  changing.

## Adding or changing an RPC

1. Define the schema and `defineRpc` in `shared/contract.ts`. Every RPC input
   carries an optional `account` automatically — do not add it by hand.
2. Implement it in `server/handlers.ts` (add REST/GraphQL text to `queries.ts` or a
   helper module as needed) and register it in `index.server.ts` via the local
   `handle` wrapper, never `server.handle` directly — the wrapper is what runs the
   request as the chosen account.
3. Call it from the client with `useRpc` **imported from `../account`**, not from
   `@getpaseo/plugin/client`. That wrapper adds the panel's account to the call.
4. If the new RPC returns data demo mode should show, extend `server/demo.ts`.
5. Add a test.

## Invariants — do not break these

- **The token stays on the server.** It lives in the keychain and in
  `server/auth.ts`/`secrets.ts`; it must never be returned to the client or logged.
- **https only** for hosts (`normalizeHost`).
- **Validate every response.** RPC outputs are parsed against their Zod schema;
  keep new handlers returning contract-shaped data.
- **Tests never hit the network.** Fake GitLab at the `fetch` boundary (see the
  recording/fake helpers in `test/`), or exercise pure functions directly. The demo
  backend (`server/demo.ts`) is the same idea and can be reused.
- **Per-account isolation.** Data for one GitLab must not leak into another: keep
  using the account-scoped `useRpc` and the per-account query cache in
  `client/account.tsx`.
- **Writes in tests target nothing real** — non-existent ids or a fake endpoint.

## The demo backend

`server/demo.ts` answers every request for the host `https://demo.gitlab.local`
from an in-memory fixture, so the whole UI can run with no account. All of its data
is fictional. When you add a feature, add matching demo data so it can be shown and
screenshotted without a real project. Keep the fixture free of any real names,
hosts or tokens.

## No personal data

This repository is public-facing. Never commit real usernames, company hostnames,
tokens, absolute local paths, or screenshots that show a real account or private
work. Screenshots live in `docs/screenshots/` and must use demo mode; blur anything
incidental.
