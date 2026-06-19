import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';
import type { Rule } from '../types';

describe('migrateManifest v27 → v28 (parameter rules)', () => {
  it('CURRENT_FORMAT_VERSION is 28', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(30);
  });

  it('injects rules:[] onto a v27 part document missing it', () => {
    const v27 = {
      formatVersion: 27,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [],
        properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v27 as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: { rules?: Rule[] };
    };
    expect(out.formatVersion).toBe(30);
    expect(out.document.rules).toEqual([]);
  });

  it('preserves existing rules on round-trip through the current format', () => {
    const rules: Rule[] = [
      { id: 'r1', trigger: ['width'], condition: 'width > 600', thenSet: [{ target: 'shelfCount', expression: '2' }] },
    ];
    const atCurrent = {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [],
        rules,
      },
    };
    // round-trip through JSON (the serialized form) then migrate (no-op at current)
    const cloned = JSON.parse(JSON.stringify(atCurrent));
    const out = migrateManifest(cloned) as { formatVersion: number; document: { rules?: Rule[] } };
    expect(out.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(out.document.rules).toEqual(rules);
  });

  it('does not add rules to assembly documents', () => {
    const v27asm = {
      formatVersion: 27,
      kind: 'assembly' as const,
      document: { id: 'a', name: 'Asm', units: 'mm', components: [] },
    };
    const out = migrateManifest(v27asm as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: Record<string, unknown>;
    };
    expect(out.formatVersion).toBe(30);
    expect(out.document.rules).toBeUndefined();
  });
});
