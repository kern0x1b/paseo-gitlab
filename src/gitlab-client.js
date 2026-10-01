import { loadConfig } from "./config.js";

export class GitLabClient {
  constructor(config = loadConfig()) {
    this.config = config;
    this.host = config.host.replace(/\/+$/, "");
    this.token = config.token;
    this.defaultProjectId = config.defaultProjectId || null;
  }

  requireProjectId(projectId) {
    const id = projectId || this.defaultProjectId;
    if (!id) {
      throw new Error(
        "Project ID is required. Pass --project <id>, set defaultProjectId in config, or set GITLAB_PROJECT_ID.",
      );
    }
    return id;
  }

  ensureAuth() {
    if (!this.token) {
      throw new Error(
        "GitLab token is not configured. Set GITLAB_TOKEN or add it to macOS Keychain (service: paseo-gitlab).",
      );
    }
  }

  async request(endpoint, { method = "GET", body = null, params = {} } = {}) {
    this.ensureAuth();

    let urlStr = endpoint.startsWith("http")
      ? endpoint
      : `${this.host}/api/v4/${endpoint.replace(/^\/+/, "")}`;

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        query.set(key, String(value));
      }
    }

    const queryString = query.toString();
    if (queryString) {
      urlStr += (urlStr.includes("?") ? "&" : "?") + queryString;
    }

    const headers = {
      "PRIVATE-TOKEN": this.token,
      Accept: "application/json",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(urlStr, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GitLab API error ${res.status} (${res.statusText}): ${errText}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  }

  async getCurrentUser() {
    return await this.request("user");
  }

  async getTodos({ state = "pending", perPage = 20 } = {}) {
    return await this.request("todos", {
      params: { state, per_page: perPage },
    });
  }

  async markTodoDone(todoId) {
    return await this.request(`todos/${todoId}/mark_as_done`, { method: "POST" });
  }

  async markAllTodosDone() {
    return await this.request("todos/clear", { method: "POST" });
  }

  async getOpenedMergeRequests({
    projectId = this.defaultProjectId,
    authorUsername,
    assigneeUsername,
    reviewerUsername,
    perPage = 50,
  } = {}) {
    const params = { state: "opened", scope: "all", per_page: perPage };
    if (authorUsername) params.author_username = authorUsername;
    if (assigneeUsername) params.assignee_username = assigneeUsername;
    if (reviewerUsername) params.reviewer_username = reviewerUsername;
    const path = projectId ? `projects/${encodeURIComponent(projectId)}/merge_requests` : "merge_requests";
    return await this.request(path, { params });
  }

  async getOpenedIssues({
    projectId = this.defaultProjectId,
    authorUsername,
    assigneeUsername,
    perPage = 50,
  } = {}) {
    const params = { state: "opened", scope: "all", per_page: perPage };
    if (authorUsername) params.author_username = authorUsername;
    if (assigneeUsername) params.assignee_username = assigneeUsername;
    const path = projectId ? `projects/${encodeURIComponent(projectId)}/issues` : "issues";
    return await this.request(path, { params });
  }

  async getProjectEvents({ projectId = this.defaultProjectId, after = null, perPage = 20 } = {}) {
    const params = { per_page: perPage };
    if (after) params.after = after;
    const path = projectId ? `projects/${encodeURIComponent(projectId)}/events` : "events";
    return await this.request(path, { params });
  }

  async getPipelines({
    projectId = this.defaultProjectId,
    scope = "branches",
    username = null,
    perPage = 10,
  } = {}) {
    const params = { scope, per_page: perPage };
    if (username) params.username = username;
    const path = projectId ? `projects/${encodeURIComponent(projectId)}/pipelines` : "pipelines";
    return await this.request(path, {
      params,
    });
  }

  async getPipeline({ projectId = this.defaultProjectId, pipelineId } = {}) {
    const pid = encodeURIComponent(this.requireProjectId(projectId));
    return await this.request(`projects/${pid}/pipelines/${pipelineId}`);
  }

  async getMergeRequest({ projectId = this.defaultProjectId, mrIid } = {}) {
    const pid = encodeURIComponent(this.requireProjectId(projectId));
    return await this.request(`projects/${pid}/merge_requests/${mrIid}`);
  }

  async getMergeRequestNotes({ projectId = this.defaultProjectId, mrIid, perPage = 20 } = {}) {
    const pid = encodeURIComponent(this.requireProjectId(projectId));
    return await this.request(`projects/${pid}/merge_requests/${mrIid}/notes`, {
      params: { per_page: perPage, sort: "desc" },
    });
  }

  async createMergeRequestNote({ projectId = this.defaultProjectId, mrIid, body } = {}) {
    const pid = encodeURIComponent(this.requireProjectId(projectId));
    return await this.request(`projects/${pid}/merge_requests/${mrIid}/notes`, {
      method: "POST",
      body: { body },
    });
  }

  async getIssue({ projectId = this.defaultProjectId, issueIid } = {}) {
    const pid = encodeURIComponent(this.requireProjectId(projectId));
    return await this.request(`projects/${pid}/issues/${issueIid}`);
  }

  async getIssueNotes({ projectId = this.defaultProjectId, issueIid, perPage = 20 } = {}) {
    const pid = encodeURIComponent(this.requireProjectId(projectId));
    return await this.request(`projects/${pid}/issues/${issueIid}/notes`, {
      params: { per_page: perPage, sort: "desc" },
    });
  }

  async createIssueNote({ projectId = this.defaultProjectId, issueIid, body } = {}) {
    const pid = encodeURIComponent(this.requireProjectId(projectId));
    return await this.request(`projects/${pid}/issues/${issueIid}/notes`, {
      method: "POST",
      body: { body },
    });
  }

  async call(endpoint, { method = "GET", params = {}, body = null } = {}) {
    return await this.request(endpoint, { method, params, body });
  }
}
