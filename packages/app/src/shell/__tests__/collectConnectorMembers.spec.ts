import { describe, it, expect } from 'vitest';
import { collectConnectorMembers } from '../collectConnectorMembers';
import type { BoreOp } from '@zilventor/shared';

function makeBore(id: string, connectorId: string): BoreOp {
  return {
    id, face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 10, v: 5, diameter: 7, depth: 12,
    role: 'confirmat-face', connectorId, connectorKind: 'confirmat',
  };
}

const IDENTITY_POSE = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
const DIMS = { length: 600, width: 560, thickness: 18 };

describe('collectConnectorMembers', () => {
  it('returns empty array when no docs match', () => {
    const result = collectConnectorMembers('c-unknown', [
      { partPath: 'a.zipt', doc: { bores: [makeBore('b1', 'c0')] }, panelDims: DIMS, worldPose: IDENTITY_POSE },
    ]);
    expect(result).toHaveLength(0);
  });

  it('returns the single bore from one doc when connectorId matches', () => {
    const bore = makeBore('b1', 'c0');
    const doc = { bores: [bore] };
    const result = collectConnectorMembers('c0', [
      { partPath: 'a.zipt', doc, panelDims: DIMS, worldPose: IDENTITY_POSE },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.bore).toBe(bore); // same reference (live)
    expect(result[0]!.partPath).toBe('a.zipt');
    expect(result[0]!.doc).toBe(doc);
  });

  it('collects bores from TWO docs — cup-on-door + plates-on-side pattern', () => {
    const cup = makeBore('hinge-cup-0', 'hinge-0');
    const plate1 = makeBore('hinge-plate-0a', 'hinge-0');
    const plate2 = makeBore('hinge-plate-0b', 'hinge-0');
    const doorDoc = { bores: [cup] };
    const sideDoc = { bores: [plate1, plate2, makeBore('other', 'other-conn')] };

    const result = collectConnectorMembers('hinge-0', [
      { partPath: 'door.zipt', doc: doorDoc, panelDims: DIMS, worldPose: IDENTITY_POSE },
      { partPath: 'side.zipt', doc: sideDoc, panelDims: DIMS, worldPose: IDENTITY_POSE },
    ]);

    expect(result).toHaveLength(3); // cup + 2 plates
    const partPaths = result.map((m) => m.partPath);
    expect(partPaths).toContain('door.zipt');
    expect(partPaths.filter((p) => p === 'side.zipt')).toHaveLength(2);
  });

  it('does NOT include bores with a different connectorId', () => {
    const b1 = makeBore('b1', 'c0');
    const b2 = makeBore('b2', 'c1'); // different connector
    const result = collectConnectorMembers('c0', [
      { partPath: 'a.zipt', doc: { bores: [b1, b2] }, panelDims: DIMS, worldPose: IDENTITY_POSE },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.bore.id).toBe('b1');
  });

  it('returns live bore references — same object identity as doc.bores[]', () => {
    const bore = makeBore('b1', 'c0');
    const doc = { bores: [bore] };
    const result = collectConnectorMembers('c0', [
      { partPath: 'a.zipt', doc, panelDims: DIMS, worldPose: IDENTITY_POSE },
    ]);
    // Must be the same object reference — not a copy — so EditBoreCommand mutations apply in place.
    expect(result[0]!.bore).toBe(bore);
  });

  it('handles doc with no bores key (absent-not-empty — bores key absent)', () => {
    const result = collectConnectorMembers('c0', [
      { partPath: 'a.zipt', doc: {}, panelDims: DIMS, worldPose: IDENTITY_POSE },
    ]);
    expect(result).toHaveLength(0);
  });
});
