import { execFile } from "node:child_process";

/**
 * Which GitLab project and branch a Paseo workspace is on, read from its checkout.
 * Only the configured GitLab host counts: a workspace pushing to GitHub has no MR here.
 */
const GIT_TIMEOUT_MS = 5000;

export type GitRunner = (directory: string, args: string[]) => Promise<string | null>;

export const runGit: GitRunner = (directory, args) =>
  new Promise((done) => {
    execFile("git", ["-C", directory, ...args], { timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      done(error ? null : stdout.trim() || null);
    });
  });

/**
 * `git@host:group/project.git`, `ssh://git@host:2222/group/project.git` or
 * `https://host/group/project.git` → host name and project path.
 */
export function parseRemote(remote: string): { hostname: string; path: string } | null {
  const scp = remote.match(/^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/);
  if (scp) {
    return { hostname: scp[1]!.toLowerCase(), path: scp[2]! };
  }
  try {
    const url = new URL(remote);
    const path = url.pathname.replace(/^\/+/, "").replace(/\.git\/?$/, "").replace(/\/+$/, "");
    return path ? { hostname: url.hostname.toLowerCase(), path } : null;
  } catch {
    return null;
  }
}

export interface WorkspaceCheckout {
  branch: string;
  projectPath: string;
}

/** Null when the directory is not a checkout of a project on this GitLab, or is on a detached HEAD. */
export async function readCheckout(directory: string, host: string, git: GitRunner = runGit): Promise<WorkspaceCheckout | null> {
  const [branch, remote] = await Promise.all([
    git(directory, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(directory, ["remote", "get-url", "origin"]),
  ]);
  if (!branch || branch === "HEAD" || !remote) {
    return null;
  }
  const parsed = parseRemote(remote);
  if (!parsed || parsed.hostname !== new URL(host).hostname.toLowerCase()) {
    return null;
  }
  return { branch, projectPath: parsed.path };
}
