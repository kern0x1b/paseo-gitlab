import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./state";

/**
 * Where the GitLab token lives. On macOS that is the login Keychain, one item per
 * GitLab host; elsewhere a 0600 file in the plugin's state directory, which is no
 * worse than what `glab` does without a keyring.
 */
export interface SecretStore {
  read(account: string): Promise<string | null>;
  write(account: string, secret: string): Promise<void>;
  remove(account: string): Promise<void>;
}

const KEYCHAIN_SERVICE = "paseo-gitlab";
const SECURITY_TIMEOUT_MS = 5000;

/** Both values are passed unquoted to `security -i`, so they must not need quoting. */
const SAFE_VALUE = /^[A-Za-z0-9._:-]+$/;

type SecurityRun = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

function runSecurity(args: string[], stdin?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((done) => {
    // stdin is only opened when there is something to write: `find-generic-password`
    // never reads it and can exit first, and ending a pipe to a gone process raises
    // EPIPE, which without a listener takes the whole plugin process down.
    const child = spawn("security", args, { stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => child.kill(), SECURITY_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      done({ code: -1, stdout: "" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout });
    });
    if (stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        // Reported through the exit code instead.
      });
      child.stdin.end(stdin);
    }
  });
}

function assertSafe(value: string, what: string): void {
  if (!SAFE_VALUE.test(value)) {
    throw new Error(`The ${what} contains characters that cannot be stored.`);
  }
}

export function keychainStore(run: SecurityRun = runSecurity): SecretStore {
  return {
    async read(account) {
      const { code, stdout } = await run([
        "find-generic-password",
        "-a",
        account,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ]);
      return code === 0 ? stdout.trim() || null : null;
    },
    async write(account, secret) {
      assertSafe(account, "host");
      assertSafe(secret, "token");
      // Through stdin rather than argv, so the token never shows up in `ps`.
      const { code } = await run(
        ["-i"],
        `add-generic-password -U -a ${account} -s ${KEYCHAIN_SERVICE} -w ${secret}\n`,
      );
      if (code !== 0) {
        throw new Error("Could not save the token to the Keychain.");
      }
    },
    async remove(account) {
      await run(["delete-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE]);
    },
  };
}

export function fileStore(directory: string = stateDir()): SecretStore {
  const fileFor = (account: string) => join(directory, `token-${account.replace(/[^A-Za-z0-9.-]/g, "_")}`);
  return {
    async read(account) {
      try {
        return readFileSync(fileFor(account), "utf8").trim() || null;
      } catch {
        return null;
      }
    },
    async write(account, secret) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = fileFor(account);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, secret, { mode: 0o600 });
      renameSync(temporary, path);
    },
    async remove(account) {
      rmSync(fileFor(account), { force: true });
    },
  };
}

export function defaultSecretStore(): SecretStore {
  return process.platform === "darwin" ? keychainStore() : fileStore();
}
