import { describe, it, expect } from 'vitest';
import { EDGE_SIDE, EDGE_LETTER, sideSegment, grainArrow, drawLabelDiagram } from '../renderLabelsPdf';
import type { PanelLabel } from '../buildPanelLabels';

describe('EDGE_SIDE — load-bearing edge→diagram-side mapping', () => {
  it('maps front→top, back→bottom, left→left, right→right (length=X horizontal, width=Y vertical)', () => {
    expect(EDGE_SIDE).toEqual({ front: 'top', back: 'bottom', left: 'left', right: 'right' });
    expect(EDGE_LETTER).toEqual({ front: 'F', back: 'B', left: 'L', right: 'R' });
  });
});

describe('sideSegment', () => {
  const b = { x: 10, y: 20, w: 40, h: 30 };
  it('top is the horizontal segment at min-y', () => {
    expect(sideSegment('top', b)).toEqual([10, 20, 50, 20]);
  });
  it('bottom is the horizontal segment at max-y', () => {
    expect(sideSegment('bottom', b)).toEqual([10, 50, 50, 50]);
  });
  it('left is the vertical segment at min-x', () => {
    expect(sideSegment('left', b)).toEqual([10, 20, 10, 50]);
  });
  it('right is the vertical segment at max-x', () => {
    expect(sideSegment('right', b)).toEqual([50, 20, 50, 50]);
  });
});

describe('grainArrow — load-bearing grain axis', () => {
  const b = { x: 0, y: 0, w: 40, h: 20 };
  it('length → horizontal arrow (y constant, x increasing)', () => {
    const a = grainArrow('length', b)!;
    expect(a[1]).toBe(a[3]); // y1 === y2
    expect(a[0]).toBeLessThan(a[2]); // x1 < x2
  });
  it('width → vertical arrow (x constant, y increasing)', () => {
    const a = grainArrow('width', b)!;
    expect(a[0]).toBe(a[2]); // x1 === x2
    expect(a[1]).toBeLessThan(a[3]); // y1 < y2
  });
  it('none → no arrow', () => {
    expect(grainArrow('none', b)).toBeNull();
  });
});

describe('drawLabelDiagram', () => {
  function stubPdf() {
    const lines: Array<[number, number, number, number]> = [];
    const texts: Array<[string, number, number]> = [];
    const widths: number[] = [];
    return {
      pdf: {
        setLineWidth: (w: number) => widths.push(w),
        line: (x1: number, y1: number, x2: number, y2: number) => lines.push([x1, y1, x2, y2]),
        rect: () => {},
        setFontSize: () => {},
        text: (t: string, x: number, y: number) => texts.push([t, x, y]),
      },
      lines,
      texts,
      widths,
    };
  }
  const base: PanelLabel = {
    itemNumber: 1, partName: 'Side', materialName: 'MDF', length: 600, width: 400, thickness: 18,
    grain: 'length', edges: { front: false, back: false, left: false, right: false },
    copyIndex: 1, copyCount: 1, qrPayload: 'Z|1|1/1|600x400x18|MDF',
  };

  it('draws an edge letter for each banded edge and none for unbanded', () => {
    const s = stubPdf();
    drawLabelDiagram(s.pdf, { ...base, edges: { front: true, back: false, left: true, right: false } },
      { x: 0, y: 0, w: 50, h: 30 });
    const letters = s.texts.map((t) => t[0]);
    expect(letters).toContain('F');
    expect(letters).toContain('L');
    expect(letters).not.toContain('B');
    expect(letters).not.toContain('R');
  });

  it('does not throw and draws a grain line for grain!==none', () => {
    const s = stubPdf();
    expect(() => drawLabelDiagram(s.pdf, base, { x: 0, y: 0, w: 50, h: 30 })).not.toThrow();
    expect(s.lines.length).toBeGreaterThan(0);
  });
});
