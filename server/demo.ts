import type { AuthDeps } from "./auth";
import { accountFor } from "./auth";
import type { Fetch } from "./gitlab";

/**
 * A make-believe GitLab, served entirely from this file. Connect the plugin to
 * the demo host and every request is answered here instead of over the network:
 * no account, no token, no real project touched. It exists so the plugin's own
 * screens can be shown and screenshotted on invented data. All people, projects
 * and text below are fictional.
 */
export const DEMO_HOST = "https://demo.gitlab.local";

export function isDemoHost(host: string | null | undefined): boolean {
  return host === DEMO_HOST;
}

const PROJECT = "acme/webapp";

interface Person {
  username: string;
  name: string;
  avatarUrl: null;
}
const person = (username: string, name: string): Person => ({ username, name, avatarUrl: null });
const you = person("jordan.lee", "Jordan Lee");
const mira = person("mira.novak", "Mira Novak");
const sam = person("sam.oduya", "Sam Oduya");
const nadia = person("nadia.kaur", "Nadia Kaur");

const label = (title: string, color: string) => ({ title, color, textColor: "#ffffff" });
const labelWithId = (id: string, title: string, color: string) => ({ id, ...label(title, color) });
const BACKEND = label("backend", "#5a4ebd");
const BUG = label("bug", "#c0392b");
const ENHANCEMENT = label("enhancement", "#2d9d78");
const PRIORITY = label("priority::high", "#b8003b");
const FRONTEND = label("frontend", "#0b7285");

const nodes = <T>(items: T[]) => ({ nodes: items });
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

/** A row for the To-Do / Issues / MRs lists. */
function mrRow(row: {
  iid: string;
  title: string;
  hours: number;
  notes: number;
  status: string;
  mergeStatus?: string;
  draft?: boolean;
  author: Person;
  assignees: Person[];
  reviewers: Person[];
  labels: ReturnType<typeof label>[];
}) {
  return {
    iid: row.iid,
    title: row.title,
    webUrl: `${DEMO_HOST}/${PROJECT}/-/merge_requests/${row.iid}`,
    reference: `${PROJECT}!${row.iid}`,
    updatedAt: ago(row.hours),
    userNotesCount: row.notes,
    draft: row.draft ?? false,
    detailedMergeStatus: row.mergeStatus ?? "mergeable",
    headPipeline: { iid: `95${row.iid}`, status: row.status },
    author: row.author,
    assignees: nodes(row.assignees),
    reviewers: nodes(row.reviewers),
    labels: nodes(row.labels),
  };
}

function issueRow(row: {
  iid: string;
  title: string;
  hours: number;
  notes: number;
  author: Person;
  assignees: Person[];
  labels: ReturnType<typeof label>[];
}) {
  return {
    iid: row.iid,
    title: row.title,
    webUrl: `${DEMO_HOST}/${PROJECT}/-/issues/${row.iid}`,
    reference: `${PROJECT}#${row.iid}`,
    updatedAt: ago(row.hours),
    userNotesCount: row.notes,
    confidential: false,
    author: row.author,
    assignees: nodes(row.assignees),
    labels: nodes(row.labels),
  };
}

const MRS = {
  authored: [
    mrRow({
      iid: "128",
      title: "Add rate limiting to the public API",
      hours: 2,
      notes: 3,
      status: "SUCCESS",
      author: you,
      assignees: [you],
      reviewers: [mira],
      labels: [BACKEND, PRIORITY],
    }),
    mrRow({
      iid: "131",
      title: "Refactor auth token storage",
      hours: 5,
      notes: 1,
      status: "RUNNING",
      mergeStatus: "checking",
      draft: true,
      author: you,
      assignees: [you],
      reviewers: [sam],
      labels: [BACKEND],
    }),
    mrRow({
      iid: "126",
      title: "Fix flaky checkout test",
      hours: 26,
      notes: 4,
      status: "FAILED",
      mergeStatus: "conflict",
      author: you,
      assignees: [you],
      reviewers: [nadia],
      labels: [BUG],
    }),
  ],
  review: [
    mrRow({
      iid: "140",
      title: "Introduce dark mode design tokens",
      hours: 3,
      notes: 5,
      status: "SUCCESS",
      author: mira,
      assignees: [mira],
      reviewers: [you],
      labels: [FRONTEND],
    }),
  ],
};

