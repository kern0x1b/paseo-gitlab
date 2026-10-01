import type { ItemRef, PipelineRef } from "../../shared/contract";

export const STATUS_KEY = ["gitlab", "status"] as const;
export const LISTS_KEY = ["gitlab", "lists"] as const;

export function detailKey(ref: ItemRef) {
  return ["gitlab", "detail", ref.kind, ref.projectPath, ref.iid] as const;
}

export const LISTS_REFRESH_MS = 60_000;
export const DETAIL_REFRESH_MS = 30_000;

export function pipelineKey(ref: PipelineRef) {
  return ["gitlab", "pipeline", ref.projectPath, ref.iid] as const;
}

export function jobLogKey(projectPath: string, jobId: string) {
  return ["gitlab", "job-log", projectPath, jobId] as const;
}
