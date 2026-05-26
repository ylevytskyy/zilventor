// packages/app/src/drawing/__tests__/dxfWriter.spec.ts
import { describe, it, expect } from 'vitest';
import { createDxfDocument } from '../dxfWriter';

describe('dxfWriter — document scaffolding (DXF-SCAF)', () => {
  it('DXF-SCAF-1: produces matching SECTION/ENDSEC pairs', () => {
    const doc = createDxfDocument();
    const out = doc.toString();
    // Count SECTION openings and ENDSEC closings
    const sections = (out.match(/\n\s*SECTION\s*\n/g) ?? []).length;
    const endsecs  = (out.match(/\n\s*ENDSEC\s*\n/g)  ?? []).length;
    expect(sections).toBe(endsecs);
    expect(sections).toBeGreaterThanOrEqual(3); // HEADER, TABLES, ENTITIES
  });

  it('DXF-SCAF-2: contains HEADER, TABLES, ENTITIES section names', () => {
    const out = createDxfDocument().toString();
    expect(out).toContain('HEADER');
    expect(out).toContain('TABLES');
    expect(out).toContain('ENTITIES');
  });

  it('DXF-SCAF-3: terminates with group-code 0 / EOF', () => {
    const out = createDxfDocument().toString();
    const trimmed = out.trimEnd();
    // Last two non-empty lines must be '  0' and 'EOF'
    const lines = trimmed.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
    expect(lines[lines.length - 2]).toBe('  0');
    expect(lines[lines.length - 1]).toBe('EOF');
  });

  it('DXF-SCAF-4: LTYPE DASHED defined in TABLES', () => {
    const out = createDxfDocument().toString();
    expect(out).toContain('LTYPE');
    expect(out).toContain('DASHED');
  });

  it('DXF-SCAF-5: LAYER table contains all required layers', () => {
    const out = createDxfDocument().toString();
    const requiredLayers = ['VISIBLE', 'HIDDEN', 'SECTION-HATCH', 'SECTION-LINE',
      'DETAIL', 'DIMENSIONS', 'ANNOTATIONS', 'HOLE-TABLE', 'TITLE'];
    for (const layer of requiredLayers) {
      expect(out, `layer ${layer} must appear in TABLES`).toContain(layer);
    }
  });
});
