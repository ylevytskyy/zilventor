// Smoke test: confirms dxf-parser imports and parses under Vitest (CJS/ESM interop check).
// This file is intentionally kept minimal — it exists only to verify the import shape.

import DxfParser from 'dxf-parser';

const MINIMAL_DXF = `
0
SECTION
2
ENTITIES
0
LINE
8
0
10
0.0
20
0.0
30
0.0
11
10.0
21
20.0
31
0.0
0
ENDSEC
0
EOF
`.trim();

describe('dxf-parser smoke (import shape)', () => {
  it('default import is a constructor and parseSync returns entities', () => {
    const parser = new DxfParser();
    const result = parser.parseSync(MINIMAL_DXF);
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.entities)).toBe(true);
    expect(result!.entities.length).toBeGreaterThan(0);
    expect(result!.entities[0]!.type).toBe('LINE');
  });
});
