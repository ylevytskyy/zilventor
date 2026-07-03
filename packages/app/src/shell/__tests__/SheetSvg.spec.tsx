import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SheetSvg } from '../SheetSvg';
import type { NestSheet } from '@zilventor/shared';
import type { MaterialEntry } from '@zilventor/shared/src/material';

const baseSheet: NestSheet = {
  materialId: 'm1',
  sheetIndex: 1,
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  utilizationPct: 50.0,
  panels: [
    { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
  ],
};

const material: MaterialEntry = {
  id: 'm1', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};

// jsdom (v25, this repo) has no global PointerEvent constructor, so
// fireEvent.pointerDown/Move/Up silently fall back to a bare Event with no
// clientX/clientY. Dispatch a MouseEvent typed as the pointer event instead —
// listeners match by e.type, and MouseEvent carries real clientX/clientY.
function firePointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: Element | Window, clientX: number, clientY: number): void {
  fireEvent(target, new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));
}

describe('SheetSvg', () => {
  it('renders sheet header with index and utilisation', () => {
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.getByText(/Sheet 1/)).toBeInTheDocument();
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });

  it('renders one rect per placed panel and #itemNumber label', () => {
    const sheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 3, rowKey: 'r3', instanceIndex: 1, x: 10, y: 20, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 7, rowKey: 'r7', instanceIndex: 1, x: 620, y: 20, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    };
    render(<SheetSvg sheet={sheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.getByText(/#3/)).toBeInTheDocument();
    expect(screen.getByText(/#7/)).toBeInTheDocument();
    const svg = document.querySelector('svg');
    // two panel rects + one sheet outline rect = 3 rects
    expect(svg?.querySelectorAll('rect').length).toBe(3);
  });

  it('omits the LxW label when length <= 200mm', () => {
    const smallSheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 150, width: 100, rotated: false, grain: 'none' },
      ],
    };
    render(<SheetSvg sheet={smallSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.queryByText(/150×100/)).not.toBeInTheDocument();
  });

  it('renders grain arrow path when grain is not none', () => {
    const grainByRowKey = new Map([['r1', 'length' as const]]);
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={grainByRowKey} onExportPng={() => {}} />);
    const svg = document.querySelector('svg');
    const paths = svg?.querySelectorAll('path');
    expect(paths?.length).toBeGreaterThan(0);
  });

  it('clicking Export PNG calls onExportPng with the sheet', () => {
    const onExportPng = vi.fn();
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={onExportPng} />);
    fireEvent.click(screen.getByRole('button', { name: /Export PNG sheet 1/i }));
    expect(onExportPng).toHaveBeenCalledTimes(1);
    expect(onExportPng).toHaveBeenCalledWith(baseSheet);
  });

  it('shows a warning badge with an aria-label about guillotine cut order when sheet.manuallyEdited is true', () => {
    const edited: NestSheet = { ...baseSheet, manuallyEdited: true };
    render(<SheetSvg sheet={edited} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.getByLabelText(/guillotine cut order may no longer be valid/i)).toBeInTheDocument();
  });

  it('does not show the warning badge when sheet.manuallyEdited is absent', () => {
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.queryByLabelText(/guillotine cut order may no longer be valid/i)).not.toBeInTheDocument();
  });

  it('renders a dashed remnant rect and dimension label when sheet.remnant is present', () => {
    const withRemnant: NestSheet = { ...baseSheet, remnant: { x: 0, y: 800, length: 2440, width: 420 } };
    render(<SheetSvg sheet={withRemnant} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(document.querySelector('[data-nesting-remnant]')).toBeInTheDocument();
    expect(screen.getByText(/2440.*420/)).toBeInTheDocument();
  });

  it('shows a marker on panels with mirrored=true', () => {
    const mirroredSheet: NestSheet = {
      ...baseSheet,
      panels: [{ ...baseSheet.panels[0]!, mirrored: true }],
    };
    render(<SheetSvg sheet={mirroredSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.getByLabelText(/flipped/i)).toBeInTheDocument();
  });

  it('does not show a mirrored marker when mirrored is absent', () => {
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.queryByLabelText(/flipped/i)).not.toBeInTheDocument();
  });

  it('clicking a panel in editable mode calls onSelectPanel with its array index', () => {
    const twoPanelSheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 2, rowKey: 'r2', instanceIndex: 1, x: 700, y: 0, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    };
    const onSelectPanel = vi.fn();
    render(
      <SheetSvg sheet={twoPanelSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={onSelectPanel} />,
    );
    fireEvent.click(screen.getByLabelText('Select panel #2'));
    expect(onSelectPanel).toHaveBeenCalledWith(1);
  });

  it('does not attach click handlers to panels when not editable', () => {
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.queryByLabelText(/Select panel/)).not.toBeInTheDocument();
  });

  it('pointerdown on a panel selects it immediately (drag-without-prior-click)', () => {
    const twoPanelSheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 2, rowKey: 'r2', instanceIndex: 1, x: 700, y: 0, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    };
    const onSelectPanel = vi.fn();
    render(
      <SheetSvg sheet={twoPanelSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={onSelectPanel} />,
    );
    firePointer('pointerdown', screen.getByLabelText('Select panel #2'), 700, 0);
    expect(onSelectPanel).toHaveBeenCalledWith(1);
  });

  it('pointerdown+pointerup with near-zero movement only selects — no onDragEnd call', () => {
    const onSelectPanel = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={onSelectPanel} onDragEnd={onDragEnd} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 10, 10);
    firePointer('pointerup', window, 11, 10);
    expect(onSelectPanel).toHaveBeenCalledWith(0);
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('dragging past the click threshold renders a ghost rect that follows the cursor', () => {
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 50, 20);
    const ghost = document.querySelector('[data-nesting-drag-ghost]');
    expect(ghost).not.toBeNull();
    // baseSheet panel #1 starts at x=0,y=0 (jsdom rect fallback ⇒ px == mm)
    expect(ghost?.getAttribute('x')).toBe('50');
    expect(ghost?.getAttribute('y')).toBe('20');
    firePointer('pointerup', window, 50, 20);
  });

  it('ghost has no data-nesting-panel attribute (does not inflate panel counts)', () => {
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 50, 20);
    const ghost = document.querySelector('[data-nesting-drag-ghost]');
    expect(ghost?.getAttribute('data-nesting-panel')).toBeNull();
    firePointer('pointerup', window, 50, 20);
  });

  it('ghost is colored valid when the candidate position is within bounds and non-overlapping', () => {
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 100, 50); // well within 2440x1220 sheet
    const ghost = document.querySelector('[data-nesting-drag-ghost]');
    expect(ghost?.getAttribute('data-nesting-drag-valid')).toBe('true');
    firePointer('pointerup', window, 100, 50);
  });

  it('ghost is colored invalid when the candidate position would overlap another panel', () => {
    const twoPanelSheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 2, rowKey: 'r2', instanceIndex: 1, x: 605, y: 0, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    };
    render(
      <SheetSvg sheet={twoPanelSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} />,
    );
    const g = screen.getByLabelText('Select panel #1'); // drag panel 0 into panel 1's space
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 610, 0);
    const ghost = document.querySelector('[data-nesting-drag-ghost]');
    expect(ghost?.getAttribute('data-nesting-drag-valid')).toBe('false');
    firePointer('pointerup', window, 610, 0);
  });

  it('a valid drop calls onDragEnd exactly once with the correct panelArrayIndex, dx, dy', () => {
    const onDragEnd = vi.fn();
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} onDragEnd={onDragEnd} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 30, 0);
    firePointer('pointermove', window, 80, 40);
    firePointer('pointerup', window, 80, 40);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledWith(0, 80, 40);
  });

  it('a trailing click after a real drag does not re-invoke onSelectPanel (pointer-capture retarget guard)', () => {
    const onSelectPanel = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={onSelectPanel} onDragEnd={onDragEnd} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 80, 40); // past CLICK_THRESHOLD_PX
    firePointer('pointerup', window, 80, 40);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    onSelectPanel.mockClear(); // isolate: pointerdown already selected; only the trailing click matters here
    // setPointerCapture retargets the browser's synthetic trailing click back to the drag-origin <g>.
    fireEvent.click(g);
    expect(onSelectPanel).not.toHaveBeenCalled();
  });

  it('a plain click with no prior drag still selects the panel', () => {
    const onSelectPanel = vi.fn();
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={onSelectPanel} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    fireEvent.click(g);
    expect(onSelectPanel).toHaveBeenCalledWith(0);
  });

  it('an invalid drop calls onDragEnd once too (rejection/snap-back is the caller\'s job) and the ghost is removed after pointerup', () => {
    const onDragEnd = vi.fn();
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} onDragEnd={onDragEnd} />,
    );
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 5000, 0); // way out of bounds
    firePointer('pointerup', window, 5000, 0);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-nesting-drag-ghost]')).toBeNull();
  });

  it('idle render (editable, no drag active) keeps element counts unchanged — no ghost rect', () => {
    const twoPanelSheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 2, rowKey: 'r2', instanceIndex: 1, x: 700, y: 0, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    };
    render(
      <SheetSvg sheet={twoPanelSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} />,
    );
    const svg = document.querySelector('svg');
    // two panel rects + one sheet outline rect = 3 rects (no ghost while idle)
    expect(svg?.querySelectorAll('rect').length).toBe(3);
    expect(document.querySelector('[data-nesting-drag-ghost]')).toBeNull();
  });

  it('coordinate mapping scales client-pixel deltas by the real SVG render size', () => {
    const onDragEnd = vi.fn();
    render(
      <SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={null} onSelectPanel={() => {}} onDragEnd={onDragEnd} />,
    );
    const svg = document.querySelector('svg')!;
    // Rendered at half scale: rect.width/sheetLengthMm = 1220/2440 = 0.5 ⇒ px->mm factor = 2
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1220, height: 610, right: 1220, bottom: 610, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const g = screen.getByLabelText('Select panel #1');
    firePointer('pointerdown', g, 0, 0);
    firePointer('pointermove', window, 100, 40);
    firePointer('pointerup', window, 100, 40);
    expect(onDragEnd).toHaveBeenCalledWith(0, 200, 80);
  });

  it('gives the selected panel a distinct highlighted stroke', () => {
    const twoPanelSheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 1, rowKey: 'r1', instanceIndex: 1, x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 2, rowKey: 'r2', instanceIndex: 1, x: 700, y: 0, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    };
    render(
      <SheetSvg sheet={twoPanelSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}}
        editable selectedIndex={1} onSelectPanel={() => {}} />,
    );
    const groups = document.querySelectorAll('[data-nesting-panel]');
    const selectedRect = groups[1]!.querySelector('rect')!;
    const unselectedRect = groups[0]!.querySelector('rect')!;
    expect(selectedRect.getAttribute('stroke')).not.toBe(unselectedRect.getAttribute('stroke'));
  });
});
