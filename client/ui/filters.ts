import type { ListItem } from "../../shared/contract";

/** Issues and MRs are yours as author, assignee or both; the list can show either side. */
export type RoleFilter = "assignee" | "author" | "all";

export const ROLE_FILTERS: { id: RoleFilter; label: string; empty: string }[] = [
  { id: "assignee", label: "Assigned to me", empty: "Nothing open is assigned to you." },
  { id: "author", label: "Created by me", empty: "Nothing open was created by you." },
  { id: "all", label: "All", empty: "Nothing open is yours." },
];

export function byRole(items: ListItem[], filter: RoleFilter): ListItem[] {
  return filter === "all" ? items : items.filter((item) => item.roles.includes(filter));
}

/** Assigned is what you have to act on, so it leads, unless it is empty and would hide the rest. */
export function defaultRoleFilter(items: ListItem[]): RoleFilter {
  return byRole(items, "assignee").length > 0 ? "assignee" : "all";
}
