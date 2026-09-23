import type { ItemRef } from "../../shared/contract";

/** Everything under `["gitlab"]`, so a reconnect can drop it all at once. */
export const STATUS_KEY = ["gitlab", "status"] as const;
export const LISTS_KEY = ["gitlab", "lists"] as const;

export function detailKey(ref: ItemRef) {
  return ["gitlab", "detail", ref.kind, ref.projectPath, ref.iid] as const;
}

export const LISTS_REFRESH_MS = 60_000;
export const DETAIL_REFRESH_MS = 30_000;