const ISSUES = {
  assigned: [
    issueRow({
      iid: "88",
      title: "Search returns stale results after an edit",
      hours: 4,
      notes: 2,
      author: you,
      assignees: [you],
      labels: [BUG],
    }),
  ],
  authored: [
    issueRow({
      iid: "91",
      title: "Add keyboard shortcuts to the editor",
      hours: 20,
      notes: 0,
      author: you,
      assignees: [nadia],
      labels: [ENHANCEMENT],
    }),
  ],
};

const TODOS = [
  {
    id: "gid://gitlab/Todo/1",
    action: "review_requested",
    body: "Introduce dark mode design tokens",
    createdAt: ago(3),
    targetType: "MergeRequest",
    targetUrl: `${DEMO_HOST}/${PROJECT}/-/merge_requests/140`,
    author: mira,
    target: {
      webUrl: `${DEMO_HOST}/${PROJECT}/-/merge_requests/140`,
      iid: "140",
      title: "Introduce dark mode design tokens",
      reference: `${PROJECT}!140`,
    },
  },
  {
    id: "gid://gitlab/Todo/2",
    action: "assigned",
    body: "Search returns stale results after an edit",
    createdAt: ago(4),
    targetType: "Issue",
    targetUrl: `${DEMO_HOST}/${PROJECT}/-/issues/88`,
    author: sam,
    target: {
      webUrl: `${DEMO_HOST}/${PROJECT}/-/issues/88`,
      iid: "88",
      title: "Search returns stale results after an edit",
      reference: `${PROJECT}#88`,
    },
  },
];

const award = (name: string, emoji: string, people: Person[]) => ({
  nodes: people.map((user) => ({ name, emoji, user: { username: user.username } })),
});

function note(row: {
  id: string;
  author: Person;
  hours: number;
  bodyHtml: string;
  body?: string;
  system?: boolean;
  admin?: boolean;
  position?: { filePath: string; newLine: number | null; oldLine: number | null };
  reactions?: { name: string; emoji: string; people: Person[] }[];
  suggestions?: { id: string; applied: boolean }[];
}) {
  return {
    id: row.id,
    body: row.body ?? row.bodyHtml.replace(/<[^>]+>/g, ""),
    bodyHtml: row.bodyHtml,
    system: row.system ?? false,
    createdAt: ago(row.hours),
    author: row.author,
    userPermissions: { adminNote: row.admin ?? row.author.username === you.username },
    position: row.position ? { ...row.position, positionType: "text" } : null,
    awardEmoji: {
      nodes: (row.reactions ?? []).flatMap((r) =>
        r.people.map((user) => ({ name: r.name, emoji: r.emoji, user: { username: user.username } })),
      ),
    },
    suggestions: nodes(row.suggestions ?? []),
  };
}

const discussion = (
  id: string,
  notesList: ReturnType<typeof note>[],
  resolvable = false,
  resolved = false,
) => ({
  id,
  resolvable,
  resolved,
  notes: nodes(notesList),
});

