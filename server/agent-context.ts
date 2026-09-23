import type { Detail, Discussion, JobLog, Pipeline } from "../shared/contract";

/**
 * Plain text an agent can act on: what the item is, where it lives, and what is
 * still open on it. Markdown bodies are passed as written, since agents read
 * Markdown better than GitLab's HTML.
 */
const LOG_TAIL_LINES = 80;
const MAX_FAILED_JOBS = 3;
/** Some descriptions paste whole logs; past this the agent gets the link instead. */
const MAX_DESCRIPTION_CHARS = 8000;

export function logTail(log: JobLog, lines: number = LOG_TAIL_LINES): string {
  return log.lines
    .slice(-lines)
    .map((line) => line.segments.map((segment) => segment.text).join(""))
    .join("\n");
}

function threadText(discussion: Discussion, index: number): string {
  const [first, ...replies] = discussion.notes;
  if (!first) {
    return "";
  }
  const position = first.position;
  const where = position ? ` (${position.path}:${position.newLine ?? position.oldLine ?? "?"})` : "";
  const lines = [`${index + 1}.${where} @${first.author?.username ?? "ghost"}: ${first.body.trim()}`];
  for (const reply of replies) {
    lines.push(`   ↳ @${reply.author?.username ?? "ghost"}: ${reply.body.trim()}`);
  }
  return lines.join("\n");
}

export function unresolvedThreads(detail: Detail): Discussion[] {
  return detail.discussions.filter(
    (discussion) => discussion.resolvable && !discussion.resolved && !discussion.notes[0]?.system,
  );
}

export interface FailedJobLog {
  name: string;
  stage: string;
  log: JobLog;
}

export function failedJobsOf(pipeline: Pipeline | null): { id: string; name: string; stage: string }[] {
  if (!pipeline) {
    return [];
  }
  return pipeline.stages
    .flatMap((stage) => stage.jobs.map((job) => ({ ...job, stage: stage.name })))
    .filter((job) => job.status === "FAILED" && !job.allowFailure)
    .slice(0, MAX_FAILED_JOBS);
}

export function itemContext(detail: Detail, failedJobs: FailedJobLog[], withDescription = true): string {
  const kind = detail.kind === "mr" ? "Merge request" : "Issue";
  const parts = [`${kind} ${detail.reference}: ${detail.title}`, detail.webUrl];
  if (detail.kind === "mr" && detail.sourceBranch) {
    parts.push(
      `Branch ${detail.sourceBranch} → ${detail.targetBranch}. Pipeline: ${detail.pipelineStatus?.toLowerCase() ?? "none"}.`,
    );
  }
  const description = detail.description.trim();
  if (withDescription && description) {
    const shown =
      description.length > MAX_DESCRIPTION_CHARS
        ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}\n… (truncated; the full description is at ${detail.webUrl})`
        : description;
    parts.push(`\nDescription:\n${shown}`);
  }
  const open = unresolvedThreads(detail);
  if (open.length > 0) {
    parts.push(`\nUnresolved threads:\n${open.map(threadText).join("\n")}`);
  }
  for (const job of failedJobs) {
    parts.push(
      `\nFailed job "${job.name}" (stage ${job.stage}), last lines of its log:\n\`\`\`\n${logTail(job.log)}\n\`\`\``,
    );
  }
  return parts.join("\n");
}

/** The task line an agent gets when handed an item from the panel. */
export function agentPrompt(detail: Detail, failedJobs: FailedJobLog[]): string {
  const open = unresolvedThreads(detail).length;
  const asks: string[] = [];
  if (open > 0) {
    asks.push(`address the ${open} unresolved review ${open === 1 ? "thread" : "threads"}`);
  }
  if (failedJobs.length > 0) {
    asks.push(`fix the failing ${failedJobs.length === 1 ? "job" : "jobs"}`);
  }
  const task =
    asks.length > 0
      ? `Please ${asks.join(" and ")} below.`
      : detail.kind === "issue"
        ? "Please work on this issue."
        : "Please review this merge request.";
  return `${task}\n\n${itemContext(detail, failedJobs)}`;
}

/** Merge conflicts have no GitLab API: the agent resolves them in its checkout and pushes. */
export function conflictPrompt(detail: Detail): string {
  const source = detail.sourceBranch ?? "the source branch";
  const target = detail.targetBranch ?? "the target branch";
  return [
    `Merge request ${detail.reference} "${detail.title}" has merge conflicts with ${target}.`,
    detail.webUrl,
    "",
    `Please resolve them: fetch origin, check out ${source}, merge origin/${target} into it, resolve every conflict keeping the intent of both sides, run the affected tests, commit and push ${source}.`,
    "Do not force-push. If a conflict needs a decision you cannot make from the code, stop and ask me.",
  ].join("\n");
}

export function jobPrompt(jobName: string, jobUrl: string, pipeline: Pipeline | null, log: JobLog): string {
  const where = pipeline ? ` in pipeline #${pipeline.iid} on ${pipeline.ref}` : "";
  return `Please find out why the job "${jobName}"${where} failed and fix it.\n${jobUrl}\n\nLast lines of its log:\n\`\`\`\n${logTail(log, 200)}\n\`\`\``;
}
