// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { PanelFeature } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AbfPanelRecord } from '@zilventor/shared/src/dxf/abfPanelExtraction';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { resolvePanelSpec } from '../../shell/resolvePanelSpec';
import { buildAbfPanelPart } from '../buildAbfPanelPart';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error('ENOENT');
    return b;
  }
}

const RECT_PANEL: AbfPanelRecord = {
  name: '__4. Дверка',
  materialGroup: { token: 'AUTO_THICKNESS_18', material: 'AUTO', thicknessMm: 18 },
  length: 600,
  width: 400,
  rectangular: true,
  outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }],
  circles: [],
};

const PANEL_WITH_BORES: AbfPanelRecord = {
  ...RECT_PANEL,
  circles: [
    {
      kind: 'bore', diameter: 35, depth: 13, faceRole: 'Bottom',
      role: 'hingeCup', connectorKind: 'hinge', u: 50, v: 60,
      bestEffort: false, sku: '96053',
    },
    {
      kind: 'bore', diameter: 2, depth: 3, faceRole: 'Top',
      role: 'shelfPin-system32', connectorKind: 'shelfPin', u: 10, v: 10,
      bestEffort: true,
    },
  ],
};

const PANEL_WITH_REFERENCE_CIRCLE: AbfPanelRecord = {
  ...RECT_PANEL,
  circles: [{ kind: 'reference', diameter: 5, x: 20, y: 30 }],
};

const NON_RECT_PANEL: AbfPanelRecord = { ...RECT_PANEL, rectangular: false };

describe('buildAbfPanelPart', () => {
  it('builds a PartDocument whose first user feature is a PanelFeature with the dialog-supplied thickness/material', () => {
    const part = buildAbfPanelPart(RECT_PANEL, { materialId: 'mat-1', thickness: 18 });
    expect(part.name).toBe('__4. Дверка');
    const userFeatures = part.featureTree.filter((f) => !f.id.startsWith('origin.'));
    expect(userFeatures).toHaveLength(1);
    const panel = userFeatures[0] as PanelFeature;
    expect(panel.kind).toBe('panel');
    expect(panel.length).toEqual({ kind: 'literal', value: 600 });
    expect(panel.width).toEqual({ kind: 'literal', value: 400 });
    expect(panel.thickness).toEqual({ kind: 'literal', value: 18 });
    expect(panel.thicknessFromMaterial).toBe(false);
    expect(panel.materialId).toBe('mat-1');
  });

  it('adds a BoreOp per bore circle, carrying sku when present and omitting it when absent', () => {
    const part = buildAbfPanelPart(PANEL_WITH_BORES, { materialId: 'mat-1', thickness: 18 });
    expect(part.bores).toHaveLength(2);
    const [hingeBore, shelfPinBore] = part.bores!;
    expect(hingeBore!.face).toEqual({ featureId: 'panel', role: 'Bottom', instance: 0 });
    expect(hingeBore!.u).toBe(50);
    expect(hingeBore!.v).toBe(60);
    expect(hingeBore!.diameter).toBe(35);
    expect(hingeBore!.depth).toBe(13);
    expect(hingeBore!.role).toBe('hingeCup');
    expect(hingeBore!.connectorKind).toBe('hinge');
    expect(hingeBore!.sku).toBe('96053');
    expect(shelfPinBore!.face).toEqual({ featureId: 'panel', role: 'Top', instance: 0 });
    expect('sku' in shelfPinBore!).toBe(false);
  });

  it('imports reference-only circles as sketch circle primitives, never as BoreOps', () => {
    const part = buildAbfPanelPart(PANEL_WITH_REFERENCE_CIRCLE, { materialId: 'mat-1', thickness: 18 });
    expect(part.bores ?? []).toHaveLength(0);
    const sketch = part.featureTree.find((f) => f.kind === 'sketch') as Extract<typeof part.featureTree[number], { kind: 'sketch' }> | undefined;
    expect(sketch).toBeDefined();
    expect(sketch!.primitives).toHaveLength(1);
    expect(sketch!.primitives[0]).toMatchObject({ kind: 'circle', cx: 20, cy: 30, r: 2.5 });
  });

  it('sets PanelFeature.outline only when the record is non-rectangular', () => {
    const rectPart = buildAbfPanelPart(RECT_PANEL, { materialId: 'mat-1', thickness: 18 });
    const rectPanel = rectPart.featureTree.find((f) => f.kind === 'panel') as PanelFeature;
    expect(rectPanel.outline).toBeUndefined();

    const nonRectPart = buildAbfPanelPart(NON_RECT_PANEL, { materialId: 'mat-1', thickness: 18 });
    const nonRectPanel = nonRectPart.featureTree.find((f) => f.kind === 'panel') as PanelFeature;
    expect(nonRectPanel.outline).toEqual(NON_RECT_PANEL.outline);
  });

  it('round-trips through resolvePanelSpec after packing to a .zipt archive', async () => {
    const part = buildAbfPanelPart(RECT_PANEL, { materialId: 'mat-1', thickness: 18 });
    // resolvePanelSpec's panelPreflight requires a non-empty name + materialId (plan §5).
    expect(part.name.length).toBeGreaterThan(0);

    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: part };
    const bytes = await writeTarGz([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
    const opfs = new MemOpfs();
    await opfs.write('parts/door.zipt', bytes);

    const spec = await resolvePanelSpec(opfs, 'parts/door.zipt', new Map());
    expect(spec).not.toBeNull();
    expect(spec!.length).toBe(600);
    expect(spec!.width).toBe(400);
    expect(spec!.thickness).toBe(18);
    expect(spec!.materialId).toBe('mat-1');
  });
});
