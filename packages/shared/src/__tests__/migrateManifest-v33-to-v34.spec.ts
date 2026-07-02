import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

describe('migrateManifest v33 → v34 (M4 Slice E — PanelFeature.outline)', () => {
  it('CURRENT_FORMAT_VERSION is 34', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(37);
  });

  it('migrates a v33 part manifest to v34 (additive no-op)', () => {
    const v33: AnyManifest = {
      formatVersion: 33,
      kind: 'part',
      document: { id: 'p1', featureTree: [{ kind: 'panel', id: 'pf1' }] },
    };
    const out = migrateManifest(v33);
    expect(out.formatVersion).toBe(37);
    // panel feature is unchanged (use find: injectOriginFeatures prepends origin work-features)
    const tree = (out.document as { featureTree: unknown[] }).featureTree;
    const panel = tree.find((f) => (f as { kind?: string }).kind === 'panel') as { id: string } | undefined;
    expect(panel?.id).toBe('pf1');
  });

  it('v34 panel with outline field round-trips through migrateManifest unchanged', () => {
    const outline = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
    const manifest: AnyManifest = {
      formatVersion: 36,
      kind: 'part',
      document: {
        id: 'p2', featureTree: [{ kind: 'panel', id: 'pf2', outline }],
      },
    };
    const out = migrateManifest(JSON.parse(JSON.stringify(manifest)) as AnyManifest);
    const tree = (out.document as { featureTree: Array<{ kind?: string; outline?: unknown }> }).featureTree;
    const panel = tree.find((f) => f.kind === 'panel');
    expect(panel?.outline).toEqual(outline);
  });
});