/** A merge request's full detail, as the GraphQL detail query returns it. */
function mrDetail(iid: string) {
  const base = {
    id: `gid://gitlab/MergeRequest/${iid}`,
    iid,
    webUrl: `${DEMO_HOST}/${PROJECT}/-/merge_requests/${iid}`,
    reference: `${PROJECT}!${iid}`,
    createdAt: ago(48),
    userPermissions: { canEdit: true, canComment: true, canApprove: true, canMerge: true, canPush: true },
    diffRefs: { baseSha: "a1b2c3d4", headSha: "e5f6a7b8", startSha: "a1b2c3d4" },
    milestone: { title: "Sprint 24" },
    headPipeline: { iid: `95${iid}`, status: "SUCCESS" },
  };
  if (iid === "128") {
    return {
      ...base,
      title: "Add rate limiting to the public API",
      state: "opened",
      description:
        "Adds a token-bucket limiter in front of the public API.\n\n- 100 requests/minute per token\n- `429` with `Retry-After`\n- Metrics for rejected requests\n\nCloses #88.",
      descriptionHtml:
        "<p>Adds a token-bucket limiter in front of the public API.</p><ul><li>100 requests/minute per token</li><li><code>429</code> with <code>Retry-After</code></li><li>Metrics for rejected requests</li></ul><p>Closes #88.</p>",
      draft: false,
      sourceBranch: "128-rate-limiting",
      targetBranch: "main",
      detailedMergeStatus: "mergeable",
      approved: false,
      mergeable: true,
      conflicts: false,
      autoMergeEnabled: false,
      availableAutoMergeStrategies: ["merge_when_checks_pass"],
      shouldBeRebased: false,
      rebaseInProgress: false,
      approvedBy: nodes([]),
      awardEmoji: award("thumbsup", "👍", [mira]),
      author: you,
      assignees: nodes([you]),
      reviewers: nodes([mira]),
      labels: nodes([
        labelWithId("gid://gitlab/Label/1", "backend", "#5a4ebd"),
        labelWithId("gid://gitlab/Label/2", "priority::high", "#b8003b"),
      ]),
      discussions: nodes([
        discussion(
          "gid://gitlab/Discussion/a1",
          [
            note({
              id: "n1",
              author: mira,
              hours: 2,
              bodyHtml: "<p>Should the limit be configurable per plan rather than a constant?</p>",
              reactions: [{ name: "eyes", emoji: "👀", people: [you] }],
            }),
            note({
              id: "n2",
              author: you,
              hours: 1,
              bodyHtml: "<p>Good point — I'll read it from the plan settings in a follow-up.</p>",
            }),
          ],
          true,
          false,
        ),
        discussion(
          "gid://gitlab/Discussion/a2",
          [
            note({
              id: "n3",
              author: mira,
              hours: 2,
              bodyHtml: "<p>Nit: extract this into a helper so the header parsing is testable.</p>",
              position: { filePath: "src/api/rateLimit.ts", newLine: 12, oldLine: null },
              suggestions: [{ id: "gid://gitlab/Suggestion/1", applied: false }],
            }),
          ],
          true,
          false,
        ),
      ]),
    };
  }
  if (iid === "126") {
    return {
      ...base,
      title: "Fix flaky checkout test",
      state: "opened",
      description:
        "The checkout test races on the payment mock. This awaits the mock's readiness before asserting.",
      descriptionHtml:
        "<p>The checkout test races on the payment mock. This awaits the mock's readiness before asserting.</p>",
      draft: false,
      sourceBranch: "126-flaky-checkout",
      targetBranch: "main",
      detailedMergeStatus: "conflict",
      approved: false,
      mergeable: false,
      conflicts: true,
      autoMergeEnabled: false,
      availableAutoMergeStrategies: [],
      shouldBeRebased: false,
      rebaseInProgress: false,
      approvedBy: nodes([]),
      awardEmoji: award("", "", []),
      headPipeline: { iid: "95126", status: "FAILED" },
      author: you,
      assignees: nodes([you]),
      reviewers: nodes([nadia]),
      labels: nodes([labelWithId("gid://gitlab/Label/3", "bug", "#c0392b")]),
      discussions: nodes([
        discussion("gid://gitlab/Discussion/c1", [
          note({
            id: "n7",
            author: nadia,
            hours: 20,
            bodyHtml: "<p>There's a conflict with main after the checkout refactor landed.</p>",
          }),
        ]),
      ]),
    };
  }
  // 140: someone else's MR, awaiting your review.
  return {
    ...base,
    createdAt: ago(6),
    title: "Introduce dark mode design tokens",
    state: "opened",
    description: "Introduces semantic color tokens and a `data-theme` switch.",
    descriptionHtml: "<p>Introduces semantic color tokens and a <code>data-theme</code> switch.</p>",
    draft: false,
    sourceBranch: "140-dark-mode-tokens",
    targetBranch: "main",
    detailedMergeStatus: "mergeable",
    approved: false,
    mergeable: true,
    conflicts: false,
    autoMergeEnabled: false,
    availableAutoMergeStrategies: ["merge_when_checks_pass"],
    shouldBeRebased: false,
    rebaseInProgress: false,
    approvedBy: nodes([]),
    awardEmoji: award("rocket", "🚀", [sam, you]),
    author: mira,
    assignees: nodes([mira]),
    reviewers: nodes([you]),
    labels: nodes([labelWithId("gid://gitlab/Label/4", "frontend", "#0b7285")]),
    diffRefs: { baseSha: "11aa22bb", headSha: "33cc44dd", startSha: "11aa22bb" },
    discussions: nodes([
      discussion(
        "gid://gitlab/Discussion/d1",
        [
          note({
            id: "n9",
            author: sam,
            hours: 4,
            bodyHtml: "<p>Love this. Can we keep the old variable names as aliases for one release?</p>",
            reactions: [{ name: "thumbsup", emoji: "👍", people: [mira, you] }],
          }),
        ],
        true,
        false,
      ),
    ]),
  };
}

