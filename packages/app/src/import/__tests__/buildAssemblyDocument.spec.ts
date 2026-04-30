import { describe, expect, it } from 'vitest';
import { buildAssemblyDocument } from '../buildAssemblyDocument';
import type { ImporterAssemblyJson } from '../inventorJsonSchema';
import { pathKey } from '@zilventor/shared';

const asm: ImporterAssemblyJson = {
  schemaVersion: 1, kind: 'assembly', exportedAt: 't',
  source: { iamPath: 'Cabinet.iam', fileVersion: 'I' },
  name: 'Cabinet', properties: { partNumber: 'C-1' }, parameters: {},
  occurrences: [
    { occurrenceName: 'Side:1', ref: './Side.ipt.json',
      pose: { translation: { x: 1, y: 2, z: 3 }, quaternion: [0, 0, 0, 1] },
      visible: true, grounded: true },
    { occurrenceName: 'Side:2', ref: './Side.ipt.json',
      pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
      color: { hex: '#ff0000' }, visible: true, grounded: false },
    { occurrenceName: 'Brkn:1', ref: null,
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
      visible: true, grounded: false },
  ],
};
const refResolution = new Map<string, string>([['./Side.ipt.json', 'Cabinet/Side.zipt']]);

describe('buildAssemblyDocument', () => {
  it('produces v9 AssemblyDocument with one ComponentInstance per occurrence', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.id).toBe('a-1');
    expect(doc.name).toBe('Cabinet');
    expect(doc.units).toBe('mm');
    expect(doc.components).toHaveLength(3);
  });

  it('resolves ref to partPath via the resolution map', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.components[0]!.partPath).toBe('Cabinet/Side.zipt');
    expect(doc.components[1]!.partPath).toBe('Cabinet/Side.zipt');
  });

  it('broken ref (null) → empty-string partPath sentinel', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    const broken = doc.components.find((c) => c.id.startsWith('Brkn'));
    expect(broken?.partPath).toBe('');
  });

  it('unresolved ref (string not in map) → empty-string partPath sentinel', () => {
    const orphanAsm: ImporterAssemblyJson = {
      ...asm,
      occurrences: [
        { occurrenceName: 'Orphan:1', ref: './Missing.ipt.json',
          pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
          visible: true, grounded: false },
      ],
    };
    const doc = buildAssemblyDocument({ asmJson: orphanAsm, refResolution: new Map(), asmId: 'a-2' });
    expect(doc.components[0]!.partPath).toBe('');
  });

  it('decodes pose into ComponentInstance.pose with normalized quaternion', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.components[0]!.pose).toBeDefined();
    expect(doc.components[0]!.pose!.translation).toEqual({ x: 1, y: 2, z: 3 });
    expect(doc.components[0]!.pose!.quaternion).toEqual([0, 0, 0, 1]);
  });

  it('grounded flag → groundedComponentPaths with [occId] tuple', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.groundedComponentPaths).toHaveLength(1);
    expect(doc.groundedComponentPaths[0]).toEqual([doc.components[0]!.id]);
  });

  it('color → colorOverrides keyed by pathKey([occId]), and ComponentInstance.color set too', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    const k = pathKey([doc.components[1]!.id]);
    expect(doc.colorOverrides[k]).toEqual({ kind: 'hex', hex: '#ff0000' });
    expect(doc.components[1]!.color).toEqual({ kind: 'hex', hex: '#ff0000' });
  });

  it('constraints array is empty', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.constraints).toEqual([]);
  });

  it('properties bag is shallow-copied (no aliasing)', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.properties).toEqual({ partNumber: 'C-1' });
    expect(doc.properties).not.toBe(asm.properties);
  });

  it('sanitizes Inventor occurrence names containing colons', () => {
    const doc = buildAssemblyDocument({ asmJson: asm, refResolution, asmId: 'a-1' });
    expect(doc.components[0]!.id).toBe('Side_1');
  });

  it('maps importer parameters via the same unit rules as T14 (mm/deg pass-through, rad→deg, unitless→mm)', () => {
    const asmWithParams: ImporterAssemblyJson = {
      ...asm,
      parameters: {
        Width: { value: 600, unit: 'mm', expression: '600 mm' },
        Theta: { value: Math.PI / 2, unit: 'rad', expression: 'pi/2 rad' },
        Count: { value: 4, unit: 'unitless', expression: '4' },
      },
    };
    const doc = buildAssemblyDocument({ asmJson: asmWithParams, refResolution, asmId: 'a-3' });
    expect(doc.parameters.Width).toMatchObject({ unit: 'mm', value: 600 });
    expect(doc.parameters.Theta!.unit).toBe('deg');
    expect(doc.parameters.Theta!.value).toBeCloseTo(90, 8);
    expect(doc.parameters.Count!.unit).toBe('mm');
    expect(doc.parameters.Count!.value).toBe(4);
  });
});
