import type { DiffFile } from "../../shared/contract";

export interface TreeNode {
  /** One path segment, or several joined when a folder holds only another folder. */
  name: string;
  path: string;
  children: TreeNode[];
  file: DiffFile | null;
}

/**
 * The changed files as a folder tree, the way GitLab's file browser shows them:
 * folders before files, and a chain of single-folder directories collapsed into
 * one row (`services/ws-support-ai/src`).
 */
export function buildTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [], file: null };
  for (const file of files) {
    const parts = file.newPath.split("/");
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let child = node.children.find(
        (candidate) => candidate.name === part && (candidate.file !== null) === isFile,
      );
      if (!child) {
        child = { name: part, path, children: [], file: isFile ? file : null };
        node.children.push(child);
      }
      node = child;
    });
  }
  const compress = (node: TreeNode): TreeNode => {
    let current = node;
    while (current.file === null && current.children.length === 1 && current.children[0]!.file === null) {
      const only = current.children[0]!;
      current = { ...only, name: current.name ? `${current.name}/${only.name}` : only.name };
    }
    const children = current.children.map(compress).sort((a, b) => {
      if ((a.file === null) !== (b.file === null)) {
        return a.file === null ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return { ...current, children };
  };
  return compress(root).children.length === 1 && root.children[0]?.file === null
    ? [compress(root.children[0]!)]
    : compress(root).children;
}
