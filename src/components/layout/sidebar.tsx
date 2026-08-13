import { useCallback, useRef } from "react";
import { ChevronsDownUp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { FolderHistoryEntry, FolderTreeNode } from "@/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { QuickAccess } from "@/components/folder/quick-access";
import { FolderTree } from "@/components/folder/folder-tree";
import { cn } from "@/lib/utils";

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 250;

type SidebarProps = {
  open: boolean;
  width: number;
  history: FolderHistoryEntry[];
  invalidPaths: Set<string>;
  currentPath: string;
  treeRoot: FolderTreeNode | undefined;
  selectedDirectory: string;
  expandedKeys: string[];
  revealKey?: string;
  onToggleSidebar: () => void;
  onResizeWidth: (width: number) => void;
  onOpenHistory: (path: string) => void;
  onTogglePin: (path: string) => void;
  onRemoveHistory: (path: string) => void;
  onToggleExpand: (key: string) => void;
  onSelectDirectory: (node: FolderTreeNode) => void;
  onCollapseAll: () => void;
  onOpenInExplorer: (path: string) => void;
};

export function Sidebar({
  open,
  width,
  history,
  invalidPaths,
  currentPath,
  treeRoot,
  selectedDirectory,
  expandedKeys,
  revealKey,
  onToggleSidebar,
  onResizeWidth,
  onOpenHistory,
  onTogglePin,
  onRemoveHistory,
  onToggleExpand,
  onSelectDirectory,
  onCollapseAll,
  onOpenInExplorer
}: SidebarProps) {
  const dragging = useRef(false);

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragging.current = true;
      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, moveEvent.clientX));
        onResizeWidth(Math.round(next));
      };
      const onMouseUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [onResizeWidth]
  );

  if (!open) {
    return (
      <div className="shrink-0 border-r bg-sidebar">
        <div className="flex h-9 items-center px-1.5">
          <Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="展开侧栏" title="展开侧栏">
            <PanelLeftOpen />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full shrink-0 border-r bg-sidebar" style={{ width }}>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between pr-1.5 pl-2">
          <span className="text-xs font-semibold text-muted-foreground">浏览</span>
          <Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="收起侧栏" title="收起侧栏">
            <PanelLeftClose />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 px-1.5 pb-2">
            <QuickAccess
              history={history}
              invalidPaths={invalidPaths}
              currentPath={currentPath}
              onOpen={onOpenHistory}
              onTogglePin={onTogglePin}
              onRemove={onRemoveHistory}
            />
            <Separator className="my-2" />
            <div className="flex items-center justify-between px-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">文件夹</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onCollapseAll}
                disabled={!treeRoot}
                aria-label="全部折叠"
                title="全部折叠"
              >
                <ChevronsDownUp />
              </Button>
            </div>
            <FolderTree
              root={treeRoot}
              selectedPath={selectedDirectory}
              expandedKeys={expandedKeys}
              revealKey={revealKey}
              onToggleExpand={onToggleExpand}
              onSelect={onSelectDirectory}
              onOpenInExplorer={onOpenInExplorer}
            />
          </div>
        </ScrollArea>
      </div>
      <div
        className={cn("w-1 cursor-col-resize self-stretch hover:bg-ring/40")}
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
      />
    </div>
  );
}
