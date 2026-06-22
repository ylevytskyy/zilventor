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

  it('renders an ellipse as a THREE.Line object', () => {
    const r = new CommittedSketchRenderer();
    r.update([
      { id: 'e1', kind: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0 },
    ]);
    expect(r.group.children).toHaveLength(1);
    expect(r.group.children[0]).toBeInstanceOf(THREE.Line);
  });

  it('renders a partial ellipse (with startAngle/endAngle) as a THREE.Line', () => {
    const r = new CommittedSketchRenderer();
    r.update([
      { id: 'e2', kind: 'ellipse', cx: 5, cy: 5, rx: 10, ry: 3, rotation: 0, startAngle: 0, endAngle: Math.PI },
    ]);
    expect(r.group.children).toHaveLength(1);
    expect(r.group.children[0]).toBeInstanceOf(THREE.Line);
  });

  it('renders a point as a THREE.LineSegments cross marker', () => {
    const r = new CommittedSketchRenderer();
    r.update([{ id: 'pt1', kind: 'point', x: 5, y: 5 }]);
    expect(r.group.children).toHaveLength(1);
    expect(r.group.children[0]).toBeInstanceOf(THREE.LineSegments);
    // Material must be LineBasicMaterial (non-construction point)
    const mat = (r.group.children[0] as THREE.LineSegments).material as THREE.Material;
    expect(mat).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(mat).not.toBeInstanceOf(THREE.LineDashedMaterial);
  });
});

describe('CommittedSketchRenderer annotations (4c)', () => {
  it('renders a text annotation as a THREE.Mesh with a CanvasTexture', () => {
    const r = new CommittedSketchRenderer();
    r.update([], [{ id: 'a1', x: 10, y: 20, height: 3, value: 'HELLO', rotation: 0 }]);
    expect(r.group.children).toHaveLength(1);
    const child = r.group.children[0];
    expect(child).toBeInstanceOf(THREE.Mesh);
    const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(mat.map).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('applies rotation and height to the annotation mesh', () => {
    const r = new CommittedSketchRenderer();
    r.update([], [{ id: 'a2', x: 0, y: 0, height: 5, value: 'X', rotation: Math.PI / 4 }]);
    const mesh = r.group.children[0] as THREE.Mesh;
    expect(mesh.rotation.z).toBeCloseTo(Math.PI / 4, 9);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeCloseTo(5, 6); // plane world-height == ann.height
  });

  it('renders primitives and annotations together', () => {
    const r = new CommittedSketchRenderer();
    r.update(
      [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }],
      [{ id: 'a3', x: 0, y: 0, height: 2, value: 'T', rotation: 0 }],
    );
    expect(r.group.children).toHaveLength(2);
  });

  it('omitting annotations keeps primitives-only behavior (back-compat)', () => {
    const r = new CommittedSketchRenderer();
    r.update([{ id: 'l2', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(r.group.children).toHaveLength(1);
  });
});
