import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  ComponentInstance, AssemblyDocument, ProjectFile, PartDocument,
  AssemblyConstraintRef, ComponentColor,
} from '../types';
import type { ComponentPath, ComponentPathKey } from '../componentPath';

describe('AssemblyDocument', () => {
  it('ComponentInstance has the documented shape', () => {
    const c: ComponentInstance = {
      id: 'C1',
      partPath: 'parts/leg.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    expect(c.id).toBe('C1');
  });

  it('AssemblyDocument has the documented shape', () => {
    const a: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
      components: [],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {},
      colorOverrides: {},
      materials: [],
    };
    expect(a.components).toHaveLength(0);
  });

  it('ProjectFile narrows on kind', () => {
    const part: ProjectFile = {
      formatVersion: 8, kind: 'part',
      createdAt: '2026-04-25T00:00:00Z',
      appVersion: '0.0.1',
      document: { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] } as unknown as PartDocument,
    };
    const asm: ProjectFile = {
      formatVersion: 8, kind: 'assembly',
      createdAt: '2026-04-25T00:00:00Z',
      appVersion: '0.0.1',
      document: { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, materials: [] },
    };
    if (part.kind === 'part') {
      expect((part.document as PartDocument).featureTree).toEqual([]);
    }
    if (asm.kind === 'assembly') {
      expect(asm.document.components).toEqual([]);
    }
  });
});

describe('v8 schema additions', () => {
  it('ComponentInstance has optional flexible flag', () => {
    expectTypeOf<ComponentInstance['flexible']>().toEqualTypeOf<boolean | undefined>();
  });

  it('AssemblyDocument has colorOverrides keyed by ComponentPathKey', () => {
    expectTypeOf<AssemblyDocument['colorOverrides']>().toEqualTypeOf<
      Record<ComponentPathKey, ComponentColor>
    >();
  });

  it('AssemblyDocument has groundedComponentPaths', () => {
    expectTypeOf<AssemblyDocument['groundedComponentPaths']>().toEqualTypeOf<ComponentPath[]>();
  });

  it('face-kind constraint ref carries componentPath, not componentId', () => {
    type FaceRef = Extract<AssemblyConstraintRef, { kind: 'face' }>;
    expectTypeOf<FaceRef['componentPath']>().toEqualTypeOf<ComponentPath>();
  });
});
