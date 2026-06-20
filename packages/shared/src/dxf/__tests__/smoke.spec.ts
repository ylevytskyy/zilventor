import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';

const MINIMAL_DXF = ['  0', 'SECTION', '  2', 'ENTITIES',
  '  0', 'LINE', '  8', '0', ' 10', '0.0', ' 20', '0.0', ' 11', '10.0', ' 21', '20.0',
  '  0', 'ENDSEC', '  0', 'EOF'].join('\n');

describe('shared dxf codec smoke', () => {
  it('parses a minimal DXF into one LINE entity', () => {
    const r = parseDxf(MINIMAL_DXF);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.type).toBe('LINE');
  });
});
