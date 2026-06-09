import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import { TrimTool } from '../tools/TrimTool';
import { ExtendTool } from '../tools/ExtendTool';
import { ProjectGeometryTool } from '../tools/ProjectGeometryTool';
import type { SketchPrimitive } from '@zilventor/shared';

// ControllerDeps required fields: emitPrimitive + onPreview (2-arg: polyline, snap).
// vi.fn() satisfies both. Optional new deps (deletePrimitive, getSketchFrame) are added
// by Task 6-C to ControllerDeps — until then TypeScript will reject them as excess props.
// This file is written BEFORE Task 6-C (TDD), so TypeScript errors here ARE the red step.

const frame = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  xDir:   { x: 1, y: 0, z: 0 },
};

// Shared complete deps bag: union of all deps any test in this file needs.
// TypeScript will only accept this after Task 6-C adds deletePrimitive + getSketchFrame.
function makeDeps() {
  return {
    emitPrimitive: vi.fn(),
    onPreview: vi.fn(),
    updatePrimitive: vi.fn(),
    emitConstraint: vi.fn(),
    deletePrimitive: vi.fn(),
    getSketchFrame: () => frame,
  };
}

describe('ActiveToolController — slice-2 tool instantiation', () => {
  it("setToolKind('trim') instantiates a TrimTool", () => {
    const c = new ActiveToolController(makeDeps());
    c.setToolKind('trim');
    expect(c.currentTool()).toBeInstanceOf(TrimTool);
  });

  it("setToolKind('extend') instantiates an ExtendTool", () => {
    const c = new ActiveToolController(makeDeps());
    c.setToolKind('extend');
    expect(c.currentTool()).toBeInstanceOf(ExtendTool);
  });

  it("setToolKind('project-geom') instantiates a ProjectGeometryTool", () => {
    const c = new ActiveToolController(makeDeps());
    c.setToolKind('project-geom');
    expect(c.currentTool()).toBeInstanceOf(ProjectGeometryTool);
  });
});

describe('ActiveToolController — TrimTool dispatch', () => {
  it('click on a line body with no crossings deletes the primitive', () => {
    const deps = makeDeps();
    const c = new ActiveToolController(deps);
    const primitives: SketchPrimitive[] = [
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    ];
    c.setToolKind('trim');
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, primitives);
    expect(deps.deletePrimitive).toHaveBeenCalledWith('l1');
  });
});

describe('ActiveToolController — ExtendTool dispatch', () => {
  it('click on a line near its end with a barrier extends it', () => {
    const deps = makeDeps();
    const c = new ActiveToolController(deps);
    const primitives: SketchPrimitive[] = [
      { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 },
      { id: 'barrier', kind: 'line', x1: 15, y1: -5, x2: 15, y2: 5 },
    ];
    c.setToolKind('extend');
    c.handlePointer({ type: 'click', point: { x: 8, y: 0 } }, primitives);
    expect(deps.updatePrimitive).toHaveBeenCalledTimes(1);
    expect(deps.updatePrimitive.mock.calls[0]![0]).toBe('lh');
  });
});
