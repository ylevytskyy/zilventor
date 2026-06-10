import { describe, it, expect } from 'vitest';
import type { PartDocument, ComponentInstance, HolePlacement, ProjectFile } from '../types';
import type { BoreOp } from '../bore';
import type { PanelRole } from '../cabinets/types';

describe('additive v21 type surface', () => {
  it('PartDocument accepts bores?: BoreOp[]', () => {
    const bore: BoreOp = {
      id: 'b', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 1, v: 2, diameter: 5, depth: 'throughAll', role: 'confirmat-face',
      connectorId: 'c', connectorKind: 'confirmat',
    };
    const doc: PartDocument = {
      id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
      properties: {}, materials: [], hardware: [], bores: [bore],
    };
    expect(doc.bores).toHaveLength(1);
  });

  it('ComponentInstance accepts role?: PanelRole', () => {
    const role: PanelRole = 'leftSide';
    const inst: ComponentInstance = {
      id: 'C1', partPath: 'x.zipt', position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role,
    };
    expect(inst.role).toBe('leftSide');
  });

  it('HolePlacement accepts the atFace variant', () => {
    const p: HolePlacement = {
      kind: 'atFace',
      faceName: { featureId: 'panel', role: 'Left', instance: 0 },
      points: [{ u: 10, v: 20 }],
      axis: 'into-face',
    };
    expect(p.kind).toBe('atFace');
  });

  it('ProjectFile formatVersion union includes 21', () => {
    const f: ProjectFile = {
      formatVersion: 21, kind: 'part', createdAt: '', appVersion: '',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [] },
    };
    expect(f.formatVersion).toBe(21);
  });
});
