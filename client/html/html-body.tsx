import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import React, { useEffect, useRef } from "react";
import { Platform, Text } from "react-native";
import { imageRpc } from "../../shared/contract";
import { htmlToText, sanitizeHtml } from "./sanitize";

const STYLE_ID = "paseo-gitlab-markdown";

/**
 * Scoped under `.pgl-md` and painted from CSS variables the container sets, so a
 * theme switch recolours every rendered body without re-injecting the sheet.
 */
const CSS = `
.pgl-md { color: var(--pgl-fg); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.pgl-md > :first-child { margin-top: 0; }
.pgl-md > :last-child { margin-bottom: 0; }
.pgl-md p, .pgl-md ul, .pgl-md ol, .pgl-md pre, .pgl-md blockquote, .pgl-md table, .pgl-md details { margin: 0 0 8px; }
.pgl-md h1, .pgl-md h2, .pgl-md h3, .pgl-md h4, .pgl-md h5, .pgl-md h6 { margin: 12px 0 6px; font-weight: 600; line-height: 1.3; }
.pgl-md h1 { font-size: 17px; } .pgl-md h2 { font-size: 15px; } .pgl-md h3 { font-size: 14px; } .pgl-md h4, .pgl-md h5, .pgl-md h6 { font-size: 13px; }
.pgl-md ul, .pgl-md ol { padding-left: 20px; }
.pgl-md li { margin: 2px 0; }
.pgl-md li > input[type="checkbox"] { margin: 0 6px 0 -18px; vertical-align: middle; }
.pgl-md a { color: var(--pgl-link); text-decoration: none; cursor: pointer; }
.pgl-md a:hover { text-decoration: underline; }
.pgl-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: var(--pgl-code); border-radius: 4px; padding: 1px 4px; }
.pgl-md pre { background: var(--pgl-code); border-radius: 6px; padding: 8px 10px; overflow-x: auto; }
.pgl-md pre code { background: none; padding: 0; white-space: pre; }
.pgl-md blockquote { border-left: 3px solid var(--pgl-border); padding-left: 10px; color: var(--pgl-muted); }
.pgl-md table { border-collapse: collapse; display: block; overflow-x: auto; }
.pgl-md th, .pgl-md td { border: 1px solid var(--pgl-border); padding: 4px 8px; }
.pgl-md th { font-weight: 600; }
.pgl-md hr { border: 0; border-top: 1px solid var(--pgl-border); margin: 12px 0; }
.pgl-md img { max-width: 100%; height: auto; border-radius: 4px; }
.pgl-md summary { cursor: pointer; }
.pgl-md .pgl-image-link { display: inline-block; padding: 2px 8px; border: 1px dashed var(--pgl-border); border-radius: 4px; }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Per window: the same screenshot shows up in the list of every refresh. */
const imageCache = new Map<string, Promise<string | null>>();

function replaceWithLink(image: HTMLImageElement, url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("data-external", "true");
  link.className = "pgl-image-link";
  link.textContent = `🖼 ${image.alt || "image"} — open in GitLab`;
  image.replaceWith(link);
}

export function HtmlBody({ html, host, theme }: { html: string; host: string; theme: PluginTheme }) {
  const container = useRef<HTMLDivElement | null>(null);
  const fetchImage = useRpc(imageRpc);
  // Read through a ref so a new function identity per render does not rebuild the body.
  const fetchImageRef = useRef(fetchImage);
  fetchImageRef.current = fetchImage;

  useEffect(() => {
    const element = container.current;
    if (Platform.OS !== "web" || !element) {
      return;
    }
    ensureStyles();
    let cancelled = false;
    const loadImage = (url: string, image: HTMLImageElement) => {
      let pending = imageCache.get(url);
      if (!pending) {
        pending = fetchImageRef
          .current({ src: url })
          .then((result) => result.dataUrl)
          .catch(() => null);
        imageCache.set(url, pending);
      }
      void pending.then((dataUrl) => {
        if (cancelled) {
          return;
        }
        if (dataUrl) {
          image.src = dataUrl;
        } else {
          replaceWithLink(image, url);
        }
      });
    };
    element.replaceChildren(sanitizeHtml(html, { host, loadImage }));
    return () => {
      cancelled = true;
    };
  }, [html, host]);

  if (Platform.OS !== "web") {
    return (
      <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 19 }}>{htmlToText(html)}</Text>
    );
  }

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest("a[data-external]");
    if (!link) {
      return;
    }
    event.preventDefault();
    const href = link.getAttribute("href");
    if (href) {
      void openExternalUrl(href);
    }
  };

  const variables = {
    "--pgl-fg": theme.colors.foreground,
    "--pgl-muted": theme.colors.foregroundMuted,
    "--pgl-border": theme.colors.border,
    "--pgl-code": theme.colors.surface2,
    "--pgl-link": theme.colors.accent,
  } as React.CSSProperties;

  return React.createElement("div", { ref: container, className: "pgl-md", style: variables, onClick });
}
