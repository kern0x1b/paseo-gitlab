import type { Label, ListItem } from "../../shared/contract";

export type RoleFilter = "assignee" | "author" | "all";

export const ROLE_FILTERS: { id: RoleFilter; label: string; empty: string }[] = [
  { id: "assignee", label: "Assigned to me", empty: "Nothing open is assigned to you." },
  { id: "author", label: "Created by me", empty: "Nothing open was created by you." },
  { id: "all", label: "All", empty: "Nothing open is yours." },
];

export function byRole(items: ListItem[], filter: RoleFilter): ListItem[] {
  return filter === "all" ? items : items.filter((item) => item.roles.includes(filter));
}

export function defaultRoleFilter(items: ListItem[]): RoleFilter {
  return byRole(items, "assignee").length > 0 ? "assignee" : "all";
}

export function labelsIn(items: ListItem[]): { label: Label; count: number }[] {
  const byTitle = new Map<string, { label: Label; count: number }>();
  for (const item of items) {
    for (const label of item.labels) {
      const entry = byTitle.get(label.title) ?? { label, count: 0 };
      entry.count += 1;
      byTitle.set(label.title, entry);
    }
  }
  return [...byTitle.values()].sort(
    (a, b) => b.count - a.count || a.label.title.localeCompare(b.label.title),
  );
}

export function byLabels(items: ListItem[], selected: string[]): ListItem[] {
  if (selected.length === 0) {
    return items;
  }
  return items.filter((item) =>
    selected.every((title) => item.labels.some((label) => label.title === title)),
  );
}
