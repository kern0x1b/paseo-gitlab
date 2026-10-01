import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardFilterVariables, toBoardCards, toBoardColumns } from "../server/queries";

const label = (title: string) => ({ title, color: "#000", textColor: "#fff" });
const EMPTY = { search: "", assignee: null, labels: [], author: null, milestone: null };

describe("board filters", () => {
  it("sends nothing for an empty search bar", () => {
    assert.equal(boardFilterVariables({ ...EMPTY, search: " " }), null);
  });

  it("maps search, labels and each assignee choice", () => {
    assert.deepEqual(
      boardFilterVariables({ ...EMPTY, search: "yaleo", assignee: "mira", labels: ["P1", "bug"] }),
      {
        search: "yaleo",
        labelName: ["P1", "bug"],
        assigneeUsername: ["mira"],
      },
    );
    assert.deepEqual(boardFilterVariables({ ...EMPTY, assignee: "@none" }), { assigneeWildcardId: "NONE" });
    assert.deepEqual(boardFilterVariables({ ...EMPTY, assignee: "@any" }), { assigneeWildcardId: "ANY" });
  });

  it("maps the author and every milestone choice", () => {
    assert.deepEqual(boardFilterVariables({ ...EMPTY, author: "sam", milestone: "Sprint 24" }), {
      authorUsername: "sam",
      milestoneTitle: "Sprint 24",
    });
    assert.deepEqual(boardFilterVariables({ ...EMPTY, milestone: "@upcoming" }), {
      milestoneWildcardId: "UPCOMING",
    });
    assert.deepEqual(boardFilterVariables({ ...EMPTY, milestone: "@none" }), { milestoneWildcardId: "NONE" });
  });
});

describe("board columns and cards", () => {
  it("keeps GitLab's column order and defaults what it leaves out", () => {
    const columns = toBoardColumns({
      project: {
        board: {
          lists: {
            nodes: [
              { id: "l1", title: "Open", listType: "backlog", collapsed: null, issuesCount: 5, label: null },
              {
                id: "l2",
                title: "Todo",
                listType: "label",
                collapsed: false,
                issuesCount: 2,
                label: { id: "gid://gitlab/ProjectLabel/1", ...label("Todo") },
              },
              {
                id: "l3",
                title: "Closed",
                listType: "closed",
                collapsed: true,
                issuesCount: null,
                label: null,
              },
            ],
          },
        },
      },
    });
    assert.deepEqual(
      columns.map((column) => [column.title, column.collapsed, column.issuesCount, column.label?.id ?? null]),
      [
        ["Open", false, 5, null],
        ["Todo", false, 2, "gid://gitlab/ProjectLabel/1"],
        ["Closed", true, 0, null],
      ],
    );
  });

  it("drops the column's own label from its cards and keeps the card's global id", () => {
    const page = toBoardCards({
      boardList: {
        label: { title: "Todo" },
        issues: {
          count: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://gitlab/Issue/70",
              iid: "7",
              title: "Fix it",
              reference: "g/p#7",
              webUrl: "https://gitlab.example.com/g/p/-/issues/7",
              dueDate: null,
              confidential: null,
              userNotesCount: 3,
              milestone: { title: "Sprint 24" },
              labels: { nodes: [label("P1"), label("Todo")] },
              assignees: { nodes: [] },
            },
          ],
        },
      },
    });
    const card = page.cards[0]!;
    assert.equal(card.id, "gid://gitlab/Issue/70");
    assert.equal(card.projectPath, "g/p");
    assert.deepEqual(
      card.labels.map((entry) => entry.title),
      ["P1"],
    );
    assert.equal(card.milestone, "Sprint 24");
    assert.equal(page.count, 1);
  });
});