function issueDetail(iid: string) {
  const common = {
    id: `gid://gitlab/Issue/${iid}`,
    iid,
    state: "opened",
    webUrl: `${DEMO_HOST}/${PROJECT}/-/issues/${iid}`,
    reference: `${PROJECT}#${iid}`,
    createdAt: ago(30),
    confidential: false,
    userPermissions: { canEdit: true, canComment: true },
    milestone: { title: "Sprint 24" },
  };
  if (iid === "88") {
    return {
      ...common,
      title: "Search returns stale results after an edit",
      description:
        "Editing an item and searching again shows the pre-edit text until a hard refresh. The result cache is not invalidated on save.",
      descriptionHtml:
        "<p>Editing an item and searching again shows the pre-edit text until a hard refresh. The result cache is not invalidated on save.</p>",
      author: you,
      assignees: nodes([you]),
      labels: nodes([labelWithId("gid://gitlab/Label/3", "bug", "#c0392b")]),
      awardEmoji: award("", "", []),
      discussions: nodes([
        discussion("gid://gitlab/Discussion/i1", [
          note({
            id: "n11",
            author: sam,
            hours: 3,
            bodyHtml: "<p>Reproduced. The cache key omits the updatedAt, so a save doesn't bust it.</p>",
            reactions: [{ name: "thumbsup", emoji: "👍", people: [you] }],
          }),
        ]),
      ]),
    };
  }
  return {
    ...common,
    title: "Add keyboard shortcuts to the editor",
    description: "Add `Cmd+B`, `Cmd+I` and `Cmd+K` for bold, italic and links.",
    descriptionHtml:
      "<p>Add <code>Cmd+B</code>, <code>Cmd+I</code> and <code>Cmd+K</code> for bold, italic and links.</p>",
    author: you,
    assignees: nodes([nadia]),
    labels: nodes([labelWithId("gid://gitlab/Label/5", "enhancement", "#2d9d78")]),
    awardEmoji: award("", "", []),
    discussions: nodes([]),
  };
}

/** A file's changes as GitLab's REST diff returns them. */
const DIFFS: Record<
  string,
  {
    old_path: string;
    new_path: string;
    new_file: boolean;
    renamed_file: boolean;
    deleted_file: boolean;
    diff: string;
  }[]
> = {
  "128": [
    {
      old_path: "src/api/rateLimit.ts",
      new_path: "src/api/rateLimit.ts",
      new_file: true,
      renamed_file: false,
      deleted_file: false,
      diff: '@@ -0,0 +1,24 @@\n+import { Redis } from "../store/redis";\n+\n+const WINDOW_MS = 60_000;\n+const MAX_REQUESTS = 100;\n+\n+export interface RateLimitResult {\n+  allowed: boolean;\n+  retryAfter: number;\n+}\n+\n+export async function rateLimit(redis: Redis, token: string): Promise<RateLimitResult> {\n+  const key = `rl:${token}`;\n+  const count = await redis.incr(key);\n+  if (count === 1) {\n+    await redis.pexpire(key, WINDOW_MS);\n+  }\n+  if (count > MAX_REQUESTS) {\n+    const ttl = await redis.pttl(key);\n+    return { allowed: false, retryAfter: Math.ceil(ttl / 1000) };\n+  }\n+  return { allowed: true, retryAfter: 0 };\n+}\n',
    },
    {
      old_path: "src/api/server.ts",
      new_path: "src/api/server.ts",
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      diff: '@@ -1,6 +1,8 @@\n import express from "express";\n+import { rateLimit } from "./rateLimit";\n import { authenticate } from "./auth";\n \n const app = express();\n+const redis = createRedis();\n \n app.use(authenticate);\n@@ -12,6 +14,15 @@ app.get("/health", (_req, res) => {\n   res.json({ ok: true });\n });\n \n+app.use(async (req, res, next) => {\n+  const result = await rateLimit(redis, req.token);\n+  if (!result.allowed) {\n+    res.setHeader("Retry-After", String(result.retryAfter));\n+    res.status(429).json({ error: "rate_limited" });\n+    return;\n+  }\n+  next();\n+});\n+\n export { app };\n',
    },
  ],
  "140": [
    {
      old_path: "src/styles/tokens.css",
      new_path: "src/styles/tokens.css",
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      diff: '@@ -1,5 +1,12 @@\n :root {\n-  --bg: #ffffff;\n-  --fg: #111111;\n+  --color-bg: #ffffff;\n+  --color-fg: #111111;\n+}\n+\n+[data-theme="dark"] {\n+  --color-bg: #0d1117;\n+  --color-fg: #e6edf3;\n }\n',
    },
  ],
};

