import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { referenceSearchRpc, searchUsersRpc, uploadRpc } from "../../shared/contract";
import { trailingToken } from "./tokens";

/** The project a composer writes into: mentions, references and uploads resolve against it. */
export const ProjectContext = createContext<string | null>(null);

export function useProjectPath(): string | null {
  return useContext(ProjectContext);
}

function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export interface Suggestion {
  key: string;
  label: string;
  detail: string;
  insert: string;
}

/** What GitLab would offer for the token being typed, the way its own editor does. */
export function useSuggestions(text: string, projectPath: string | null): { suggestions: Suggestion[]; start: number | null } {
  const searchUsers = useRpc(searchUsersRpc);
  const searchReferences = useRpc(referenceSearchRpc);
  const token = useDebounced(trailingToken(text));
  const query = useQuery({
    queryKey: ["gitlab", "suggest", projectPath, token?.trigger, token?.term],
    enabled: Boolean(projectPath && token),
    staleTime: 60_000,
    queryFn: async (): Promise<Suggestion[]> => {
      if (!projectPath || !token) {
        return [];
      }
      if (token.trigger === "@") {
        const { users } = await searchUsers({ projectPath, search: token.term });
        return users.slice(0, 6).map((user) => ({
          key: user.username,
          label: `@${user.username}`,
          detail: user.name,
          insert: `@${user.username} `,
        }));
      }
      const kind = token.trigger === "#" ? "issue" : "mr";
      const { items } = await searchReferences({ projectPath, kind, term: token.term });
      return items.slice(0, 6).map((item) => ({
        key: item.iid,
        label: `${token.trigger}${item.iid}`,
        detail: item.title,
        insert: `${token.trigger}${item.iid} `,
      }));
    },
  });
  const current = trailingToken(text);
  return { suggestions: current && query.data ? query.data : [], start: current?.start ?? null };
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the pasted file."));
    reader.readAsDataURL(file);
  });
}

/**
 * On web, a pasted image goes to GitLab's uploads and its Markdown lands in the
 * text, the way pasting a screenshot works on the site.
 */
export function usePasteUpload(
  element: HTMLElement | null,
  projectPath: string | null,
  onInsert: (markdown: string) => void,
  onError: (message: string) => void,
): boolean {
  const upload = useRpc(uploadRpc);
  const [uploading, setUploading] = useState(false);
  // Latest callbacks through a ref, so a re-render does not re-bind the listener.
  const latest = useRef({ upload, onInsert, onError });
  latest.current = { upload, onInsert, onError };
  useEffect(() => {
    if (Platform.OS !== "web" || !element || !projectPath) {
      return;
    }
    const onPaste = (event: Event) => {
      const items = Array.from((event as ClipboardEvent).clipboardData?.items ?? []);
      const image = items.find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
      if (!image) {
        return;
      }
      event.preventDefault();
      setUploading(true);
      const extension = image.type.split("/")[1] ?? "png";
      void readAsBase64(image)
        .then((base64) =>
          latest.current.upload({
            projectPath,
            filename: image.name && image.name !== "image.png" ? image.name : `pasted-${Date.now()}.${extension}`,
            contentType: image.type,
            base64,
          }),
        )
        .then((result) => latest.current.onInsert(result.markdown))
        .catch((error: unknown) => latest.current.onError(error instanceof Error ? error.message : String(error)))
        .finally(() => setUploading(false));
    };
    element.addEventListener("paste", onPaste);
    return () => element.removeEventListener("paste", onPaste);
  }, [element, projectPath]);
  return uploading;
}
