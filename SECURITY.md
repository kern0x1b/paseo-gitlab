# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities in this plugin to
**157722763+kern0x1b@users.noreply.github.com**. Do not open a public issue.

Include whatever you have: the plugin version (or commit) and your Paseo version, steps to
reproduce, and the impact you believe the issue has. A minimal reproduction — ideally against
demo mode (`https://demo.gitlab.local`, no real account) — is the most useful thing you can send.

You can also use
[GitHub Security Advisories](https://github.com/kern0x1b/paseo-gitlab/security/advisories/new).

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement of your report | 3 business days |
| Initial assessment and severity | 10 business days |
| Fix released, or a dated plan if the fix takes longer | 90 days |

You will be told when the fix ships. If you want credit in the release notes, say so in your
report; reports are otherwise handled without attribution.

We ask that you give us 90 days before disclosing publicly, and we will not ask you to sign an NDA
or to stay silent indefinitely. If a vulnerability is being actively exploited, we will move faster
and coordinate the announcement with you.

## Safe harbour

We will not pursue or support legal action against anyone who, in good faith, discovers and
reports a vulnerability under this policy — provided you:

- test only against your own installation, your own token, and GitLab projects you control;
- do not access, modify, or exfiltrate data belonging to anyone else;
- do not degrade the service of any third party, including any GitLab instance you do not own;
- give us reasonable time to respond before disclosing.

If you are unsure whether something is in scope, ask before testing.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
| < 0.1   | No        |

Fixes ship in the current release line only.

## Scope

In scope:

- storage and handling of the GitLab personal access token (the OS keychain path and the
  server-side connection);
- the sanitiser for GitLab-rendered note and description HTML;
- the server-side image proxy (avatars and uploaded attachments) and its host allowlist;
- parsing of untrusted GitLab responses (diffs, job logs, uploads) before they reach the UI;
- the demo backend, if it can be reached for a host that is not the demo host.

Out of scope:

- vulnerabilities in Paseo itself, or in the `@getpaseo/plugin` SDK — report those to
  [Paseo](https://getpaseo.com);
- vulnerabilities in GitLab — report those to
  [GitLab](https://about.gitlab.com/security/disclosure/);
- findings that require an attacker to already have local code execution as the user, or read
  access to the OS keychain;
- issues in a GitLab instance you connect to.

## Design notes

The token is verified against GitLab, then stored in the OS keychain (on macOS via `security`,
one item per host), written through stdin rather than argv, and never returned to the plugin's
client side. Only **https** hosts are accepted, because the token travels in every request.
Avatars and uploaded images are fetched server-side and only from the connected host; images are
identified by their magic bytes and SVG is never inlined. Note and description HTML is sanitised
against an allowlist. The demo backend answers only for the host `https://demo.gitlab.local` and
makes no network calls.