const RAW_FILES: Record<string, string> = {
  "src/api/server.ts":
    'import express from "express";\nimport { rateLimit } from "./rateLimit";\nimport { authenticate } from "./auth";\n\nconst app = express();\nconst redis = createRedis();\n\napp.use(authenticate);\n\napp.get("/version", (_req, res) => {\n  res.json({ version: process.env.VERSION });\n});\n\napp.get("/health", (_req, res) => {\n  res.json({ ok: true });\n});\n\napp.use(async (req, res, next) => {\n  const result = await rateLimit(redis, req.token);\n  if (!result.allowed) {\n    res.setHeader("Retry-After", String(result.retryAfter));\n    res.status(429).json({ error: "rate_limited" });\n    return;\n  }\n  next();\n});\n\nexport { app };\n',
  "README.md":
    "# Acme Webapp\n\nA small example service used to demo the GitLab panel.\n\n## Run\n\n    pnpm install\n    pnpm dev\n",
};

const TREE: Record<string, { name: string; path: string; type: "tree" | "blob" }[]> = {
  "": [
    { name: "src", path: "src", type: "tree" },
    { name: "test", path: "test", type: "tree" },
    { name: ".gitlab-ci.yml", path: ".gitlab-ci.yml", type: "blob" },
    { name: "README.md", path: "README.md", type: "blob" },
    { name: "package.json", path: "package.json", type: "blob" },
  ],
  src: [
    { name: "api", path: "src/api", type: "tree" },
    { name: "styles", path: "src/styles", type: "tree" },
    { name: "index.ts", path: "src/index.ts", type: "blob" },
  ],
  "src/api": [
    { name: "auth.ts", path: "src/api/auth.ts", type: "blob" },
    { name: "rateLimit.ts", path: "src/api/rateLimit.ts", type: "blob" },
    { name: "server.ts", path: "src/api/server.ts", type: "blob" },
  ],
};

const commit = (sha: string, title: string, author: Person, hours: number) => ({
  id: sha,
  short_id: sha.slice(0, 8),
  parent_ids: ["00000000ffffffff"],
  title,
  author_name: author.name,
  created_at: ago(hours),
  web_url: `${DEMO_HOST}/${PROJECT}/-/commit/${sha}`,
});

const COMMITS = [
  commit("e5f6a7b8c9d0e1f2", "Add rate limiting to the public API", you, 2),
  commit("d0e1f2a3b4c5d6e7", "Extract header parsing into a helper", you, 3),
  commit("c9d0e1f2a3b4c5d6", "Add token-bucket limiter", you, 5),
  commit("b4c5d6e7f8a9b0c1", "Wire Redis into the API server", you, 8),
];

const BRANCHES = [
  {
    name: "main",
    default: true,
    protected: true,
    merged: false,
    can_push: true,
    sha: "aa11bb22cc33",
    title: "Merge branch '140-dark-mode-tokens'",
    author: mira,
    hours: 3,
  },
  {
    name: "128-rate-limiting",
    default: false,
    protected: false,
    merged: false,
    can_push: true,
    sha: "e5f6a7b8c9d0",
    title: "Add rate limiting to the public API",
    author: you,
    hours: 2,
  },
  {
    name: "131-auth-token-storage",
    default: false,
    protected: false,
    merged: false,
    can_push: true,
    sha: "77aa88bb99cc",
    title: "Refactor auth token storage",
    author: you,
    hours: 5,
  },
  {
    name: "126-flaky-checkout",
    default: false,
    protected: false,
    merged: false,
    can_push: true,
    sha: "33dd44ee55ff",
    title: "Fix flaky checkout test",
    author: you,
    hours: 26,
  },
].map((b) => ({
  name: b.name,
  default: b.default,
  protected: b.protected,
  merged: b.merged,
  can_push: b.can_push,
  web_url: `${DEMO_HOST}/${PROJECT}/-/tree/${b.name}`,
  commit: commit(b.sha, b.title, b.author, b.hours),
}));

