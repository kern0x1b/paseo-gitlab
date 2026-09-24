/**
 * The issue board: its columns, its cards, and the search bar as GitLab's board filter.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardFilterVariables, toBoardCards, toBoardColumns } from "../server/queries";

const label = (title: string) => ({ title, color: "#000", textColor: "#fff" });

describe("board filters", () => {
  it("sends nothing for an empty search bar", () => {
    assert.equal(boardFilterVariables({ search: " ", assignee: null, labels: [] }), null);
  });

  it("maps search, labels and each assignee choice", () => {
    assert.deepEqual(boardFilterVariables({ search: "yaleo", assignee: "mira", labels: ["P1", "bug"] }), {
      search: "yaleo",
      labelName: ["P1", "bug"],
      assigneeUsername: ["mira"],
    });
    assert.deepEqual(boardFilterVariables({ search: "", assignee: "@none", labels: [] }), {
      assigneeWildcardId: "NONE",
    });
    assert.deepEqual(boardFilterVariables({ search: "", assignee: "@any", labels: [] }), {
      assigneeWildcardId: "ANY",
    });
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
                label: label("Todo"),
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
      columns.map((column) => [column.title, column.collapsed, column.issuesCount]),
      [
        ["Open", false, 5],
        ["Todo", false, 2],
        ["Closed", true, 0],
      ],
    );
  });

  it("drops the column's own label from its cards", () => {
    const page = toBoardCards({
      boardList: {
        label: { title: "Todo" },
        issues: {
          count: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
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
    assert.equal(page.cards[0]!.projectPath, "g/p");
    assert.deepEqual(
      page.cards[0]!.labels.map((entry) => entry.title),
      ["P1"],
    );
    assert.equal(page.cards[0]!.milestone, "Sprint 24");
    assert.equal(page.count, 1);
  });
});
