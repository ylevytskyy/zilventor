import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v31 → v32 (DXF Phase 4b: point + annotations)', () => {
  it('CURRENT_FORMAT_VERSION is 32', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(40);
  });

  it('migrates a v31 document to v32 (no-op structural bump)', () => {
    const v31doc = { kind: 'part' as const, formatVersion: 31, document: { configurations: [] } };
    const out = migrateManifest(v31doc as never);
    expect(out.formatVersion).toBe(40);
  });

  it('migrates a v31 assembly to v32 without structural change', () => {
    const v31asm = {
      formatVersion: 31,
      kind: 'assembly' as const,
      document: { id: 'a', name: 'Asm', units: 'mm', components: [] },
    };
    const out = migrateManifest(v31asm as never);
    expect(out.formatVersion).toBe(40);
  });
});
