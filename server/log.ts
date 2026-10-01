import type { JobLog, LogColor, LogLine } from "../shared/contract";

export const MAX_LOG_LINES = 3000;

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z [0-9a-f]{2}[OE](\+?) ?/;
const SECTION_START = /section_start:\d+:[^\r\s[]+(?:\[[^\]]*\])?\r?/;
const SECTION_END = /section_end:\d+:[^\r\s]+\r?/g;
const ESCAPE = /\x1b\[([0-9;?]*)([A-Za-z])/g;

const COLORS: Record<number, LogColor | null> = {
  30: "gray",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: null,
  90: "gray",
  91: "red",
  92: "green",
  93: "yellow",
  94: "blue",
  95: "magenta",
  96: "cyan",
  97: null,
};

interface Style {
  color: LogColor | null;
  bold: boolean;
}

function applySgr(codes: string, style: Style): Style {
  let { color, bold } = style;
  for (const part of (codes || "0").split(";")) {
    const code = Number(part || 0);
    if (code === 0) {
      color = null;
      bold = false;
    } else if (code === 1) {
      bold = true;
    } else if (code === 22) {
      bold = false;
    } else if (code === 39) {
      color = null;
    } else if (code in COLORS) {
      color = COLORS[code] ?? null;
    }
  }
  return { color, bold };
}

function segmentsOf(text: string, style: Style): { segments: LogLine["segments"]; style: Style } {
  const segments: LogLine["segments"] = [];
  let current = style;
  let last = 0;
  const push = (chunk: string) => {
    if (!chunk) {
      return;
    }
    const previous = segments[segments.length - 1];
    if (previous && previous.color === current.color && previous.bold === current.bold) {
      previous.text += chunk;
    } else {
      segments.push({ text: chunk, color: current.color, bold: current.bold });
    }
  };
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(last, match.index));
    if (match[2] === "m") {
      current = applySgr(match[1] ?? "", current);
    }
    last = (match.index ?? 0) + match[0].length;
  }
  push(text.slice(last));
  return { segments, style: current };
}

export function parseJobLog(raw: string, maxLines: number = MAX_LOG_LINES): JobLog {
  const physical: { text: string; section: boolean }[] = [];
  for (const rawLine of raw.split("\n")) {
    const stamp = rawLine.match(TIMESTAMP);
    let text = stamp ? rawLine.slice(stamp[0].length) : rawLine;
    const continuation = stamp?.[1] === "+";

    let section = false;
    if (SECTION_START.test(text)) {
      text = text.replace(SECTION_START, "");
      section = true;
    }
    text = text.replace(SECTION_END, "");
    text = text.replace(/\r+$/, "");
    const redraw = text.lastIndexOf("\r");
    if (redraw >= 0) {
      text = text.slice(redraw + 1);
    }

    const previous = physical[physical.length - 1];
    if (continuation && previous) {
      previous.text += text;
      previous.section ||= section;
    } else {
      physical.push({ text, section });
    }
  }

  let style: Style = { color: null, bold: false };
  const lines: LogLine[] = [];
  for (const { text, section } of physical) {
    const parsed = segmentsOf(text, style);
    style = parsed.style;
    if (section && parsed.segments.every((segment) => !segment.text.trim())) {
      continue;
    }
    lines.push({ section, segments: parsed.segments });
  }
  while (lines.length > 0 && lines[lines.length - 1]!.segments.every((segment) => !segment.text.trim())) {
    lines.pop();
  }
  return { lines: lines.slice(-maxLines), totalLines: lines.length };
}
