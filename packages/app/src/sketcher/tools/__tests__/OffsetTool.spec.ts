import { describe, it, expect } from 'vitest';
import { OffsetTool } from '../OffsetTool';

describe('OffsetTool', () => {
  it('picks a line then commits an offset primitive at the cursor side', () => {
    const committed: any[] = [];
    const previews: any[] = [];
    const tool = new OffsetTool({ onCommit: (p) => committed.push(p), onPreview: (poly) => previews.push(poly) });
    tool.setPrimitives([{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }]);
    tool.onPointerClick({ x: 5, y: 0 });
    tool.onPointerMove({ x: 5, y: 4 });
    expect(previews.length).toBeGreaterThan(0);
    tool.onPointerClick({ x: 5, y: 4 });
    expect(committed).toHaveLength(1);
    expect(committed[0].kind).toBe('line');
    expect(committed[0].y1).toBeCloseTo(4, 6);
    expect(committed[0].y2).toBeCloseTo(4, 6);
  });

  it('commits via numeric distance on the current cursor side', () => {
    const committed: any[] = [];
    const tool = new OffsetTool({ onCommit: (p) => committed.push(p), onPreview: () => {} });
    tool.setPrimitives([{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }]);
    tool.onPointerClick({ x: 5, y: 0 });
    tool.onPointerMove({ x: 5, y: -2 });
    tool.onNumericCommit([7]);
    expect(committed[0].y1).toBeCloseTo(-7, 6);
  });
});
