const MR_ROLE_EVENT_TYPES = {
  reviewer: "mr_review_requested",
  assignee: "mr_assigned",
  author: "mr_authored",
};

function projectPathFromReference(reference) {
  return reference ? reference.replace(/[!#]\d+$/, "") : null;
}

function isBotUser(user) {
  const username = user?.username || "";
  return Boolean(user?.bot) || username.includes("bot");
}

export class GitLabSnapshot {
  constructor({ client }) {
    this.client = client;
    this.cleanHost = client.host.replace(/^https?:\/\//, "");
    this.errors = [];
  }

  async collect() {
    const generatedAt = new Date().toISOString();
    const user = await this.client.getCurrentUser();
    const username = user.username;

    const [todos, authoredMrs, reviewerMrs, assignedMrs, assignedIssues] = await Promise.all([
      this.fetchList("todos", () => this.client.getTodos({ state: "pending", perPage: 50 })),
      this.fetchList("authored_mrs", () => this.client.getOpenedMergeRequests({ authorUsername: username })),
      this.fetchList("reviewer_mrs", () =>
        this.client.getOpenedMergeRequests({ reviewerUsername: username }),
      ),
      this.fetchList("assigned_mrs", () =>
        this.client.getOpenedMergeRequests({ assigneeUsername: username }),
      ),
      this.fetchList("assigned_issues", () => this.client.getOpenedIssues({ assigneeUsername: username })),
    ]);

    const itemsByUrn = new Map();
    const addItem = (item) => {
      const existing = itemsByUrn.get(item.urn);
      if (existing) {
        existing.snapshot.reasons.push(...item.snapshot.reasons);
        for (const [key, value] of Object.entries(item.snapshot.state)) {
          const current = existing.snapshot.state[key];
          existing.snapshot.state[key] =
            Array.isArray(current) && Array.isArray(value) ? [...current, ...value] : (current ?? value);
        }
      } else {
        itemsByUrn.set(item.urn, item);
      }
    };

    const mrRoles = new Map();
    for (const [role, list] of [
      ["reviewer", reviewerMrs],
      ["assignee", assignedMrs],
      ["author", authoredMrs],
    ]) {
      for (const mr of list) {
        const key = `${mr.project_id}:${mr.iid}`;
        if (!mrRoles.has(key)) mrRoles.set(key, { mr, roles: [] });
        mrRoles.get(key).roles.push(role);
      }
    }

    const mrItems = await Promise.all(
      Array.from(mrRoles.values()).map(({ mr, roles }) => this.buildMergeRequestItem(mr, roles)),
    );
    mrItems.forEach(addItem);
    assignedIssues.map((issue) => this.buildIssueItem(issue)).forEach(addItem);
    todos.map((todo) => this.buildTodoItem(todo)).forEach(addItem);

    const items = Array.from(itemsByUrn.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return {
      protocol: "paseo-fleet/v1",
      source: "gitlab",
      instance: this.client.host,
      actor: username,
      generated_at: generatedAt,
      items,
      errors: this.errors,
    };
  }

  async fetchList(source, fetcher) {
    try {
      const list = await fetcher();
      return Array.isArray(list) ? list : [];
    } catch (err) {
      this.errors.push({ source, error: err.message });
      return [];
    }
  }

  async fetchOptional(source, fetcher) {
    try {
      return await fetcher();
    } catch (err) {
      this.errors.push({ source, error: err.message });
      return null;
    }
  }

  buildUrn(projectPath, targetType, targetId) {
    return `urn:gitlab:${this.cleanHost}:${projectPath}:${targetType}:${targetId}`;
  }

  buildItem({
    projectPath,
    targetType,
    targetId,
    eventType,
    author,
    title,
    url,
    timestamp,
    content,
    replyAction,
    reasons,
    state,
  }) {
    const urn = this.buildUrn(projectPath, targetType, targetId);
    return {
      protocol: "paseo-fleet/v1",
      id: `snap_gl_${urn.replace(/[^a-zA-Z0-9]+/g, "_")}`,
      timestamp: timestamp || new Date().toISOString(),
      source: "gitlab",
      instance: this.client.host,
      scope: projectPath,
      urn,
      event_type: eventType,
      actor: {
        id: author?.username || "unknown",
        name: author?.name || author?.username || "unknown",
        is_bot: isBotUser(author),
      },
      target: { type: targetType, id: String(targetId), title: title || "", url: url || "" },
      content,
      reply_action: replyAction,
      snapshot: { reasons, state },
    };
  }

  mergeRequestReplyAction(projectId, mrIid) {
    return {
      type: "mcp",
      tool: "gitlab_create_mr_note",
      params: { project_id: projectId, mr_iid: Number(mrIid) },
    };
  }

  issueReplyAction(projectId, issueIid) {
    return {
      type: "mcp",
      tool: "gitlab_create_issue_note",
      params: { project_id: projectId, issue_iid: Number(issueIid) },
    };
  }

  async buildMergeRequestItem(mr, roles) {
    const source = `mr:${mr.project_id}!${mr.iid}`;
    const [details, approvals] = await Promise.all([
      this.fetchOptional(source, () =>
        this.client.getMergeRequest({ projectId: mr.project_id, mrIid: mr.iid }),
      ),
      this.fetchOptional(`${source}:approvals`, () =>
        this.client.call(`projects/${mr.project_id}/merge_requests/${mr.iid}/approvals`),
      ),
    ]);

    const merged = { ...mr, ...(details || {}) };
    const pipeline = merged.head_pipeline || merged.pipeline || null;
    const approvedBy = (approvals?.approved_by || []).map((entry) => entry.user?.username).filter(Boolean);
    const projectPath = projectPathFromReference(merged.references?.full) || String(mr.project_id);

    const state = {
      roles,
      draft: Boolean(merged.draft || merged.work_in_progress),
      detailed_merge_status: merged.detailed_merge_status || merged.merge_status || null,
      has_conflicts: Boolean(merged.has_conflicts),
      pipeline: pipeline ? { id: pipeline.id, status: pipeline.status, url: pipeline.web_url } : null,
      approved_by: approvedBy,
      approvals_left: approvals?.approvals_left ?? null,
      reviewers: (merged.reviewers || []).map((reviewer) => reviewer.username),
      user_notes_count: merged.user_notes_count ?? null,
      source_branch: merged.source_branch,
      target_branch: merged.target_branch,
      updated_at: merged.updated_at,
      details_verified: Boolean(details),
    };

    const facts = [
      `roles: ${roles.join(", ")}`,
      state.draft ? "draft" : null,
      state.pipeline ? `pipeline ${state.pipeline.status}` : "no pipeline",
      state.detailed_merge_status ? `merge status ${state.detailed_merge_status}` : null,
      state.has_conflicts ? "has conflicts" : null,
      `approved by: ${approvedBy.join(", ") || "nobody"}`,
    ].filter(Boolean);

    return this.buildItem({
      projectPath,
      targetType: "mr",
      targetId: mr.iid,
      eventType: MR_ROLE_EVENT_TYPES[roles[0]],
      author: merged.author,
      title: merged.title,
      url: merged.web_url,
      timestamp: merged.updated_at,
      content: `MR !${mr.iid} "${merged.title}" (${facts.join("; ")})`,
      replyAction: this.mergeRequestReplyAction(mr.project_id, mr.iid),
      reasons: roles.map((role) => `mr_${role}`),
      state,
    });
  }

  buildIssueItem(issue) {
    const projectPath = projectPathFromReference(issue.references?.full) || String(issue.project_id);
    const labels = issue.labels || [];
    return this.buildItem({
      projectPath,
      targetType: "issue",
      targetId: issue.iid,
      eventType: "issue_assigned",
      author: issue.author,
      title: issue.title,
      url: issue.web_url,
      timestamp: issue.updated_at,
      content: `Issue #${issue.iid} "${issue.title}"${labels.length ? ` (labels: ${labels.join(", ")})` : ""}`,
      replyAction: this.issueReplyAction(issue.project_id, issue.iid),
      reasons: ["issue_assignee"],
      state: {
        labels,
        milestone: issue.milestone?.title || null,
        due_date: issue.due_date || null,
        user_notes_count: issue.user_notes_count ?? null,
        updated_at: issue.updated_at,
      },
    });
  }

  buildTodoItem(todo) {
    const projectPath = todo.project?.path_with_namespace || String(todo.project?.id || "unknown");
    const isMergeRequest = todo.target_type === "MergeRequest";
    const isIssue = todo.target_type === "Issue";
    const targetType = isMergeRequest
      ? "mr"
      : isIssue
        ? "issue"
        : String(todo.target_type || "todo").toLowerCase();
    const targetId = todo.target?.iid ?? todo.target?.id ?? todo.id;
    const projectId = todo.project?.id;

    let replyAction = { type: "none" };
    if (isMergeRequest && projectId) replyAction = this.mergeRequestReplyAction(projectId, targetId);
    if (isIssue && projectId) replyAction = this.issueReplyAction(projectId, targetId);

    return this.buildItem({
      projectPath,
      targetType,
      targetId,
      eventType: `todo_${todo.action_name}`,
      author: todo.author,
      title: todo.target?.title || "",
      url: todo.target_url,
      timestamp: todo.updated_at || todo.created_at,
      content: `To-do (${todo.action_name}) by @${todo.author?.username || "unknown"}: ${todo.body || todo.target?.title || ""}`,
      replyAction,
      reasons: [`todo_${todo.action_name}`],
      state: {
        todo_ids: [todo.id],
        todo_action: todo.action_name,
        todo_body: todo.body || null,
      },
    });
  }
}
