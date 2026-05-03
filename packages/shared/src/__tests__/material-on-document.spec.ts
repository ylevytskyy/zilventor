import { describe, expect, it } from 'vitest';
import type { PartDocument, AssemblyDocument } from '../types';
import type { MaterialEntry } from '../material';

const MAT: MaterialEntry = {
  id: 'mat-1', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b',
};

describe('materials on documents', () => {
  it('PartDocument carries materials array', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Side', units: 'mm',
      parameters: {}, featureTree: [],
      properties: {}, materials: [MAT],
    };
    expect(part.materials).toHaveLength(1);
  });

  it('AssemblyDocument carries materials array', () => {
    const asm: AssemblyDocument = {
      id: 'a1', name: 'Box', units: 'mm',
      parameters: {}, components: [], constraints: [],
      groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [MAT],
    };
    expect(asm.materials).toHaveLength(1);
  });
});
