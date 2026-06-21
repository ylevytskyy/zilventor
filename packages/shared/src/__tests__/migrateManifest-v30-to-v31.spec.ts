import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v30 → v31 (DXF Phase 3 sketch-model extension)', () => {
  it('CURRENT_FORMAT_VERSION is 31', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(31);
  });

  it('migrates a v30 document to v31 (no-op structural bump)', () => {
    const v30doc = { kind: 'part' as const, formatVersion: 30, document: { configurations: [] } };
    const out = migrateManifest(v30doc as never);
    expect(out.formatVersion).toBe(31);
  });

  it('migrates a v30 assembly to v31 without structural change', () => {
    const v30asm = {
      formatVersion: 30,
      kind: 'assembly' as const,
      document: { id: 'a', name: 'Asm', units: 'mm', components: [] },
    };
    const out = migrateManifest(v30asm as never);
    expect(out.formatVersion).toBe(31);
  });
});