const job = (
  id: string,
  name: string,
  status: string,
  opts: {
    stage: string;
    duration?: number;
    allowFailure?: boolean;
    manual?: boolean;
    retryable?: boolean;
    playable?: boolean;
  },
) => ({
  id: `gid://gitlab/Ci::Build/${id}`,
  name,
  status,
  duration: opts.duration ?? null,
  startedAt: ago(2),
  allowFailure: opts.allowFailure ?? false,
  manualJob: opts.manual ?? false,
  retryable: opts.retryable ?? (status === "FAILED" || status === "SUCCESS"),
  cancelable: status === "RUNNING",
  playable: opts.playable ?? false,
  webPath: `/${PROJECT}/-/jobs/${id}`,
  artifacts: nodes(
    status === "SUCCESS" && opts.stage === "test"
      ? [
          {
            name: "coverage",
            fileType: "ARCHIVE",
            size: 40213,
            downloadPath: `/${PROJECT}/-/jobs/${id}/artifacts/download`,
          },
        ]
      : [],
  ),
  downstreamPipeline: null,
});

function pipeline(iid: string) {
  const failed = iid === "95126";
  const running = iid === "95131";
  const status = failed ? "FAILED" : running ? "RUNNING" : "SUCCESS";
  return {
    project: {
      pipeline: {
        id: `gid://gitlab/Ci::Pipeline/${iid}`,
        iid,
        status,
        ref:
          iid === "95126"
            ? "126-flaky-checkout"
            : iid === "95131"
              ? "131-auth-token-storage"
              : "128-rate-limiting",
        sha: "e5f6a7b8c9d0e1f2",
        duration: failed ? 214 : running ? null : 372,
        createdAt: ago(2),
        finishedAt: running ? null : ago(1),
        path: `/${PROJECT}/-/pipelines/${iid}`,
        retryable: failed,
        cancelable: running,
        user: you,
        detailedStatus: { label: status.toLowerCase() },
        stages: nodes([
          {
            name: "build",
            status: "SUCCESS",
            jobs: nodes([
              job("7001", "compile", "SUCCESS", { stage: "build", duration: 46 }),
              job("7002", "lint", "SUCCESS", { stage: "build", duration: 22 }),
            ]),
          },
          {
            name: "test",
            status: failed ? "FAILED" : running ? "RUNNING" : "SUCCESS",
            jobs: nodes([
              job("7003", "unit", failed ? "FAILED" : running ? "RUNNING" : "SUCCESS", {
                stage: "test",
                duration: failed ? 118 : 140,
                retryable: true,
              }),
              job("7004", "integration", running ? "CREATED" : "SUCCESS", { stage: "test", duration: 96 }),
            ]),
          },
          {
            name: "deploy",
            status: "MANUAL",
            jobs: nodes([
              job("7005", "deploy:staging", "MANUAL", { stage: "deploy", manual: true, playable: true }),
            ]),
          },
        ]),
      },
    },
  };
}

const JOB_TRACE =
  '\u001b[0KRunning with gitlab-runner 17.4.0\n\u001b[0K\u001b[32;1mPreparing the "docker" executor\u001b[0;m\n$ pnpm test\n\n  api/rateLimit\n    \u001b[32m✓\u001b[0m rejects over the limit (7 ms)\n    \u001b[32m✓\u001b[0m sets Retry-After (3 ms)\n  api/checkout\n    \u001b[31m✗\u001b[0m completes a paid order (1200 ms)\n\n  \u001b[31m● api/checkout › completes a paid order\u001b[0m\n\n    Timeout waiting for payment mock to be ready.\n\n      at Object.<anonymous> (test/checkout.test.ts:42:11)\n\n\u001b[31;1mTests: 1 failed, 2 passed, 3 total\u001b[0;m\n\u001b[0K\u001b[31;1mERROR: Job failed: exit code 1\u001b[0;m\n';

