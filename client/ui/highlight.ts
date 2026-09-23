/**
 * A small line highlighter for diffs: keywords, strings, comments, numbers,
 * annotations and type names, by file extension. Not a parser; it only has to
 * make code readable at a glance, and it carries an open block comment from one
 * line to the next so a multi-line Javadoc stays grey.
 */
export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "annotation" | "type";

export interface Token {
  text: string;
  kind: TokenKind;
}

interface Language {
  keywords: Set<string>;
  lineComment: string[];
  block: [string, string] | null;
  /** Characters that open a string, and whether a backtick string may span lines. */
  quotes: string[];
  annotations: boolean;
  types: boolean;
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

const C_LIKE =
  "if else for while do switch case default break continue return new try catch finally throw throws class interface enum extends implements import package public private protected static final abstract void this super null true false instanceof var const let function async await yield typeof in of export from as";

const LANGUAGES: Record<string, Language> = {
  java: {
    keywords: words(
      `${C_LIKE} boolean int long short byte char float double synchronized volatile transient native strictfp assert record sealed permits non-sealed`,
    ),
    lineComment: ["//"],
    block: ["/*", "*/"],
    quotes: ['"', "'"],
    annotations: true,
    types: true,
  },
  kotlin: {
    keywords: words(
      `${C_LIKE} fun val when object companion data sealed override open internal lateinit suspend inline reified is by init`,
    ),
    lineComment: ["//"],
    block: ["/*", "*/"],
    quotes: ['"', "'"],
    annotations: true,
    types: true,
  },
  ts: {
    keywords: words(
      `${C_LIKE} type readonly declare namespace keyof infer never unknown any boolean number string undefined satisfies`,
    ),
    lineComment: ["//"],
    block: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    annotations: true,
    types: true,
  },
  go: {
    keywords: words(
      "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
    ),
    lineComment: ["//"],
    block: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    annotations: false,
    types: true,
  },
  python: {
    keywords: words(
      "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self",
    ),
    lineComment: ["#"],
    block: null,
    quotes: ['"', "'"],
    annotations: true,
    types: true,
  },
  shell: {
    keywords: words(
      "if then else elif fi for while do done case esac in function return local export set unset echo exit",
    ),
    lineComment: ["#"],
    block: null,
    quotes: ['"', "'"],
    annotations: false,
    types: false,
  },
  sql: {
    keywords: words(
      "select from where and or not insert into values update set delete create table alter drop index on join left right inner outer group by order having limit offset as distinct null is in exists case when then else end primary key foreign references default unique constraint begin commit",
    ),
    lineComment: ["--"],
    block: ["/*", "*/"],
    quotes: ["'", '"'],
    annotations: false,
    types: false,
  },
  yaml: {
    keywords: words("true false null yes no"),
    lineComment: ["#"],
    block: null,
    quotes: ['"', "'"],
    annotations: false,
    types: false,
  },
  json: {
    keywords: words("true false null"),
    lineComment: [],
    block: null,
    quotes: ['"'],
    annotations: false,
    types: false,
  },
  xml: {
    keywords: words(""),
    lineComment: [],
    block: ["<!--", "-->"],
    quotes: ['"', "'"],
    annotations: false,
    types: false,
  },
  starlark: {
    keywords: words("load def return if else elif for in and or not True False None pass"),
    lineComment: ["#"],
    block: null,
    quotes: ['"', "'"],
    annotations: false,
    types: false,
  },
};

const EXTENSIONS: Record<string, string> = {
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  ts: "ts",
  tsx: "ts",
  js: "ts",
  jsx: "ts",
  mjs: "ts",
  cjs: "ts",
  go: "go",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  xml: "xml",
  html: "xml",
  vue: "xml",
  bzl: "starlark",
  bazel: "starlark",
};

export function languageOf(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (name === "BUILD" || name === "WORKSPACE" || name === "MODULE.bazel") {
    return "starlark";
  }
  if (name === "Dockerfile" || name.endsWith(".env")) {
    return "shell";
  }
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXTENSIONS[extension] ?? null;
}

/** Whether a block comment is still open at the end of the line. */
export interface HighlightState {
  inBlock: boolean;
}

function push(tokens: Token[], text: string, kind: TokenKind): void {
  if (!text) {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
  } else {
    tokens.push({ text, kind });
  }
}

export function highlightLine(
  text: string,
  language: string | null,
  state: HighlightState = { inBlock: false },
): {
  tokens: Token[];
  state: HighlightState;
} {
  const spec = language ? LANGUAGES[language] : undefined;
  if (!spec) {
    return { tokens: [{ text, kind: "plain" }], state };
  }
  const tokens: Token[] = [];
  let index = 0;
  let inBlock = state.inBlock;
  while (index < text.length) {
    if (inBlock && spec.block) {
      const end = text.indexOf(spec.block[1], index);
      if (end === -1) {
        push(tokens, text.slice(index), "comment");
        return { tokens, state: { inBlock: true } };
      }
      push(tokens, text.slice(index, end + spec.block[1].length), "comment");
      index = end + spec.block[1].length;
      inBlock = false;
      continue;
    }
    const rest = text.slice(index);
    if (spec.block && rest.startsWith(spec.block[0])) {
      inBlock = true;
      continue;
    }
    const lineComment = spec.lineComment.find((marker) => rest.startsWith(marker));
    if (lineComment) {
      push(tokens, rest, "comment");
      break;
    }
    const char = text[index]!;
    if (spec.quotes.includes(char)) {
      let end = index + 1;
      while (end < text.length && text[end] !== char) {
        end += text[end] === "\\" ? 2 : 1;
      }
      push(tokens, text.slice(index, end + 1), "string");
      index = end + 1;
      continue;
    }
    if (spec.annotations && char === "@" && /[A-Za-z]/.test(text[index + 1] ?? "")) {
      const match = rest.match(/^@[\w.]+/)!;
      push(tokens, match[0], "annotation");
      index += match[0].length;
      continue;
    }
    const number = rest.match(/^(0x[\da-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)[lLfFdD]?\b/);
    if (number && !/[\w$]/.test(text[index - 1] ?? "")) {
      push(tokens, number[0], "number");
      index += number[0].length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const value = word[0];
      const keyword = language === "sql" ? spec.keywords.has(value.toLowerCase()) : spec.keywords.has(value);
      push(
        tokens,
        value,
        keyword ? "keyword" : spec.types && /^[A-Z][a-z0-9]/.test(value) ? "type" : "plain",
      );
      index += value.length;
      continue;
    }
    push(tokens, char, "plain");
    index += 1;
  }
  return { tokens, state: { inBlock } };
}

const DARK: Record<TokenKind, string | null> = {
  plain: null,
  keyword: "#ff7b72",
  string: "#a5d6ff",
  comment: "#8b949e",
  number: "#79c0ff",
  annotation: "#d2a8ff",
  type: "#ffa657",
};

const LIGHT: Record<TokenKind, string | null> = {
  plain: null,
  keyword: "#cf222e",
  string: "#0a3069",
  comment: "#6e7781",
  number: "#0550ae",
  annotation: "#8250df",
  type: "#953800",
};

/** GitHub's syntax colours, the dark or light set by how dark the panel background is. */
export function tokenPalette(background: string): Record<TokenKind, string | null> {
  const hex = background.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
  const rgb = background.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/i);
  const [r, g, b] = hex
    ? [hex[1], hex[2], hex[3]].map((part) => parseInt(part!, 16))
    : rgb
      ? [rgb[1], rgb[2], rgb[3]].map(Number)
      : [0, 0, 0];
  const luminance = (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255;
  return luminance < 0.5 ? DARK : LIGHT;
}
