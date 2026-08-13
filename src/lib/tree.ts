import type { FolderTreeNode } from "../shared.js";
import { getDirectoryName, getRelativeDirectory, isWithinDirectory, normalizePath, trimTrailingSeparators } from "./path.js";

export type BuildTreeOptions = {
  /** 是否需要记录每个节点的完整路径（path）。 */
};

export type FlatDirectoryInfo = {
  path: string;
  relativePath: string;
  count: number;
};

/**
 * 由扫描结果中的目录构造层级文件夹树。
 * 只包含实际包含视频的目录及其必要祖先；根节点承担"全部视频"语义。
 */
export function buildFolderTree(rootPath: string, directories: FlatDirectoryInfo[]): FolderTreeNode | undefined {
  const root = trimTrailingSeparators(rootPath);
  if (!root) return undefined;
  const rootKey = normalizePath(root);

  const nodeMap = new Map<string, FolderTreeNode>();
  const rootNode: FolderTreeNode = {
    id: rootKey,
    path: root,
    name: "全部视频",
    relativePath: ".",
    directVideoCount: 0,
    totalVideoCount: 0,
    children: []
  };
  nodeMap.set(rootKey, rootNode);

  const ensureNode = (path: string, relativePath: string): FolderTreeNode => {
    const key = normalizePath(path);
    const existing = nodeMap.get(key);
    if (existing) return existing;
    const node: FolderTreeNode = {
      id: key,
      path,
      name: getDirectoryName(relativePath),
      relativePath,
      directVideoCount: 0,
      totalVideoCount: 0,
      children: []
    };
    nodeMap.set(key, node);
    return node;
  };

  for (const directory of directories) {
    const relativePath = getRelativeDirectory(root, directory.path);
    if (relativePath === ".") {
      rootNode.directVideoCount += directory.count;
      rootNode.totalVideoCount += directory.count;
      continue;
    }
    const parts = relativePath.split("/").filter(Boolean);
    let parent: FolderTreeNode = rootNode;
    let currentPath = root;
    for (let index = 0; index < parts.length; index += 1) {
      currentPath = `${currentPath}\\${parts[index]}`;
      const node = ensureNode(currentPath, parts.slice(0, index + 1).join("/"));
      if (!parent.children.some((child) => child.id === node.id)) {
        parent.children.push(node);
      }
      if (index === parts.length - 1) {
        node.directVideoCount += directory.count;
      }
      node.totalVideoCount += directory.count;
      parent = node;
    }
  }

  sortChildren(rootNode);
  // 根节点承担"全部视频"语义：总数为全部后代累计之和。
  rootNode.totalVideoCount = sumTotal(rootNode);
  return rootNode;
}

function sumTotal(node: FolderTreeNode): number {
  return node.children.reduce((sum, child) => sum + child.directVideoCount + sumTotal(child), 0);
}

function sortChildren(node: FolderTreeNode) {
  node.children.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  for (const child of node.children) sortChildren(child);
}

/** 树节点总数（含根）。 */
export function countTreeNodes(root: FolderTreeNode): number {
  let count = 1;
  for (const child of root.children) count += countTreeNodes(child);
  return count;
}

/** 收集树中全部节点路径（规范化键）。 */
export function collectNodeKeys(root: FolderTreeNode): string[] {
  const keys: string[] = [root.id];
  for (const child of root.children) keys.push(...collectNodeKeys(child));
  return keys;
}

export type TreeFilterResult = {
  tree: FolderTreeNode | undefined;
  matchedKeys: Set<string>;
};

/**
 * 按名称过滤文件夹树：保留匹配节点及其祖先。
 * 过滤后树中每个节点保持原始层级结构，非匹配分支被裁剪。
 */
export function filterTree(root: FolderTreeNode, keyword: string): TreeFilterResult {
  const trimmed = keyword.trim().toLocaleLowerCase();
  if (!trimmed) {
    return { tree: root, matchedKeys: new Set() };
  }
  const visited = new Set<string>();
  const prune = (node: FolderTreeNode): FolderTreeNode | undefined => {
    const matched = node.name.toLocaleLowerCase().includes(trimmed);
    // 匹配节点保留整棵子树（其子节点不再逐一剪枝，保持完整结构）。
    if (matched) {
      markVisited(node);
      return node;
    }
    const keptChildren: FolderTreeNode[] = [];
    for (const child of node.children) {
      const kept = prune(child);
      if (kept) {
        keptChildren.push(kept);
        visited.add(child.id);
      }
    }
    if (keptChildren.length > 0) {
      visited.add(node.id);
      return { ...node, children: keptChildren };
    }
    return undefined;
  };
  const markVisited = (node: FolderTreeNode) => {
    visited.add(node.id);
    for (const child of node.children) markVisited(child);
  };
  const tree = prune(root);
  return { tree, matchedKeys: visited };
}

/** 从树中查找指定路径的节点（规范化路径比较）。 */
export function findTreeNode(root: FolderTreeNode | undefined, targetPath: string): FolderTreeNode | undefined {
  if (!root) return undefined;
  const target = normalizePath(targetPath);
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.id === target) return node;
    for (const child of node.children) stack.push(child);
  }
  return undefined;
}

/** 返回目标节点的祖先链（自根到目标），用于自动展开。 */
export function collectAncestorKeys(root: FolderTreeNode, targetPath: string): string[] {
  const ancestors: string[] = [];
  const target = normalizePath(targetPath);
  const walk = (node: FolderTreeNode): boolean => {
    if (node.id === target) return true;
    for (const child of node.children) {
      if (walk(child)) {
        ancestors.push(node.id);
        return true;
      }
    }
    return false;
  };
  walk(root);
  return ancestors.reverse();
}

/** 节点是否在选中目录内（含自身）。 */
export function isNodeWithin(node: FolderTreeNode, selectedPath: string | undefined): boolean {
  if (!selectedPath) return true;
  return isWithinDirectory(node.path, selectedPath);
}
