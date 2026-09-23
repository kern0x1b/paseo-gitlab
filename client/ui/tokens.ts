/** `@user`, `#123` or `!123` being typed at the end of the text. */
export function trailingToken(text: string): { trigger: "@" | "#" | "!"; term: string; start: number } | null {
  const match = text.match(/(^|\s)([@#!])([\w.\-/]*)$/);
  if (!match) {
    return null;
  }
  return { trigger: match[2] as "@" | "#" | "!", term: match[3] ?? "", start: text.length - (match[3]?.length ?? 0) - 1 };
}
