import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BomTable } from '../BomTable';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';
import { bomRowKey } from '@zilventor/shared/src/bomRow';

function seedAssembly(doc: AssemblyDocument): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: doc },
    activeAssembly: doc,
  } as any);
}

function makeAsm(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'demo', units: 'mm', parameters: {},
    components: [
      { id: 'C1', partPath: 'parts/cube.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'C2', partPath: 'parts/cube.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'C3', partPath: 'parts/shelf.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [],
    groundedComponentIds: [],
    colors: {},
    bomItemNumbers: {},
    ...overrides,
  };
}

function rowFor(partName: string): HTMLElement {
  return screen.getByText(partName).closest('tr') as HTMLElement;
}

describe('BomTable', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activeAssembly: null,
      selectedComponentIds: [],
    } as any);
  });

  it('renders one row per aggregated row with Item#, QTY, partName', () => {
    seedAssembly(makeAsm());
    const partNames = new Map([
      ['parts/cube.zipt', 'cube'],
      ['parts/shelf.zipt', 'shelf'],
    ]);
    render(<BomTable partNames={partNames} />);
    expect(screen.getByText('cube')).toBeInTheDocument();
    expect(screen.getByText('shelf')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // header + 2 rows
    expect(rows.length).toBe(3);
    // cube row should have qty=2
    const cubeRow = rowFor('cube');
    const cubeCells = within(cubeRow).getAllByRole('cell');
    expect(cubeCells[1]!.textContent).toBe('2'); // QTY
  });

  it('clicking a row calls selectComponents with the row component ids', () => {
    seedAssembly(makeAsm());
    const partNames = new Map([
      ['parts/cube.zipt', 'cube'],
      ['parts/shelf.zipt', 'shelf'],
    ]);
    render(<BomTable partNames={partNames} />);
    fireEvent.click(screen.getByText('cube'));
    const sel = useAppStore.getState().selectedComponentIds;
    expect(sel.slice().sort()).toEqual(['C1', 'C2']);
  });

  it('clicking the Item# cell switches to inline input; blurring fires SetBomItemNumberCommand', () => {
    seedAssembly(makeAsm());
    const partNames = new Map([
      ['parts/cube.zipt', 'cube'],
      ['parts/shelf.zipt', 'shelf'],
    ]);
    render(<BomTable partNames={partNames} />);
    const cubeKey = bomRowKey('parts/cube.zipt', undefined);
    const cubeRow = rowFor('cube');
    const cubeItemCell = within(cubeRow).getAllByRole('cell')[0]!;
    fireEvent.click(within(cubeItemCell).getByText('1'));
    const input = screen.getByLabelText(`item-number-${cubeKey}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(useAppStore.getState().activeAssembly!.bomItemNumbers[cubeKey]).toBe(5);
  });

  it('inline-edit conflict bumps colliding row', () => {
    const cubeKey = bomRowKey('parts/cube.zipt', undefined);
    const shelfKey = bomRowKey('parts/shelf.zipt', undefined);
    seedAssembly(makeAsm({ bomItemNumbers: { [cubeKey]: 1, [shelfKey]: 2 } }));
    const partNames = new Map([
      ['parts/cube.zipt', 'cube'],
      ['parts/shelf.zipt', 'shelf'],
    ]);
    render(<BomTable partNames={partNames} />);
    const cubeRow = rowFor('cube');
    const cubeItemCell = within(cubeRow).getAllByRole('cell')[0]!;
    fireEvent.click(within(cubeItemCell).getByText('1'));
    const input = screen.getByLabelText(`item-number-${cubeKey}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map[cubeKey]).toBe(2);
    expect(map[shelfKey]).toBe(3);
  });

  it('inline-edit invalid input leaves bomItemNumbers unchanged', () => {
    const cubeKey = bomRowKey('parts/cube.zipt', undefined);
    const shelfKey = bomRowKey('parts/shelf.zipt', undefined);
    seedAssembly(makeAsm({ bomItemNumbers: { [cubeKey]: 1, [shelfKey]: 2 } }));
    const partNames = new Map([
      ['parts/cube.zipt', 'cube'],
      ['parts/shelf.zipt', 'shelf'],
    ]);
    render(<BomTable partNames={partNames} />);
    const cubeRow = rowFor('cube');
    const cubeItemCell = within(cubeRow).getAllByRole('cell')[0]!;
    fireEvent.click(within(cubeItemCell).getByText('1'));
    const input = screen.getByLabelText(`item-number-${cubeKey}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abcd' } });
    fireEvent.blur(input);
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map[cubeKey]).toBe(1);
    expect(map[shelfKey]).toBe(2);
  });

  it('renders — for unassigned color and palette name when set', () => {
    const asm = makeAsm({
      colors: { Cherry: '#ff0000' },
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/cube.zipt',
          color: { kind: 'palette', name: 'Cherry' },
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    seedAssembly(asm);
    const partNames = new Map([['parts/cube.zipt', 'cube']]);
    render(<BomTable partNames={partNames} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Cherry')).toBeInTheDocument();
  });

  it('clicking a Color cell mounts ColorPicker; choosing (no color) clears color for every componentId in the row', () => {
    const asm = makeAsm({
      colors: { Cherry: '#ff0000' },
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt',
          color: { kind: 'palette', name: 'Cherry' },
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/cube.zipt',
          color: { kind: 'palette', name: 'Cherry' },
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    seedAssembly(asm);
    const partNames = new Map([['parts/cube.zipt', 'cube']]);
    render(<BomTable partNames={partNames} />);
    fireEvent.click(screen.getByText('Cherry'));
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__none__' } });
    const next = useAppStore.getState().activeAssembly!;
    expect(next.components[0]!.color).toBeUndefined();
    expect(next.components[1]!.color).toBeUndefined();
  });

  it('Export CSV button invokes ExportBomCsvCommand (showSaveFilePicker is called)', async () => {
    seedAssembly(makeAsm());
    const partNames = new Map([
      ['parts/cube.zipt', 'cube'],
      ['parts/shelf.zipt', 'shelf'],
    ]);
    const writes: Uint8Array[] = [];
    const mockHandle = {
      createWritable: async () => ({
        write: async (b: Uint8Array) => { writes.push(b); },
        close: async () => {},
      }),
    };
    const picker = vi.fn(async () => mockHandle);
    (globalThis as any).showSaveFilePicker = picker;
    try {
      render(<BomTable partNames={partNames} />);
      fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(picker).toHaveBeenCalled();
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });
});
