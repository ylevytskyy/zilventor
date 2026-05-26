import { describe, expect, it } from 'vitest';
import { parsePartJson, parseAssemblyJson } from '../inventorJsonSchema';

describe('inventorJsonSchema', () => {
  describe('parsePartJson', () => {
    it('accepts a well-formed part JSON', () => {
      const j: any = {
        schemaVersion: 1, kind: 'part', exportedAt: '2026-04-30T00:00:00Z',
        source: { iptPath: 'a/b.ipt', fileVersion: 'Inventor 2012' },
        step: 'b.step', name: 'b',
        properties: { partNumber: 'X-1', mass: 1.5, hasFinish: true, 'Cost Center': 'Doors' },
        parameters: { Width: { value: 600, unit: 'mm', expression: '600 mm' } },
      };
      const r = parsePartJson(j);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.name).toBe('b');
    });

    it('rejects wrong schemaVersion', () => {
      const r = parsePartJson({ schemaVersion: 2, kind: 'part' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/schemaVersion/);
    });

    it('rejects wrong kind', () => {
      const r = parsePartJson({ schemaVersion: 1, kind: 'assembly' });
      expect(r.ok).toBe(false);
    });

    it('rejects missing required fields (step)', () => {
      const r = parsePartJson({ schemaVersion: 1, kind: 'part', exportedAt: 't', source: { iptPath: 'x', fileVersion: 'I' }, name: 'n', properties: {}, parameters: {} });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/step/);
    });

    it('preserves Cyrillic in property keys and values', () => {
      const j: any = {
        schemaVersion: 1, kind: 'part', exportedAt: '2026-04-30T00:00:00Z',
        source: { iptPath: 'a.ipt', fileVersion: 'Inventor 2012' },
        step: 'a.step', name: 'Бічна_панель',
        properties: { 'Назва': 'Дверцята' },
        parameters: {},
      };
      const r = parsePartJson(j);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.properties['Назва']).toBe('Дверцята');
    });
  });

  describe('parseAssemblyJson', () => {
    it('accepts a well-formed assembly JSON with one occurrence', () => {
      const j: any = {
        schemaVersion: 1, kind: 'assembly', exportedAt: '2026-04-30T00:00:00Z',
        source: { iamPath: 'a/b.iam', fileVersion: 'Inventor 2012' },
        name: 'b', properties: {}, parameters: {},
        occurrences: [
          { occurrenceName: 'P:1', ref: './P.ipt.json',
            pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
            visible: true, grounded: false },
        ],
      };
      const r = parseAssemblyJson(j);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.occurrences[0]!.ref).toBe('./P.ipt.json');
    });

    it('accepts ref: null (broken external reference)', () => {
      const j: any = {
        schemaVersion: 1, kind: 'assembly', exportedAt: '2026-04-30T00:00:00Z',
        source: { iamPath: 'a.iam', fileVersion: 'I' },
        name: 'a', properties: {}, parameters: {},
        occurrences: [
          { occurrenceName: 'P:1', ref: null,
            pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
            visible: true, grounded: false },
        ],
      };
      const r = parseAssemblyJson(j);
      expect(r.ok).toBe(true);
    });

    it('rejects malformed pose', () => {
      const j: any = {
        schemaVersion: 1, kind: 'assembly', exportedAt: 't',
        source: { iamPath: 'x', fileVersion: 'I' }, name: 'n',
        properties: {}, parameters: {},
        occurrences: [{ occurrenceName: 'X', ref: './a', pose: { translation: { x: 0 }, quaternion: [0, 0, 0] }, visible: true, grounded: false }],
      };
      const r = parseAssemblyJson(j);
      expect(r.ok).toBe(false);
    });
  });
});
