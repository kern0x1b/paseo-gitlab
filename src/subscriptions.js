import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const SUBS_DIR = path.join(os.homedir(), ".config", "gitlab-router");
const SUBS_FILE = path.join(SUBS_DIR, "subscriptions.json");

function ensureDir() {
  if (!fs.existsSync(SUBS_DIR)) {
    fs.mkdirSync(SUBS_DIR, { recursive: true });
  }
}

export class SubscriptionRegistry {
  constructor(filePath = SUBS_FILE) {
    this.filePath = filePath;
  }

  load() {
    ensureDir();
    if (!fs.existsSync(this.filePath)) {
      return { coordinatorAgentId: null, subscriptions: [] };
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return { coordinatorAgentId: null, subscriptions: [] };
    }
  }

  save(data) {
    ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  getCoordinator() {
    return this.load().coordinatorAgentId;
  }

  setCoordinator(agentId) {
    const data = this.load();
    data.coordinatorAgentId = agentId;
    this.save(data);
    return data;
  }

  list() {
    return this.load().subscriptions || [];
  }

  add({
    agentId,
    projectId = null,
    mrIid = null,
    issueIid = null,
    eventType = null,
    author = null,
    ref = null,
  }) {
    if (!agentId) {
      throw new Error("agentId is required for subscription");
    }

    const data = this.load();
    const id = `sub_gl_${crypto.randomBytes(4).toString("hex")}`;
    const sub = {
      id,
      agentId,
      projectId: projectId !== null && projectId !== undefined ? Number(projectId) : null,
      mrIid: mrIid ? Number(mrIid) : null,
      issueIid: issueIid ? Number(issueIid) : null,
      eventType: eventType || null,
      author: author ? String(author).replace(/^@/, "") : null,
      ref: ref ? String(ref) : null,
      createdAt: new Date().toISOString(),
    };

    data.subscriptions = (data.subscriptions || []).filter(
      (s) =>
        !(
          s.agentId === agentId &&
          s.projectId === sub.projectId &&
          s.mrIid === sub.mrIid &&
          s.issueIid === sub.issueIid &&
          s.eventType === sub.eventType &&
          s.author === sub.author &&
          s.ref === sub.ref
        ),
    );

    data.subscriptions.push(sub);
    this.save(data);
    return sub;
  }

  remove({ id, agentId, mrIid, issueIid, ref, author }) {
    const data = this.load();
    const beforeCount = (data.subscriptions || []).length;

    data.subscriptions = (data.subscriptions || []).filter((s) => {
      if (id && s.id === id) return false;
      if (agentId && !id && !mrIid && !issueIid && !ref && !author && s.agentId === agentId) {
        return false;
      }
      if (mrIid && s.mrIid === Number(mrIid) && (!agentId || s.agentId === agentId)) {
        return false;
      }
      if (issueIid && s.issueIid === Number(issueIid) && (!agentId || s.agentId === agentId)) {
        return false;
      }
      if (ref && s.ref === String(ref) && (!agentId || s.agentId === agentId)) {
        return false;
      }
      if (author && s.author === String(author).replace(/^@/, "") && (!agentId || s.agentId === agentId)) {
        return false;
      }
      return true;
    });

    this.save(data);
    return beforeCount - data.subscriptions.length;
  }

  findMatchingAgent(event) {
    const data = this.load();
    const subs = data.subscriptions || [];

    let bestMatch = null;
    let highestScore = -1;

    for (const sub of subs) {
      if (sub.projectId && event.projectId && Number(sub.projectId) !== Number(event.projectId)) {
        continue;
      }

      let score = 0;

      if (sub.mrIid) {
        if (!event.mrIid || Number(sub.mrIid) !== Number(event.mrIid)) continue;
        score += 100;
      }

      if (sub.issueIid) {
        if (!event.issueIid || Number(sub.issueIid) !== Number(event.issueIid)) continue;
        score += 100;
      }

      if (sub.ref) {
        const evRef = event.ref || event.raw?.ref || event.push_data?.ref;
        if (!evRef || String(sub.ref) !== String(evRef)) continue;
        score += 50;
      }

      if (sub.author) {
        const evAuthor = event.author ? String(event.author).replace(/^@/, "") : "";
        if (evAuthor !== sub.author) continue;
        score += 30;
      }

      if (sub.eventType && sub.eventType !== "all") {
        const subType = sub.eventType.toLowerCase();
        const evCat = (event.category || "").toLowerCase();
        const evAct = (event.actionName || "").toLowerCase();
        const matches =
          evCat.includes(subType) ||
          evAct.includes(subType) ||
          (subType === "mr" && event.mrIid) ||
          (subType === "issue" && event.issueIid) ||
          (subType === "pipeline" && (event.targetType === "Pipeline" || evAct.startsWith("pipeline")));

        if (!matches) continue;
        score += 20;
      } else if (sub.eventType === "all") {
        score += 5;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = sub.agentId;
      }
    }

    return bestMatch;
  }
}