function graphqlData(query: string, variables: Record<string, unknown>): unknown {
  const name = query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "";
  const iid = String(variables.iid ?? "");
  switch (name) {
    case "PaseoGitLabMyMergeRequests":
      return {
        currentUser: {
          authoredMergeRequests: nodes(MRS.authored),
          assignedMergeRequests: nodes(MRS.authored),
        },
      };
    case "PaseoGitLabReviewAndTodos":
      return { currentUser: { reviewRequestedMergeRequests: nodes(MRS.review), todos: nodes(TODOS) } };
    case "PaseoGitLabMyIssues":
      return { assignedIssues: nodes(ISSUES.assigned), authoredIssues: nodes(ISSUES.authored) };
    case "PaseoGitLabMergeRequest":
      return { project: { mergeRequest: mrDetail(iid) } };
    case "PaseoGitLabIssue":
      return { project: { issue: issueDetail(iid) } };
    case "PaseoGitLabPipeline":
      return pipeline(String(variables.iid ?? "95128"));
    case "PaseoGitLabWorkspace":
      return { project: { repository: { rootRef: "main" }, mergeRequests: nodes([]) } };
    case "PaseoGitLabSearchUsers":
      return { project: { autocompleteUsers: [you, mira, sam, nadia] } };
    case "PaseoGitLabSearchLabels":
      return {
        project: {
          labels: nodes([
            labelWithId("gid://gitlab/Label/1", "backend", "#5a4ebd"),
            labelWithId("gid://gitlab/Label/3", "bug", "#c0392b"),
            labelWithId("gid://gitlab/Label/5", "enhancement", "#2d9d78"),
          ]),
        },
      };
    case "PaseoGitLabSearchItems":
      return {
        issues: nodes(ISSUES.assigned.map((i) => ({ iid: i.iid, reference: i.reference }))),
        project: { mergeRequests: nodes(MRS.authored.map((m) => ({ iid: m.iid, reference: m.reference }))) },
      };
    case "PaseoGitLabIssueRefs":
      return {
        project: {
          issues: nodes(
            [...ISSUES.assigned, ...ISSUES.authored].map((i) => ({ iid: i.iid, title: i.title })),
          ),
        },
      };
    case "PaseoGitLabMergeRequestRefs":
      return {
        project: {
          mergeRequests: nodes([...MRS.authored, ...MRS.review].map((m) => ({ iid: m.iid, title: m.title }))),
        },
      };
    case "PaseoGitLabSearchIssues":
      return { project: { issues: nodes([...ISSUES.assigned, ...ISSUES.authored]) } };
    case "PaseoGitLabSearchMergeRequests":
      return { project: { mergeRequests: nodes([...MRS.authored, ...MRS.review]) } };
    case "PaseoGitLabToggleResolve":
      return {
        discussionToggleResolve: { discussion: { resolved: Boolean(variables.resolve) }, errors: [] },
      };
    case "PaseoGitLabCreateNote":
    case "PaseoGitLabCreateDiscussion":
    case "PaseoGitLabCreateDiffNote":
      return { [operationField(name)]: { note: { id: "gid://gitlab/Note/new" }, errors: [] } };
    case "PaseoGitLabCreateIssue":
      return { createIssue: { issue: { iid: "92" }, errors: [] } };
    case "PaseoGitLabCreateMergeRequest":
      return { mergeRequestCreate: { mergeRequest: { iid: "141" }, errors: [] } };
    default:
      // Every other mutation reports success through its payload's `errors`.
      return { [operationField(name)]: { errors: [] } };
  }
}

/** The mutation's payload field, e.g. PaseoGitLabUpdateIssue → updateIssue. */
function operationField(name: string): string {
  const base = name.replace(/^PaseoGitLab/, "");
  const map: Record<string, string> = {
    UpdateIssue: "updateIssue",
    UpdateMergeRequest: "mergeRequestUpdate",
    SetDraft: "mergeRequestSetDraft",
    SetMergeRequestLabels: "mergeRequestSetLabels",
    IssueAssignees: "issueSetAssignees",
    MergeRequestAssignees: "mergeRequestSetAssignees",
    MergeRequestReviewers: "mergeRequestSetReviewers",
    TodoDone: "todoMarkDone",
    DestroyNote: "destroyNote",
    UpdateNote: "updateNote",
    CreateNote: "createNote",
    CreateDiscussion: "createDiscussion",
    CreateDiffNote: "createDiffNote",
    JobRetry: "jobRetry",
    JobPlay: "jobPlay",
    JobCancel: "jobCancel",
    PipelineRetry: "pipelineRetry",
    PipelineCancel: "pipelineCancel",
    RunPipeline: "pipelineCreate",
    Merge: "mergeRequestAccept",
    ToggleReaction: "awardEmojiToggle",
  };
  return map[base] ?? base.charAt(0).toLowerCase() + base.slice(1);
}

const okJson = (body: unknown) => Response.json(body);

