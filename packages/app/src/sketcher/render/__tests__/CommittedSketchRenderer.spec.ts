import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CommittedSketchRenderer } from '../CommittedSketchRenderer';

describe('CommittedSketchRenderer construction styling', () => {
  it('uses a dashed material for construction primitives', () => {
    const r = new CommittedSketchRenderer();
    r.update([
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'l2', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10, construction: true },
    ]);
    const objs = r.group.children as THREE.Line[];
    const normalMat = objs[0]!.material as THREE.Material;
    const constructionMat = objs[1]!.material as THREE.Material;
    expect(normalMat).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(normalMat).not.toBeInstanceOf(THREE.LineDashedMaterial);
    expect(constructionMat).toBeInstanceOf(THREE.LineDashedMaterial);
  });

  it('swaps material back to LineBasicMaterial when construction flag removed', () => {
    const r = new CommittedSketchRenderer();
    r.update([
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, construction: true },
    ]);
    // Verify it's dashed first
    expect((r.group.children[0] as THREE.Line).material).toBeInstanceOf(THREE.LineDashedMaterial);

    // Now update with same id but construction removed — cache key must differ
    r.update([
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    ]);
    const toggledBackMat = (r.group.children[0] as THREE.Line).material as THREE.Material;
    expect(toggledBackMat).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(toggledBackMat).not.toBeInstanceOf(THREE.LineDashedMaterial);
  });
});
