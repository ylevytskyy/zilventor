import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('fileFormat v25→v26 (face-frame roles)', () => {
  it('CURRENT_FORMAT_VERSION is 26', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(26);
  });

  it('migrates a v25 part manifest to v26 without structural change', () => {
    const v25 = {
      formatVersion: 25,
      kind: 'part' as const,
      document: { id: 'p', name: 'p', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [] },
    };
    const out = migrateManifest(v25 as unknown as Parameters<typeof migrateManifest>[0]);
    expect(out.formatVersion).toBe(26);
    expect((out as unknown as { document: { id: string } }).document.id).toBe('p');
  });
});