function restResponse(pathname: string, search: URLSearchParams): Response {
  // /api/v4/<rest>
  const rest = pathname.replace(/^\/api\/v4/, "");
  if (rest === "/user") {
    return okJson({ username: you.username, name: you.name });
  }
  if (rest === "/personal_access_tokens/self") {
    return okJson({ name: "paseo-demo", scopes: ["api"], expires_at: null, active: true });
  }
  const mrDiffs = rest.match(/\/merge_requests\/(\d+)\/diffs$/);
  if (mrDiffs) {
    return okJson(DIFFS[mrDiffs[1]!] ?? []);
  }
  if (/\/merge_requests\/\d+\/versions$/.test(rest)) {
    return okJson([
      {
        id: 2,
        head_commit_sha: "e5f6a7b8c9d0e1f2",
        base_commit_sha: "a1b2c3d4",
        start_commit_sha: "a1b2c3d4",
        created_at: ago(2),
      },
      {
        id: 1,
        head_commit_sha: "c9d0e1f2a3b4c5d6",
        base_commit_sha: "a1b2c3d4",
        start_commit_sha: "a1b2c3d4",
        created_at: ago(6),
      },
    ]);
  }
  if (/\/merge_requests\/\d+\/commits$/.test(rest)) {
    return okJson(COMMITS);
  }
  if (/\/draft_notes/.test(rest)) {
    return okJson([]);
  }
  if (/\/repository\/tree$/.test(rest)) {
    return okJson(TREE[search.get("path") ?? ""] ?? []);
  }
  if (/\/repository\/branches$/.test(rest)) {
    const term = search.get("search")?.toLowerCase();
    return okJson(term ? BRANCHES.filter((b) => b.name.toLowerCase().includes(term)) : BRANCHES);
  }
  if (/\/repository\/commits$/.test(rest)) {
    return okJson(COMMITS);
  }
  if (/\/repository\/compare$/.test(rest)) {
    return okJson({ commits: COMMITS.slice(0, 2), diffs: DIFFS["128"] });
  }
  const raw = rest.match(/\/repository\/files\/(.+)\/raw$/);
  if (raw) {
    return new Response(RAW_FILES[decodeURIComponent(raw[1]!)] ?? "// This file has no demo content.\n", {
      headers: { "content-type": "text/plain" },
    });
  }
  if (/\/repository\/commits\/[^/]+\/diff$/.test(rest)) {
    return okJson(DIFFS["128"]);
  }
  if (/\/jobs\/[^/]+\/trace$/.test(rest)) {
    return new Response(JOB_TRACE, { headers: { "content-type": "text/plain" } });
  }
  if (/^\/projects\/[^/]+$/.test(rest)) {
    return okJson({ default_branch: "main" });
  }
  // A project path with no sub-resource we serve: an empty object keeps callers happy.
  return okJson({});
}

/** A fetch that answers only for the demo host, from the fixtures above. */
export const demoFetch: Fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  if (url.pathname === "/api/graphql") {
    const body = JSON.parse((init?.body as string) ?? "{}") as {
      query: string;
      variables?: Record<string, unknown>;
    };
    return okJson({ data: graphqlData(body.query, body.variables ?? {}) });
  }
  if (url.pathname === "/api/v4/markdown") {
    const body = JSON.parse((init?.body as string) ?? "{}") as { text?: string };
    return okJson({ html: `<p>${(body.text ?? "").replace(/[<>&]/g, "")}</p>` });
  }
  if (/\/uploads$/.test(url.pathname)) {
    return okJson({ markdown: "![upload](/uploads/demo/file.png)", url: "/uploads/demo/file.png" });
  }
  return restResponse(url.pathname, url.searchParams);
}) as unknown as Fetch;

const DEMO_ACCOUNT = accountFor(DEMO_HOST);

/**
 * Deps that serve the demo host from fixtures and leave every other GitLab to the
 * real network and Keychain. The demo token is a constant that never leaves here.
 */
export function withDemo(deps: AuthDeps): AuthDeps {
  return {
    ...deps,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input.toString();
      return href.startsWith(DEMO_HOST) ? demoFetch(input, init) : deps.fetch(input, init);
    }) as unknown as Fetch,
    secrets: {
      read: (account) =>
        account === DEMO_ACCOUNT ? Promise.resolve("demo-token") : deps.secrets.read(account),
      write: (account, secret) =>
        account === DEMO_ACCOUNT ? Promise.resolve() : deps.secrets.write(account, secret),
      remove: (account) => (account === DEMO_ACCOUNT ? Promise.resolve() : deps.secrets.remove(account)),
    },
  };
}
