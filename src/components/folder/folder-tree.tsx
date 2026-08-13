import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ExternalLink, Folder, FolderOpen, Search, X } from "lucide-react";
import type { FolderTreeNode } from "@/shared";
import { filterTree } from "@/lib/tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

type FolderTreeProps = {
  root: FolderTreeNode | undefined;
  selectedPath: string;
  expandedKeys: string[];
  revealKey?: string;
  onToggleExpand: (key: string) => void;
  onSelect: (node: FolderTreeNode) => void;
  onOpenInExplorer: (path: string) => void;
};

/** 可见节点平铺列表：按展开状态展开树。 */
function flattenVisible(
  root: FolderTreeNode | undefined,
  expandedKeys: Set<string>
): FolderTreeNode[] {
  if (!root) return [];
  const result: FolderTreeNode[] = [];
  const walk = (node: FolderTreeNode) => {
    result.push(node);
    if (expandedKeys.has(node.id)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(root);
  return result;
}

export function FolderTree({
  root,
  selectedPath,
  expandedKeys,
  revealKey,
  onToggleExpand,
  onSelect,
  onOpenInExplorer
}: FolderTreeProps) {
  const [keyword, setKeyword] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const expandedSet = useMemo(() => new Set(expandedKeys), [expandedKeys]);

  const visibleTree = useMemo(() => {
    if (!root) return undefined;
    const filtered = filterTree(root, keyword);
    return filtered.tree;
  }, [root, keyword]);

  const visibleNodes = useMemo(
    () => flattenVisible(visibleTree, expandedSet),
    [visibleTree, expandedSet]
  );

  // 选中节点变化时确保可见（滚动 + 可选聚焦）。
  useEffect(() => {
    if (!revealKey || !root) return;
    const node = itemRefs.current.get(revealKey);
    if (node) node.scrollIntoView({ block: "nearest" });
  }, [revealKey, root]);

  // 焦点节点滚动到可视区域。
  useEffect(() => {
    if (focusIndex < 0 || focusIndex >= visibleNodes.length) return;
    itemRefs.current.get(visibleNodes[focusIndex].id)?.scrollIntoView({ block: "nearest" });
  }, [focusIndex, visibleNodes]);

  const selectByIndex = useCallback(
    (index: number) => {
      const node = visibleNodes[index];
      if (!node) return;
      setFocusIndex(index);
      onSelect(node);
    },
    [visibleNodes, onSelect]
  );

  function handleKeyDown(event: React.KeyboardEvent) {
    if (visibleNodes.length === 0) return;
    const current = focusIndex >= 0 && focusIndex < visibleNodes.length ? focusIndex : -1;
    const handled = (action: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    switch (event.key) {
      case "ArrowDown": {
        handled(() => {
          const next = current < 0 ? 0 : Math.min(current + 1, visibleNodes.length - 1);
          selectByIndex(next);
        });
        break;
      }
      case "ArrowUp": {
        handled(() => {
          const next = current <= 0 ? 0 : current - 1;
          selectByIndex(next);
        });
        break;
      }
      case "ArrowRight": {
        handled(() => {
          if (current >= 0) {
            const node = visibleNodes[current];
            if (node.children.length > 0) {
              if (!expandedSet.has(node.id)) {
                onToggleExpand(node.id);
              } else if (current + 1 < visibleNodes.length) {
                selectByIndex(current + 1);
              }
            }
          }
        });
        break;
      }
      case "ArrowLeft": {
        handled(() => {
          if (current >= 0) {
            const node = visibleNodes[current];
            if (node.children.length > 0 && expandedSet.has(node.id)) {
              onToggleExpand(node.id);
            } else if (node.relativePath !== ".") {
              // 折叠或叶子节点：焦点移动到最近的父级（平铺顺序中最后一个前缀匹配项）。
              let parentIndex = -1;
              for (let index = 0; index < visibleNodes.length; index += 1) {
                const candidate = visibleNodes[index];
                if (
                  candidate.relativePath !== node.relativePath &&
                  node.relativePath.startsWith(`${candidate.relativePath}/`)
                ) {
                  parentIndex = index;
                }
              }
              if (parentIndex >= 0) selectByIndex(parentIndex);
            }
          }
        });
        break;
      }
      case "Enter": {
        handled(() => {
          if (current >= 0) selectByIndex(current);
        });
        break;
      }
      case "Home": {
        handled(() => selectByIndex(0));
        break;
      }
      case "End": {
        handled(() => selectByIndex(visibleNodes.length - 1));
        break;
      }
    }
  }

  const clearSearch = () => setKeyword("");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setFocusIndex(-1);
          }}
          placeholder="筛选文件夹"
          className="h-7 pr-7 pl-8 text-xs"
          aria-label="筛选文件夹"
        />
        {keyword && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={clearSearch}
            aria-label="清除文件夹筛选"
          >
            <X />
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={containerRef}
          role="tree"
          aria-label="文件夹树"
          tabIndex={visibleNodes.length > 0 ? 0 : -1}
          className="select-none py-1 pr-1 outline-none"
          onKeyDown={handleKeyDown}
        >
          {visibleTree ? (
            visibleNodes.map((node, index) => {
              const hasChildren = node.children.length > 0;
              const isExpanded = expandedSet.has(node.id);
              const isSelected = selectedPath !== "" && node.path === selectedPath;
              const depth = node.relativePath === "." ? 0 : node.relativePath.split("/").length - 1;
              return (
                <FolderTreeNodeRow
                  key={node.id}
                  node={node}
                  depth={depth}
                  hasChildren={hasChildren}
                  isExpanded={isExpanded}
                  isSelected={isSelected}
                  isFocused={index === focusIndex}
                  isSearchActive={keyword.trim().length > 0}
                  onToggleExpand={() => onToggleExpand(node.id)}
                  onSelect={() => onSelect(node)}
                  onOpenInExplorer={() => onOpenInExplorer(node.path)}
                  onFocus={() => setFocusIndex(index)}
                  registerRef={(element) => {
                    if (element) itemRefs.current.set(node.id, element);
                    else itemRefs.current.delete(node.id);
                  }}
                />
              );
            })
          ) : (
            <div className="px-2 py-3 text-xs text-muted-foreground">没有匹配的文件夹</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

type FolderTreeNodeRowProps = {
  node: FolderTreeNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  isSearchActive: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onOpenInExplorer: () => void;
  onFocus: () => void;
  registerRef: (element: HTMLDivElement | null) => void;
};

function FolderTreeNodeRow({
  node,
  depth,
  hasChildren,
  isExpanded,
  isSelected,
  isFocused,
  isSearchActive,
  onToggleExpand,
  onSelect,
  onOpenInExplorer,
  onFocus,
  registerRef
}: FolderTreeNodeRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={registerRef}
          role="treeitem"
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-selected={isSelected}
          tabIndex={isFocused ? 0 : -1}
          onFocus={onFocus}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onSelect}
          className={cn(
            "group flex h-7 cursor-pointer items-center gap-0.5 rounded-md pr-1.5 text-[13px] outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/60",
            isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            isFocused && !isSelected && "ring-1 ring-ring/40"
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {hasChildren ? (
            <button
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-transform hover:bg-muted-foreground/10",
                isExpanded && "rotate-90"
              )}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
              aria-label={isExpanded ? "折叠" : "展开"}
              title={isExpanded ? "折叠" : "展开"}
            >
              <ChevronRight className="size-3.5" />
            </button>
          ) : (
            <span className="grid size-5 shrink-0 place-items-center">
              <span className="size-3.5" />
            </span>
          )}
          <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
            {isExpanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 flex-1 truncate" onContextMenu={(event) => event.preventDefault()}>
                {node.name}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" align="start">
              <span className="max-w-80 truncate font-mono text-[11px]">{node.path}</span>
            </TooltipContent>
          </Tooltip>
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-1.5 text-[10px] leading-4",
              isSearchActive ? "hidden" : "bg-muted-foreground/15 text-muted-foreground"
            )}
            title={isSearchActive ? undefined : `包含子文件夹共 ${node.totalVideoCount} 个视频`}
          >
            {node.totalVideoCount}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpenInExplorer}>
          <ExternalLink />
          在资源管理器中打开
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
