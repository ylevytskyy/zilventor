import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, type GraphNode } from '../dependencyGraph';

function node(path: string, kind: 'part' | 'assembly', refs: string[] = []): GraphNode {
  return { inputRelPath: path, kind, refs };
}

describe('buildDependencyGraph', () => {
  it('returns parts in topo order before assemblies that reference them', () => {
    const nodes = [
      node('Cabinet.iam.json', 'assembly', ['Side.ipt.json', 'Back.ipt.json']),
      node('Side.ipt.json', 'part'),
      node('Back.ipt.json', 'part'),
    ];
    const r = buildDependencyGraph(nodes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const order = r.value.topoOrder.map((n) => n.inputRelPath);
    expect(order.indexOf('Side.ipt.json')).toBeLessThan(order.indexOf('Cabinet.iam.json'));
    expect(order.indexOf('Back.ipt.json')).toBeLessThan(order.indexOf('Cabinet.iam.json'));
  });

  it('handles two-level assembly hierarchy', () => {
    const nodes = [
      node('Outer.iam.json', 'assembly', ['Inner.iam.json']),
      node('Inner.iam.json', 'assembly', ['Leaf.ipt.json']),
      node('Leaf.ipt.json', 'part'),
    ];
    const r = buildDependencyGraph(nodes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const order = r.value.topoOrder.map((n) => n.inputRelPath);
    expect(order).toEqual(['Leaf.ipt.json', 'Inner.iam.json', 'Outer.iam.json']);
  });

  it('detects a cycle', () => {
    const nodes = [
      node('A.iam.json', 'assembly', ['B.iam.json']),
      node('B.iam.json', 'assembly', ['A.iam.json']),
    ];
    const r = buildDependencyGraph(nodes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cycle/i);
  });

  it('detects a missing ref', () => {
    const nodes = [node('A.iam.json', 'assembly', ['Missing.ipt.json'])];
    const r = buildDependencyGraph(nodes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Missing\.ipt\.json/);
  });

  it('handles empty refs without error', () => {
    const nodes = [node('A.iam.json', 'assembly', [])];
    const r = buildDependencyGraph(nodes);
    expect(r.ok).toBe(true);
  });
});
