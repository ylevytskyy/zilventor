import { describe, it, expect } from 'vitest';
import { parseDxf } from '../parser';

function entitiesDxf(body: string): string {
  return ['  0', 'SECTION', '  2', 'ENTITIES', body.trim(), '  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

describe('parseDxf — LINE & CIRCLE', () => {
  it('parses a LINE entity with endpoints and layer', () => {
    const dxf = entitiesDxf(['  0', 'LINE', '  8', 'VISIBLE',
      ' 10', '5.0', ' 20', '10.0', ' 30', '0.0',
      ' 11', '15.0', ' 21', '25.0', ' 31', '0.0'].join('\n'));
    const r = parseDxf(dxf);
    expect(r.entities).toHaveLength(1);
    const e = r.entities[0]!;
    expect(e.type).toBe('LINE');
    if (e.type === 'LINE') {
      expect(e.layer).toBe('VISIBLE');
      expect([e.x1, e.y1, e.x2, e.y2]).toEqual([5, 10, 15, 25]);
    }
  });

  it('parses a CIRCLE entity with center and radius', () => {
    const dxf = entitiesDxf(['  0', 'CIRCLE', '  8', '0',
      ' 10', '50.0', ' 20', '60.0', ' 30', '0.0', ' 40', '7.5'].join('\n'));
    const r = parseDxf(dxf);
    const e = r.entities[0]!;
    expect(e.type).toBe('CIRCLE');
    if (e.type === 'CIRCLE') expect([e.cx, e.cy, e.r]).toEqual([50, 60, 7.5]);
  });

  it('defaults missing layer to "0" and skips unknown entity types', () => {
    const dxf = entitiesDxf(['  0', 'HATCH', ' 10', '1.0',
      '  0', 'LINE', ' 10', '0.0', ' 20', '0.0', ' 11', '1.0', ' 21', '1.0'].join('\n'));
    const r = parseDxf(dxf);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.type).toBe('LINE');
    expect(r.entities[0]!.layer).toBe('0');
  });

  it('never throws on malformed input', () => {
    expect(() => parseDxf('garbage @@@')).not.toThrow();
    expect(parseDxf('garbage @@@').entities).toEqual([]);
  });
});
