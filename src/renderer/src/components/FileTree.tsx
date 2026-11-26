import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import type { TreeNode } from '../../../shared/types';
interface Props {
  root: string;
  activePath: string | null;
  onOpen(path: string): void;
  onError(error: unknown): void;
  refresh: number;
}
export function FileTree({ root, activePath, onOpen, onError, refresh }: Props) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  useEffect(() => {
    let cancelled = false;
    window.md
      .list(root)
      .then((nodes) => {
        if (!cancelled) setNodes(nodes);
      })
      .catch(onError);
    return () => {
      cancelled = true;
    };
  }, [root, refresh, onError]);
  return (
    <div className="file-tree" role="group">
      {nodes.map((node) => (
        <TreeEntry
          key={node.path}
          node={node}
          activePath={activePath}
          onOpen={onOpen}
          onError={onError}
          refresh={refresh}
        />
      ))}
      {nodes.length === 0 && <p className="empty-small">—</p>}
    </div>
  );
}
function TreeEntry({
  node,
  activePath,
  onOpen,
  onError,
  refresh,
}: Omit<Props, 'root'> & { node: TreeNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        className={`tree-node ${activePath === node.path ? 'selected' : ''}`}
        title={node.path}
        aria-expanded={node.directory ? expanded : undefined}
        onClick={() => (node.directory ? setExpanded(!expanded) : onOpen(node.path))}
      >
        {node.directory ? (
          expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {node.directory ? (
          expanded ? (
            <FolderOpen size={15} />
          ) : (
            <Folder size={15} />
          )
        ) : (
          <FileText size={15} />
        )}
        <span>{node.name}</span>
      </button>
      {expanded && (
        <div className="tree-children">
          <FileTree
            root={node.path}
            activePath={activePath}
            onOpen={onOpen}
            onError={onError}
            refresh={refresh}
          />
        </div>
      )}
    </div>
  );
}
