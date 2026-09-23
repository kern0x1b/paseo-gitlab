import type { PluginRpcContract } from "@getpaseo/plugin";
import { useRpc as useSdkRpc, useWorkspace } from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import React, { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { input as ZodInput, ZodType } from "zod";
import { accountsRpc } from "../shared/contract";

/**
 * Which GitLab a panel works with. A workspace follows its `origin` when that is
 * one of the connected GitLabs, else the default one, unless you picked another in
 * the panel. Every RPC the panel makes names that account, and its queries live in
 * a cache of their own, so two workspaces on two GitLabs never mix their data.
 */
export const ACCOUNTS_KEY = ["gitlab-accounts"] as const;
const CHOICES_KEY = "paseo-gitlab:workspace-accounts";

interface AccountState {
  hosts: string[];
  account: string | null;
  /** The connected GitLab the workspace's `origin` points at. */
  fromRemote: string | null;
  workspaceId: string | null;
}

const AccountContext = createContext<AccountState>({
  hosts: [],
  account: null,
  fromRemote: null,
  workspaceId: null,
});

export function useAccount(): AccountState {
  return useContext(AccountContext);
}

/** The SDK's `useRpc`, with the panel's account added to every call that does not name one. */
export function useRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
  contract: PluginRpcContract<InputSchema, OutputSchema>,
) {
  const call = useSdkRpc(contract);
  const { account } = useContext(AccountContext);
  return useCallback(
    (input: ZodInput<InputSchema>) =>
      call((account ? { account, ...(input as object) } : input) as ZodInput<InputSchema>),
    [call, account],
  );
}

const caches = new Map<string, QueryClient>();

function cacheFor(account: string): QueryClient {
  let cache = caches.get(account);
  if (!cache) {
    cache = new QueryClient();
    caches.set(account, cache);
  }
  return cache;
}

/** After connecting or disconnecting: every panel reads its account's data again. */
export function refreshAccountCaches(): void {
  for (const cache of caches.values()) {
    void cache.invalidateQueries();
  }
}

const listeners = new Set<() => void>();
let choices: Record<string, string> = (() => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(CHOICES_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
})();

/** Pins a workspace to a GitLab; null goes back to following its `origin`. */
export function chooseAccount(workspaceId: string, host: string | null): void {
  const next = { ...choices };
  if (host) {
    next[workspaceId] = host;
  } else {
    delete next[workspaceId];
  }
  choices = next;
  try {
    globalThis.localStorage?.setItem(CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // No storage: the choice lasts until the window closes.
  }
  for (const listener of listeners) {
    listener();
  }
}

function useChosenAccount(workspaceId: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => choices[workspaceId] ?? null,
    () => null,
  );
}

export function AccountScope({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const readAccounts = useSdkRpc(accountsRpc);
  const accounts = useQuery({
    queryKey: [...ACCOUNTS_KEY, directory ?? ""],
    queryFn: () => readAccounts(directory ? { directory } : {}),
    staleTime: 60_000,
  });
  const chosen = useChosenAccount(workspaceId);
  if (accounts.isPending) {
    return null;
  }
  const hosts = accounts.data?.hosts ?? [];
  const fromRemote = accounts.data?.forDirectory ?? null;
  const account =
    (chosen && hosts.includes(chosen) ? chosen : null) ?? fromRemote ?? accounts.data?.active ?? null;
  return (
    <AccountContext.Provider value={{ hosts, account, fromRemote, workspaceId }}>
      <QueryClientProvider client={cacheFor(account ?? "")}>{children}</QueryClientProvider>
    </AccountContext.Provider>
  );
}
