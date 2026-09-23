import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { StyleSheet } from "react-native";

/** Paseo's own spacing, type and radius steps, so the panel sits next to Files and Changes without standing out. */
export const SPACE = { 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16 } as const;
export const FONT = { xs: 11, sm: 12, base: 13, lg: 15 } as const;
export const RADIUS = { sm: 4, md: 6, lg: 8, pill: 9999 } as const;

export function useStyles(theme: PluginTheme) {
  const { colors } = theme;
  return useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: colors.surface0 },
        scroll: { padding: SPACE[3], gap: SPACE[3] },
        row: { flexDirection: "row", alignItems: "center", gap: SPACE[2] },
        spacer: { flex: 1 },

        text: { color: colors.foreground, fontSize: FONT.base, lineHeight: FONT.base * 1.45 },
        muted: { color: colors.foregroundMuted, fontSize: FONT.sm },
        small: { color: colors.foregroundMuted, fontSize: FONT.xs },
        title: { color: colors.foreground, fontSize: FONT.lg, fontWeight: "600", lineHeight: FONT.lg * 1.35 },
        sectionTitle: {
          color: colors.foregroundMuted,
          fontSize: FONT.xs,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        },
        error: { color: colors.statusDanger, fontSize: FONT.sm, lineHeight: FONT.sm * 1.4 },

        card: {
          backgroundColor: colors.surface1,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        },
        cardBody: { padding: SPACE[3], gap: SPACE[2] },
        divider: { height: 1, backgroundColor: colors.border },

        tabs: {
          flexDirection: "row",
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        },
        tab: { flex: 1, paddingVertical: SPACE[1.5], alignItems: "center" },
        tabActive: { backgroundColor: colors.surface2 },
        tabLabel: { color: colors.foregroundMuted, fontSize: FONT.sm },
        tabLabelActive: { color: colors.foreground, fontWeight: "500" },

        listRow: { paddingHorizontal: SPACE[3], paddingVertical: SPACE[2], gap: SPACE[1] },
        listRowPressed: { backgroundColor: colors.surface2 },
        listTitle: { color: colors.foreground, fontSize: FONT.base, lineHeight: FONT.base * 1.35 },

        iconButton: {
          width: 26,
          height: 26,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: RADIUS.md,
        },
        iconButtonPressed: { backgroundColor: colors.surface2 },
        button: {
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE[1.5],
          paddingHorizontal: SPACE[3],
          paddingVertical: SPACE[1.5],
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: colors.border,
        },
        buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
        buttonLabel: { color: colors.foreground, fontSize: FONT.sm },
        buttonLabelPrimary: { color: colors.accentForeground, fontSize: FONT.sm, fontWeight: "500" },
        buttonDisabled: { opacity: 0.5 },

        badge: {
          paddingHorizontal: SPACE[1.5],
          paddingVertical: 1,
          borderRadius: RADIUS.pill,
          backgroundColor: colors.surface2,
        },
        badgeLabel: { color: colors.foregroundMuted, fontSize: FONT.xs },
        chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACE[1] },
        dot: { width: 8, height: 8, borderRadius: 4 },

        metaRow: { flexDirection: "row", gap: SPACE[2], alignItems: "flex-start" },
        metaLabel: { width: 84, color: colors.foregroundMuted, fontSize: FONT.sm },
        metaValue: { flex: 1, color: colors.foreground, fontSize: FONT.sm },

        note: { gap: SPACE[1] },
        noteHeader: { flexDirection: "row", alignItems: "center", gap: SPACE[1.5] },
        noteAuthor: { color: colors.foreground, fontSize: FONT.sm, fontWeight: "600" },
        avatar: {
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: colors.surface2,
          alignItems: "center",
          justifyContent: "center",
        },
        avatarLabel: { color: colors.foregroundMuted, fontSize: 10, fontWeight: "600" },
        systemNote: { color: colors.foregroundMuted, fontSize: FONT.xs, paddingHorizontal: SPACE[3] },
        replies: { paddingLeft: SPACE[3], borderLeftWidth: 2, borderLeftColor: colors.border, gap: SPACE[2] },

        input: {
          minHeight: 64,
          maxHeight: 220,
          padding: SPACE[2],
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface0,
          color: colors.foreground,
          fontSize: FONT.base,
          textAlignVertical: "top",
        },
        center: { padding: SPACE[4], alignItems: "center", gap: SPACE[3] },
      }),
    [colors],
  );
}

export type Styles = ReturnType<typeof useStyles>;
