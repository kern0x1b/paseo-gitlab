import type { PluginTheme } from "@getpaseo/plugin";

export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** `group/sub/project!123` → `project !123`: the list shows the repo name, not its whole path. */
export function shortReference(reference: string): string {
  const match = reference.match(/^(?:.*\/)?([^/]+)([#!]\d+)$/);
  return match ? `${match[1]} ${match[2]}` : reference;
}

const RUNNING = new Set([
  "RUNNING",
  "PENDING",
  "PREPARING",
  "CREATED",
  "WAITING_FOR_RESOURCE",
  "WAITING_FOR_CALLBACK",
  "SCHEDULED",
]);

export function pipelineColor(status: string | null, theme: PluginTheme): string | null {
  if (!status) {
    return null;
  }
  if (status === "SUCCESS") {
    return theme.colors.statusSuccess;
  }
  if (status === "FAILED") {
    return theme.colors.statusDanger;
  }
  if (RUNNING.has(status)) {
    return theme.colors.statusWarning;
  }
  return theme.colors.foregroundMuted;
}

export function humanize(value: string): string {
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MERGE_STATUS: Record<string, string> = {
  MERGEABLE: "Ready to merge",
  CONFLICT: "Has conflicts",
  DRAFT_STATUS: "Draft",
  CI_MUST_PASS: "Pipeline must pass",
  CI_STILL_RUNNING: "Pipeline running",
  DISCUSSIONS_NOT_RESOLVED: "Unresolved threads",
  NOT_APPROVED: "Needs approval",
  BLOCKED_STATUS: "Blocked by another MR",
  NEED_REBASE: "Needs rebase",
  NOT_OPEN: "Not open",
  UNCHECKED: "Checking…",
  CHECKING: "Checking…",
  JIRA_ASSOCIATION_MISSING: "Missing Jira issue",
  REQUESTED_CHANGES: "Changes requested",
};

export function mergeStatusLabel(status: string | null): string | null {
  return status ? (MERGE_STATUS[status] ?? humanize(status)) : null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() ||
    "?"
  );
}
