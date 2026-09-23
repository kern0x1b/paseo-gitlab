import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import React, { createContext, useContext, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import type { Label, Person } from "../../shared/contract";
import { initials, pipelineColor } from "./format";
import type { Styles } from "./styles";

export function Labels({ labels, styles }: { labels: Label[]; styles: Styles }) {
  if (labels.length === 0) {
    return null;
  }
  return (
    <View style={styles.chips}>
      {labels.map((label) => (
        <View key={label.title} style={[styles.badge, { backgroundColor: label.color }]}>
          <Text style={[styles.badgeLabel, { color: label.textColor }]} numberOfLines={1}>
            {label.title}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Badge({ label, styles, color }: { label: string; styles: Styles; color?: string }) {
  return (
    <View style={styles.badge}>
      <Text style={[styles.badgeLabel, color ? { color } : null]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function PipelineDot({
  status,
  theme,
  styles,
}: {
  status: string | null;
  theme: PluginTheme;
  styles: Styles;
}) {
  const color = pipelineColor(status, theme);
  return color ? (
    <View accessibilityLabel={`Pipeline ${status}`} style={[styles.dot, { backgroundColor: color }]} />
  ) : null;
}

/** The connected GitLab, so relative avatar paths resolve without threading the host everywhere. */
export const HostContext = createContext<string>("");

function avatarSource(person: Person | null, host: string): string | null {
  const url = person?.avatarUrl;
  if (!url) {
    return null;
  }
  try {
    const resolved = new URL(url, host || undefined);
    return resolved.protocol === "https:" ? resolved.href : null;
  } catch {
    return null;
  }
}

/** The person's GitLab avatar, or their initials when there is none or it fails to load. */
export function Avatar({
  person,
  styles,
  size = 20,
}: {
  person: Person | null;
  styles: Styles;
  size?: number;
}) {
  const host = useContext(HostContext);
  const [failed, setFailed] = useState(false);
  const source = avatarSource(person, host);
  const frame = { width: size, height: size, borderRadius: size / 2 };
  if (source && !failed) {
    return (
      <Image
        source={{ uri: source }}
        accessibilityLabel={person?.name ?? "avatar"}
        onError={() => setFailed(true)}
        style={[styles.avatar, frame]}
      />
    );
  }
  return (
    <View style={[styles.avatar, frame]}>
      <Text style={[styles.avatarLabel, { fontSize: Math.max(8, size * 0.45) }]}>
        {initials(person?.name ?? "?")}
      </Text>
    </View>
  );
}

/** Overlapping avatars for a row; the names are in the accessibility label and the detail view. */
export function AvatarStack({ people, styles, max = 4 }: { people: Person[]; styles: Styles; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <View
      accessibilityLabel={people.map((person) => person.name).join(", ")}
      style={{ flexDirection: "row", alignItems: "center" }}
    >
      {shown.map((person, index) => (
        <View key={person.username} style={{ marginLeft: index === 0 ? 0 : -6 }}>
          <Avatar person={person} styles={styles} size={18} />
        </View>
      ))}
      {people.length > max ? (
        <Text style={[styles.small, { marginLeft: 4 }]}>+{people.length - max}</Text>
      ) : null}
    </View>
  );
}

/** Avatar and name, for the detail view where there is room to say who. */
export function PersonChip({ person, styles }: { person: Person; styles: Styles }) {
  return (
    <View style={[styles.badge, { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 2 }]}>
      <Avatar person={person} styles={styles} size={16} />
      <Text style={styles.badgeLabel}>{person.name}</Text>
    </View>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  theme,
  styles,
  disabled,
  active,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  theme: PluginTheme;
  styles: Styles;
  disabled?: boolean;
  /** A toggle that is on: painted like a pressed button. */
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconButton,
        pressed || active ? styles.iconButtonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Icon name={icon} size={15} color={active ? theme.colors.foreground : theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  styles,
  primary,
  disabled,
  busy,
  theme,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
  theme: PluginTheme;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.button,
        primary ? styles.buttonPrimary : null,
        disabled || busy ? styles.buttonDisabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={primary ? theme.colors.accentForeground : theme.colors.foregroundMuted}
        />
      ) : null}
      <Text style={primary ? styles.buttonLabelPrimary : styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export function Centered({ children, styles }: { children: React.ReactNode; styles: Styles }) {
  return <View style={styles.center}>{children}</View>;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A button that asks first. For anything that is hard to take back or that other
 * people see at once: merging, approving, closing.
 */
export function ConfirmButton({
  label,
  title,
  message,
  confirmLabel,
  onConfirm,
  styles,
  theme,
  primary,
  busy,
  disabled,
}: {
  label: string;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  styles: Styles;
  theme: PluginTheme;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        label={label}
        primary={primary}
        busy={busy}
        disabled={disabled}
        onPress={() => setOpen(true)}
        styles={styles}
        theme={theme}
      />
      <Modal title={title} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <Text style={styles.text}>{message}</Text>
          <View style={styles.row}>
            <View style={styles.spacer} />
            <Button label="Cancel" onPress={() => setOpen(false)} styles={styles} theme={theme} />
            <Button
              label={confirmLabel}
              primary
              onPress={() => {
                setOpen(false);
                onConfirm();
              }}
              styles={styles}
              theme={theme}
            />
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}
