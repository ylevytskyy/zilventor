import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

/**
 * Dedicated migration tests for v23 → v24 (присадка slice 4: drawer banks, drawerSlide kind).
 * v24 adds DrawerSpec + drawerSlide BoreOp.connectorKind — both additive/optional.
 * The migration is a no-op: no fields are injected.
 *
 * Extracted/extended from drawerSchema.spec.ts (~L12-16) to match the per-step file pattern
 * (migrateManifest-v21-to-v22.spec.ts etc). The embedded drawerSchema.spec.ts test is kept
 * for regression continuity; this file adds pattern-consistent discovery.
 */
describe('migrateManifest v23 → v24 (присадка slice 4: DrawerSpec, drawerSlide kind — additive no-op)', () => {
  it('CURRENT_FORMAT_VERSION is 25', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(35);
  });

  it('a v23 part manifest migrates to current unchanged (identity)', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      kind: 'part',
      document: {
        id: 'p1', name: 'SidePanel', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v23);
    expect(out.formatVersion).toBe(35);
    // Ensure no spurious fields were injected
    const doc = out.document as Record<string, unknown>;
    expect('drawerSpec' in doc).toBe(false);
    // featureTree may have origin work-features prepended by migration backfill,
    // but no user features (parts started with an empty tree).
    const tree = doc.featureTree as Array<Record<string, unknown>>;
    expect(tree.every((f) => typeof f['id'] === 'string' && (f['id'] as string).startsWith('origin.'))).toBe(true);
  });

  it('a v23 assembly manifest migrates to current unchanged (no drawerSpec injected on components)', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      kind: 'assembly',
      document: {
        id: 'a1', name: 'Cabinet', units: 'mm', parameters: {},
        components: [
          {
            id: 'C1', partPath: 'side.zipt',
            position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
          },
        ],
        constraints: [], groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v23);
    expect(out.formatVersion).toBe(35);
    const doc = out.document as { components: Array<Record<string, unknown>> };
    expect('drawerSpec' in doc.components[0]!).toBe(false);
  });

  it('a v23 part with a drawerSlide bore survives migration intact', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      kind: 'part',
      document: {
        id: 'p2', name: 'DrawerSide', units: 'mm', parameters: {},
        featureTree: [{ kind: 'panel', id: 'pnl', length: 400, width: 150, thickness: 16 }],
        properties: {}, materials: [], hardware: [],
        bores: [
          {
            id: 'slide-bore-1',
            face: { featureId: 'pnl', role: 'Top', instance: 0 },
            u: 100, v: 75, diameter: 5, depth: 'throughAll',
            role: 'drawerSlide-box',
            connectorId: 'slide-0',
            connectorKind: 'drawerSlide',
          },
        ],
      },
    };
    const out = migrateManifest(v23);
    expect(out.formatVersion).toBe(35);
    const doc = out.document as { bores: Array<Record<string, unknown>> };
    expect(doc.bores).toHaveLength(1);
    expect(doc.bores[0]!['connectorKind']).toBe('drawerSlide');
    expect(doc.bores[0]!['role']).toBe('drawerSlide-box');
  });

  it('a v24 manifest passes through unchanged (idempotent)', () => {
    const v24: AnyManifest = {
      formatVersion: 24,
      kind: 'part',
      document: {
        id: 'p3', name: 'P3', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v24);
    expect(out.formatVersion).toBe(35);
  });

  it('leaves drawing documents untouched (advances version only)', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      kind: 'drawing',
      document: { id: 'd', name: 'DWG', units: 'mm', sheets: [], properties: {} },
    };
    const out = migrateManifest(v23);
    expect(out.formatVersion).toBe(35);
  });
});
