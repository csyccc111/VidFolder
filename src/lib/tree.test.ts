import { describe, expect, it } from "vitest";
import type { FolderTreeNode } from "../shared";
import { buildFolderTree, collectAncestorKeys, countTreeNodes, filterTree, findTreeNode, isNodeWithin } from "./tree";

function flatten(node: FolderTreeNode): string[] {
  return [node.relativePath, ...node.children.flatMap(flatten)];
}

describe("buildFolderTree", () => {
  it("构造层级结构与累计计数", () => {
    const tree = buildFolderTree("C:\\Videos", [
      { path: "C:\\Videos\\A", relativePath: "A", count: 2 },
      { path: "C:\\Videos\\A\\B", relativePath: "A/B", count: 3 },
      { path: "C:\\Videos\\C", relativePath: "C", count: 5 }
    ]);
    expect(tree).toBeDefined();
    expect(tree!.relativePath).toBe(".");
    expect(tree!.totalVideoCount).toBe(10);
    const a = tree!.children.find((child) => child.name === "A")!;
    expect(a.directVideoCount).toBe(2);
    expect(a.totalVideoCount).toBe(5);
    const b = a.children[0];
    expect(b.name).toBe("B");
    expect(b.totalVideoCount).toBe(3);
  });

  it("没有视频目录时只有根节点", () => {
    const tree = buildFolderTree("C:\\Videos", []);
    expect(tree).toBeDefined();
    expect(tree!.children).toEqual([]);
    expect(tree!.totalVideoCount).toBe(0);
  });

  it("目录大小写差异不产生重复节点", () => {
    const tree = buildFolderTree("C:\\Videos", [
      { path: "C:\\Videos\\A", relativePath: "A", count: 1 },
      { path: "c:\\videos\\a\\B", relativePath: "A/B", count: 1 }
    ]);
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].totalVideoCount).toBe(2);
  });
});

describe("filterTree", () => {
  const tree = buildFolderTree("C:\\Videos", [
    { path: "C:\\Videos\\学习", relativePath: "学习", count: 1 },
    { path: "C:\\Videos\\学习\\教程", relativePath: "学习/教程", count: 1 },
    { path: "C:\\Videos\\电影", relativePath: "电影", count: 1 }
  ])!;

  it("空关键词返回原树", () => {
    const result = filterTree(tree, "  ");
    expect(result.tree).toBe(tree);
    expect(result.matchedKeys.size).toBe(0);
  });

  it("匹配节点及其祖先被保留", () => {
    const result = filterTree(tree, "教程");
    expect(result.tree).toBeDefined();
    const paths = flatten(result.tree!);
    expect(paths).toContain(".");
    expect(paths).toContain("学习");
    expect(paths).toContain("学习/教程");
    expect(paths).not.toContain("电影");
  });

  it("匹配祖先时保留整棵子树", () => {
    const result = filterTree(tree, "学习");
    expect(result.tree!.children).toHaveLength(1);
    expect(result.tree!.children[0].children).toHaveLength(1);
  });
});

describe("collectAncestorKeys / findTreeNode", () => {
  const tree = buildFolderTree("C:\\Videos", [
    { path: "C:\\Videos\\A\\B", relativePath: "A/B", count: 1 },
    { path: "C:\\Videos\\A\\C", relativePath: "A/C", count: 1 }
  ])!;

  it("查找节点忽略大小写", () => {
    expect(findTreeNode(tree, "c:\\videos\\a\\b")).toBeDefined();
    expect(findTreeNode(tree, "C:\\Videos\\A\\C")).toBeDefined();
    expect(findTreeNode(tree, "C:\\Videos\\X")).toBeUndefined();
  });

  it("祖先链自根到目标", () => {
    expect(collectAncestorKeys(tree, "C:\\Videos\\A\\B")).toEqual(["c:/videos", "c:/videos/a"]);
  });

  it("countTreeNodes 统计全部节点", () => {
    expect(countTreeNodes(tree)).toBe(4);
  });

  it("isNodeWithin 判断子树范围", () => {
    const a = findTreeNode(tree, "C:\\Videos\\A")!;
    const b = findTreeNode(tree, "C:\\Videos\\A\\B")!;
    const c = findTreeNode(tree, "C:\\Videos\\A\\C")!;
    expect(isNodeWithin(b, a.path)).toBe(true);
    expect(isNodeWithin(c, a.path)).toBe(true);
    expect(isNodeWithin(a, b.path)).toBe(false);
  });
});
