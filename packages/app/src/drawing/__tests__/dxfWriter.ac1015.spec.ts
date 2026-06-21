// packages/app/src/drawing/__tests__/dxfWriter.ac1015.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';

describe('dxfWriter AC1015 header', () => {
  it('declares AC1015 and a numeric $HANDSEED greater than every entity handle', () => {
    const doc = createDxfDocument();
    doc.line('VISIBLE', 0, 0, 10, 10);
    doc.circle('VISIBLE', 5, 5, 2);
    const out = doc.toString();

    expect(out).toContain('$ACADVER');
    expect(out).toContain('AC1015');
    expect(out).not.toContain('AC1009');

    // $HANDSEED present
    const seedMatch = /\$HANDSEED\n\s*5\n\s*([0-9A-F]+)/.exec(out);
    expect(seedMatch, 'has $HANDSEED').not.toBeNull();
    const seed = parseInt(seedMatch![1]!, 16);

    // Scan only the ENTITIES section for group-5 handles — the $HANDSEED line
    // itself uses group code 5 and would otherwise appear in the scan, causing
    // seed < seed to fail. HEADER is before ENTITIES so slicing from ENTITIES is safe.
    const entitiesSection = out.slice(out.indexOf('\nENTITIES\n'));
    const handles = [...entitiesSection.matchAll(/\n\s*5\n\s*([0-9A-F]+)/g)].map(
      (m) => parseInt(m[1]!, 16),
    );
    expect(handles.length).toBeGreaterThan(0);
    expect(new Set(handles).size).toBe(handles.length); // unique
    for (const h of handles) expect(h).toBeLessThan(seed);
  });

  it('emits an OBJECTS section with a root DICTIONARY', () => {
    const out = createDxfDocument().toString();
    expect(out).toMatch(/\n\s*2\nOBJECTS\n/);
    expect(out).toContain('DICTIONARY');
  });
});
