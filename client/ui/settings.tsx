import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { authConnectRpc, authDisconnectRpc, authStatusRpc, type AuthStatus } from "../../shared/contract";
import { STATUS_KEY } from "./queries";
import { useStyles, type Styles } from "./styles";

const DEFAULT_HOST = "https://gitlab.com";
/** GitLab pre-fills the token form from these, so creating the right token is one click. */
function tokenPageUrl(host: string): string {
  return `${host.replace(/\/+$/, "")}/-/user_settings/personal_access_tokens?name=Paseo&scopes=api`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(`${iso}T23:59:59Z`).getTime() - Date.now()) / 86_400_000);
}

function Connected({
  status,
  onDisconnect,
  busy,
  styles,
}: {
  styles: Styles;
  status: Extract<AuthStatus, { connected: true }>;
  onDisconnect: () => void;
  busy: boolean;
}) {
  const expiresIn = status.token.expiresAt ? daysUntil(status.token.expiresAt) : null;
  const expiry =
    status.token.expiresAt == null
      ? "Never"
      : `${status.token.expiresAt} (${expiresIn != null && expiresIn >= 0 ? `in ${expiresIn} days` : "expired"})`;
  return (
    <SettingsCard>
      <SettingsRow label="Account" hint={status.user.name}>
        <Text style={styles.text}>@{status.user.username}</Text>
      </SettingsRow>
      <SettingsRow label="GitLab">
        <Text style={styles.text}>{status.host}</Text>
      </SettingsRow>
      <SettingsRow
        label="Token"
        hint={`${status.token.name} · ${status.token.scopes.join(", ")}`}
        error={
          expiresIn != null && expiresIn <= 14 ? "Expires soon: create a new token and connect again." : null
        }
      >
        <Text style={styles.text}>{expiry}</Text>
      </SettingsRow>
      <SettingsAction
        label="Disconnect"
        hint="Removes the token from the Keychain."
        actionLabel="Disconnect"
        onPress={onDisconnect}
        disabled={busy}
      />
    </SettingsCard>
  );
}

function ConnectForm({
  status,
  onConnect,
  busy,
  error,
}: {
  status: Extract<AuthStatus, { connected: false }> | undefined;
  onConnect: (input: { host: string; token: string }) => void;
  busy: boolean;
  error: string | null;
}) {
  const [host, setHost] = useState(status?.host ?? DEFAULT_HOST);
  const [token, setToken] = useState("");
  return (
    <SettingsCard>
      <SettingsInput
        label="GitLab address"
        hint="Your GitLab's https address."
        initialValue={host}
        placeholder={DEFAULT_HOST}
        onChangeText={setHost}
        disabled={busy}
      />
      <SettingsInput
        label="Personal access token"
        hint="Scope: api. Stored in the macOS Keychain, never shown again."
        placeholder="glpat-…"
        secureTextEntry
        onChangeText={setToken}
        disabled={busy}
        error={error ?? status?.error ?? null}
      />
      <SettingsRow label="Need a token?">
        <ExternalLink href={tokenPageUrl(host || DEFAULT_HOST)}>Create one in GitLab</ExternalLink>
      </SettingsRow>
      <SettingsAction
        label="Connect"
        hint="Checks the token with GitLab before saving it."
        actionLabel={busy ? "Connecting…" : "Connect"}
        onPress={() => onConnect({ host, token })}
        disabled={busy || !token.trim() || !host.trim()}
      />
    </SettingsCard>
  );
}

export function GitLabSettings({ theme }: PluginSurfaceProps) {
  const styles = useStyles(theme);
  const toast = useToast();
  const queryClient = useQueryClient();
  const readStatus = useRpc(authStatusRpc);
  const connectRpc = useRpc(authConnectRpc);
  const disconnectRpc = useRpc(authDisconnectRpc);

  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => readStatus({}) });

  const onSaved = (next: AuthStatus) => {
    queryClient.setQueryData(STATUS_KEY, next);
    void queryClient.invalidateQueries({ queryKey: ["gitlab"] });
  };
  const connect = useMutation({
    mutationFn: connectRpc,
    onSuccess: (next) => {
      onSaved(next);
      toast.show("Connected to GitLab", { variant: "success" });
    },
  });
  const disconnect = useMutation({ mutationFn: () => disconnectRpc({}), onSuccess: onSaved });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <SettingsSection title="GitLab">
        {status.isPending ? (
          <Text style={styles.muted}>Checking the connection…</Text>
        ) : status.isError ? (
          <View style={styles.cardBody}>
            <Text style={styles.error}>
              {status.error instanceof Error ? status.error.message : "Could not reach GitLab."}
            </Text>
          </View>
        ) : status.data.connected ? (
          <Connected
            status={status.data}
            onDisconnect={() => disconnect.mutate()}
            busy={disconnect.isPending}
            styles={styles}
          />
        ) : (
          <ConnectForm
            status={status.data}
            onConnect={(input) => connect.mutate(input)}
            busy={connect.isPending}
            error={connect.error instanceof Error ? connect.error.message : null}
          />
        )}
      </SettingsSection>
    </ScrollView>
  );
}
