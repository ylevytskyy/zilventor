import type { Result } from '@zilventor/shared';
import { ok, err } from '@zilventor/shared';

export type GraphNode = {
  inputRelPath: string;
  kind: 'part' | 'assembly';
  /** Resolved sibling-relative refs from this node, with null refs filtered out
   *  by the caller. Each ref is an inputRelPath that must also appear in nodes. */
  refs: string[];
};

export type DependencyGraph = {
  topoOrder: GraphNode[];
};

export function buildDependencyGraph(nodes: GraphNode[]): Result<DependencyGraph, string> {
  const byPath = new Map<string, GraphNode>();
  for (const n of nodes) byPath.set(n.inputRelPath, n);

  // Validate refs all exist
  for (const n of nodes) {
    for (const r of n.refs) {
      if (!byPath.has(r)) {
        return err(`${n.inputRelPath}: missing referenced file ${r}`);
      }
    }
  }

  // Topo sort with cycle detection (iterative DFS, post-order push)
  const WHITE = 0,
    GREY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.inputRelPath, WHITE);
  const order: GraphNode[] = [];
  const stack: { path: string; iter: number }[] = [];

  function dfs(start: string): string | null {
    stack.push({ path: start, iter: 0 });
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const node = byPath.get(top.path)!;
      if (top.iter === 0) {
        if (color.get(top.path) === BLACK) {
          stack.pop();
          continue;
        }
        color.set(top.path, GREY);
      }
      if (top.iter < node.refs.length) {
        const next = node.refs[top.iter]!;
        top.iter++;
        if (color.get(next) === GREY) {
          return `cycle detected: ${[...stack.map((s) => s.path), next].join(' → ')}`;
        }
        if (color.get(next) === WHITE) {
          stack.push({ path: next, iter: 0 });
        }
      } else {
        color.set(top.path, BLACK);
        order.push(node);
        stack.pop();
      }
    }
    return null;
  }

  for (const n of nodes) {
    if (color.get(n.inputRelPath) === WHITE) {
      const e = dfs(n.inputRelPath);
      if (e) return err(e);
    }
  }

  return ok({ topoOrder: order });
}
