import type { Connection, Fetch } from "./gitlab";

/**
 * Uploaded images in private projects need authentication, and the client has no
 * GitLab session: the web path (`/-/project/:id/uploads/...`) only answers a
 * browser cookie. The token gets them through
 * `GET /projects/:id/uploads/:secret/:filename`, which serves the file as
 * `application/octet-stream`, so the image type is read from the bytes.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

/** Raster formats only. SVG can carry script, so it is never turned into a data URL. */
export function imageTypeOf(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) {
    return "image/png";
  }
  if (starts(0xff, 0xd8, 0xff)) {
    return "image/jpeg";
  }
  if (starts(0x47, 0x49, 0x46, 0x38)) {
    return "image/gif";
  }
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** `/-/project/69/uploads/<secret>/<file>` or `/<namespace>/<project>/uploads/<secret>/<file>`. */
export function uploadApiPath(src: string, host: string): string | null {
  let url: URL;
  try {
    url = new URL(src, host);
  } catch {
    return null;
  }
  // Never send the token anywhere but the connected host.
  if (url.origin !== host) {
    return null;
  }
  const byId = url.pathname.match(/^\/-\/project\/(\d+)\/uploads\/([0-9a-f]{16,64})\/([^/]+)$/);
  if (byId) {
    return `/projects/${byId[1]}/uploads/${byId[2]}/${byId[3]}`;
  }
  const byPath = url.pathname.match(/^\/(.+?)\/uploads\/([0-9a-f]{16,64})\/([^/]+)$/);
  if (byPath && !byPath[1]!.startsWith("-/")) {
    return `/projects/${encodeURIComponent(byPath[1]!)}/uploads/${byPath[2]}/${byPath[3]}`;
  }
  return null;
}

export async function fetchImage(
  connection: Connection,
  src: string,
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  const path = uploadApiPath(src, connection.host);
  if (!path) {
    return null;
  }
  try {
    const response = await fetchImpl(`${connection.host}/api/v4${path}`, {
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = imageTypeOf(bytes);
    if (!type || bytes.length > MAX_IMAGE_BYTES) {
      return null;
    }
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
