# Contributing

Thanks for your interest in improving the GitLab plugin for Paseo.

## Development setup

```bash
npm install          # dev-time types and the commit-msg hook; nothing ships to the client
npm run typecheck    # tsc --noEmit
npm test             # node --test; runs offline
paseo plugin add ./paseo-gitlab      # load it into Paseo
paseo plugin reload gitlab           # pick up changes
```

You do not need a GitLab account to work on most of the UI: connect to the host
`https://demo.gitlab.local` with any token and the plugin serves a built-in
fixture (see [`server/demo.ts`](server/demo.ts)).

## Before you open a pull request

- `npm run typecheck` and `npm test` both pass.
- New behaviour has a test. Tests must not touch the network — fake GitLab at the
  `fetch` boundary, as the existing suites do.
- Run Prettier on the files you touched (`printWidth` 110).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/);
  the `.githooks/commit-msg` hook enforces it.

## Conventions and invariants

[AGENTS.md](AGENTS.md) is the source of truth for repository layout, how to add an
RPC, and the security invariants that must hold (the token never leaves the server,
https-only hosts, every response validated, per-account isolation). Please read it
before a non-trivial change.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, and what happened.
Never paste a real token, private URL or internal hostname into an issue.
