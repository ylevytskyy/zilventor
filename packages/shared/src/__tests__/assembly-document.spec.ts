import { describe, it, expect } from 'vitest';
import type {
  ComponentInstance, AssemblyDocument, ProjectFile, PartDocument,
} from '../types';

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
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [],
    };
    expect(a.components).toHaveLength(0);
  });

  it('ProjectFile narrows on kind', () => {
    const part: ProjectFile = {
      formatVersion: 7, kind: 'part',
      createdAt: '2026-04-25T00:00:00Z',
      appVersion: '0.0.1',
      document: { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] } as unknown as PartDocument,
    };
    const asm: ProjectFile = {
      formatVersion: 7, kind: 'assembly',
      createdAt: '2026-04-25T00:00:00Z',
      appVersion: '0.0.1',
      document: { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] },
    };
    if (part.kind === 'part') {
      expect((part.document as PartDocument).featureTree).toEqual([]);
    }
    if (asm.kind === 'assembly') {
      expect(asm.document.components).toEqual([]);
    }
  });
});
