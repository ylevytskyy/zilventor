import { describe, it, expect } from 'vitest';
import type { PartDocument, ComponentInstance, HolePlacement, ProjectFile, DoorSpec } from '../types';
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

  it('BoreOp accepts the new shelfPin-system32 / hinge roles + kinds', () => {
    const pin: BoreOp = {
      id: 'pin-col-front-0', face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 64, v: 37, diameter: 5, depth: 13, role: 'shelfPin-system32',
      connectorId: 'pin-col-front', connectorKind: 'shelfPin',
    };
    const cup: BoreOp = {
      id: 'hinge-0-cup', face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100, v: 21, diameter: 35, depth: 12, role: 'hingeCup',
      connectorId: 'hinge-0', connectorKind: 'hinge',
    };
    const plate: BoreOp = {
      id: 'hinge-0-plate-0', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 100, v: 37, diameter: 5, depth: 13, role: 'hingePlate',
      connectorId: 'hinge-0', connectorKind: 'hinge',
    };
    expect([pin.role, cup.role, plate.role]).toEqual([
      'shelfPin-system32', 'hingeCup', 'hingePlate',
    ]);
    expect([pin.connectorKind, cup.connectorKind]).toEqual(['shelfPin', 'hinge']);
  });

  it('PanelRole accepts the new "door" arm', () => {
    const role: PanelRole = 'door';
    expect(role).toBe('door');
  });

  it('ComponentInstance accepts an optional doorSpec', () => {
    const doorSpec: DoorSpec = {
      overlay: 'full', hingeSide: 'left', pair: 'single', hingeCount: 2,
    };
    const inst: ComponentInstance = {
      id: 'D1', partPath: 'door.zipt', position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'door', doorSpec,
    };
    expect(inst.doorSpec?.hingeCount).toBe(2);
    expect(inst.doorSpec?.overlay).toBe('full');
  });
});

describe('additive v23 BoreOp slice-3 fields', () => {
  it('BoreOp accepts edited?: boolean — absent when not set (exactOptionalPropertyTypes)', () => {
    const bore: BoreOp = {
      id: 'b1', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
    };
    // absent — key must not exist at all (not false, not undefined)
    expect('edited' in bore).toBe(false);
  });

  it('BoreOp accepts edited: true when explicitly set', () => {
    const bore: BoreOp = {
      id: 'b2', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
      edited: true,
    };
    expect(bore.edited).toBe(true);
  });

  it('BoreOp accepts jointDir?: {x,y,z} — absent when not set (exactOptionalPropertyTypes)', () => {
    const bore: BoreOp = {
      id: 'b3', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
    };
    expect('jointDir' in bore).toBe(false);
  });

  it('BoreOp accepts jointDir as a unit-ish Vec3 when set', () => {
    const bore: BoreOp = {
      id: 'b4', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
      jointDir: { x: 0, y: 0, z: 1 },
    };
    expect(bore.jointDir).toEqual({ x: 0, y: 0, z: 1 });
  });
});
