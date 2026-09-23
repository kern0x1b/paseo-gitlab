/**
 * The diff highlighter: tokens by language, and block comments across lines.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { highlightLine, languageOf } from "../client/ui/highlight";

const kinds = (text: string, language: string | null, inBlock = false) =>
  highlightLine(text, language, { inBlock }).tokens.filter((token) => token.text.trim()).map((token) => [token.kind, token.text.trim()]);

describe("languageOf", () => {
  it("maps extensions and Bazel file names", () => {
    assert.equal(languageOf("src/a/ChatContext.java"), "java");
    assert.equal(languageOf("js/app/x.tsx"), "ts");
    assert.equal(languageOf("services/x/BUILD"), "starlark");
    assert.equal(languageOf("README"), null);
  });
});

describe("highlightLine", () => {
  it("splits Java into keywords, types, strings, numbers and annotations", () => {
    assert.deepEqual(kinds('@Override private static final String NAME = "x"; int n = 42;', "java"), [
      ["annotation", "@Override"],
      ["keyword", "private"],
      ["keyword", "static"],
      ["keyword", "final"],
      ["type", "String"],
      ["plain", "NAME ="],
      ["string", '"x"'],
      ["plain", ";"],
      ["keyword", "int"],
      ["plain", "n ="],
      ["number", "42"],
      ["plain", ";"],
    ]);
  });

  it("treats line comments and escaped quotes correctly", () => {
    assert.deepEqual(kinds('return "a\\"b"; // done', "java"), [
      ["keyword", "return"],
      ["string", '"a\\"b"'],
      ["plain", ";"],
      ["comment", "// done"],
    ]);
  });

  it("carries an open block comment to the next line", () => {
    const first = highlightLine("int a; /** starts", "java");
    assert.equal(first.state.inBlock, true);
    const second = highlightLine(" * still */ return a;", "java", first.state);
    assert.equal(second.tokens[0]?.kind, "comment");
    assert.equal(second.state.inBlock, false);
    assert.ok(second.tokens.some((token) => token.kind === "keyword" && token.text === "return"));
  });

  it("leaves unknown files plain", () => {
    assert.deepEqual(highlightLine("anything at all", null).tokens, [{ text: "anything at all", kind: "plain" }]);
  });
});
