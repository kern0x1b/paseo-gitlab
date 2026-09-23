import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
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

/** Initials instead of the avatar image: gravatar URLs would leak every page view to a third party. */
export function Avatar({ person, styles }: { person: Person | null; styles: Styles }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarLabel}>{initials(person?.name ?? "?")}</Text>
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
}: {
  icon: string;
  label: string;
  onPress: () => void;
  theme: PluginTheme;
  styles: Styles;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconButton,
        pressed ? styles.iconButtonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Icon name={icon} size={15} color={theme.colors.foregroundMuted} />
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
