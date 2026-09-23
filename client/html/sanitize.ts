/**
 * Rebuilds GitLab's rendered HTML from an allowlist before it enters Paseo's
 * window. GitLab sanitizes its own output already; this is the second layer, and
 * the reason it rebuilds rather than filters is that nothing it does not know
 * about can survive: no scripts, no event handlers, no inline styles, no
 * `javascript:` URLs, no forms.
 *
 * Unknown elements (`gl-emoji`, custom wrappers) are unwrapped so their text is
 * kept; the elements below are dropped with everything inside them.
 */
const DROPPED = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "object",
  "embed",
  "form",
  "textarea",
  "select",
  "button",
  "svg",
  "math",
  "link",
  "meta",
  "noscript",
  "template",
  "video",
  "audio",
  "source",
  "canvas",
]);

const KEPT = new Set([
  "p",
  "br",
  "hr",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "del",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "span",
  "div",
  "details",
  "summary",
  "input",
  "sup",
  "sub",
  "kbd",
  "mark",
  "dl",
  "dt",
  "dd",
]);

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export interface SanitizeOptions {
  /** Origin the relative links and image paths resolve against. */
  host: string;
  /** Called for images on the GitLab host, which need the token to load. */
  loadImage(url: string, image: HTMLImageElement): void;
}

export function safeUrl(raw: string | null, host: string): string | null {
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw, host);
    return LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function positiveInt(raw: string | null): string | null {
  return raw && /^\d{1,5}$/.test(raw) ? raw : null;
}

function cleanImage(source: Element, options: SanitizeOptions): HTMLImageElement | null {
  // GitLab lazy-loads: `src` is a 1px placeholder and the real path is in `data-src`.
  const url = safeUrl(source.getAttribute("data-src") ?? source.getAttribute("src"), options.host);
  if (!url || url.startsWith("mailto:")) {
    return null;
  }
  const image = document.createElement("img");
  const alt = source.getAttribute("alt");
  if (alt) {
    image.alt = alt;
  }
  for (const dimension of ["width", "height"] as const) {
    const value = positiveInt(source.getAttribute(dimension));
    if (value) {
      image.setAttribute(dimension, value);
    }
  }
  image.referrerPolicy = "no-referrer";
  image.loading = "lazy";
  if (new URL(url).origin === options.host) {
    options.loadImage(url, image);
  } else {
    image.src = url;
  }
  return image;
}

function cleanElement(source: Element, tag: string, options: SanitizeOptions): Element | null {
  if (tag === "img") {
    return cleanImage(source, options);
  }
  if (tag === "input") {
    if (source.getAttribute("type") !== "checkbox") {
      return null;
    }
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkbox.checked = source.hasAttribute("checked");
    return checkbox;
  }
  const clean = document.createElement(tag);
  if (tag === "a") {
    const href = safeUrl(source.getAttribute("href"), options.host);
    if (href) {
      clean.setAttribute("href", href);
      clean.setAttribute("data-external", "true");
    }
    const title = source.getAttribute("title");
    if (title) {
      clean.setAttribute("title", title);
    }
  } else if (tag === "ol") {
    const start = positiveInt(source.getAttribute("start"));
    if (start) {
      clean.setAttribute("start", start);
    }
  } else if (tag === "td" || tag === "th") {
    const align = source.getAttribute("align");
    if (align === "left" || align === "right" || align === "center") {
      clean.setAttribute("align", align);
    }
  } else if (tag === "details" && source.hasAttribute("open")) {
    clean.setAttribute("open", "");
  }
  return clean;
}

function appendClean(node: Node, parent: Node, options: SanitizeOptions): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROPPED.has(tag)) {
    return;
  }
  if (!KEPT.has(tag)) {
    for (const child of Array.from(element.childNodes)) {
      appendClean(child, parent, options);
    }
    return;
  }
  const clean = cleanElement(element, tag, options);
  if (!clean) {
    return;
  }
  for (const child of Array.from(element.childNodes)) {
    appendClean(child, clean, options);
  }
  parent.appendChild(clean);
}

export function sanitizeHtml(html: string, options: SanitizeOptions): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(parsed.body.childNodes)) {
    appendClean(child, fragment, options);
  }
  return fragment;
}

/** Plain text for clients without a DOM (the native apps). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|tr|div|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#x000A;/gi, "\n")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
