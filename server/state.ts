import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The non-secret half of the connection: which GitLab this plugin talks to. Kept in
 * XDG state next to nothing else, so it never collides with daemon-owned files.
 */
export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "paseo-gitlab");
}

function configFile(): string {
  return join(stateDir(), "config.json");
}

export function readHost(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(configFile(), "utf8")) as { host?: unknown };
    return typeof parsed.host === "string" ? parsed.host : null;
  } catch {
    return null;
  }
}

export function writeHost(host: string): void {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const path = configFile();
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ host }), { mode: 0o600 });
  renameSync(temporary, path);
}

export function clearHost(): void {
  rmSync(configFile(), { force: true });
}
