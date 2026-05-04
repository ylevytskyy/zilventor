import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BomTable } from '../BomTable';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { bomRowKey } from '@zilventor/shared/src/bomRow';

function seedAssembly(doc: AssemblyDocument): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: doc },
    activeAssembly: doc,
  } as any);
}

function makeAsm(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'demo', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: 'parts/cube.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'C2', partPath: 'parts/cube.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'C3', partPath: 'parts/shelf.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
    ...overrides,
  };
}

function rowFor(partName: string): HTMLElement {
  return screen.getByText(partName).closest('tr') as HTMLElement;
}

const basicPartInfo = (): Map<string, PartInfo> => new Map([
  ['parts/cube.zipt', { name: 'cube' }],
  ['parts/shelf.zipt', { name: 'shelf' }],
]);

describe('BomTable', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activeAssembly: null,
      selectedComponentPaths: [],
      subAssemblyDocs: {},
    } as any);
  });

  it('renders one row per aggregated row with Item#, QTY, partName', () => {
    seedAssembly(makeAsm());
    render(<BomTable partInfo={basicPartInfo()} />);
    expect(screen.getByText('cube')).toBeInTheDocument();
    expect(screen.getByText('shelf')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // header + 2 rows
    expect(rows.length).toBe(3);
    // cube row should have qty=2 (column index moved: Item# | Part # | Description | QTY | ...)
    const cubeRow = rowFor('cube');
    const cubeCells = within(cubeRow).getAllByRole('cell');
    expect(cubeCells[3]!.textContent).toBe('2'); // QTY
  });

  it('clicking a row calls selectComponents with the row component ids', () => {
    seedAssembly(makeAsm());
    render(<BomTable partInfo={basicPartInfo()} />);
    fireEvent.click(screen.getByText('cube'));
    const sel = useAppStore.getState().selectedComponentPaths;
    const leafIds = sel.map((p) => p[p.length - 1] ?? '');
    expect(leafIds.slice().sort()).toEqual(['C1', 'C2']);
  });

  it('clicking the Item# cell switches to inline input; blurring fires SetBomItemNumberCommand', () => {
    seedAssembly(makeAsm());
    render(<BomTable partInfo={basicPartInfo()} />);
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
    render(<BomTable partInfo={basicPartInfo()} />);
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
    render(<BomTable partInfo={basicPartInfo()} />);
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
    const partInfo = new Map<string, PartInfo>([['parts/cube.zipt', { name: 'cube' }]]);
    render(<BomTable partInfo={partInfo} />);
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
    const partInfo = new Map<string, PartInfo>([['parts/cube.zipt', { name: 'cube' }]]);
    render(<BomTable partInfo={partInfo} />);
    fireEvent.click(screen.getByText('Cherry'));
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__none__' } });
    const next = useAppStore.getState().activeAssembly!;
    expect(next.components[0]!.color).toBeUndefined();
    expect(next.components[1]!.color).toBeUndefined();
  });

  it('color picker on a sub-asm leaf row writes to colorOverrides for every leaf path', () => {
    const subAsmPath = 'sub.ziasm';
    const subDoc: AssemblyDocument = {
      id: 'S', name: 'sub', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'leaf-a', partPath: 'parts/cube.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'leaf-b', partPath: 'parts/cube.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    const top = makeAsm({
      colors: { Cherry: '#ff0000' },
      components: [
        { id: 'sub-id', partPath: subAsmPath,
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    seedAssembly(top);
    useAppStore.getState().setSubAssemblyDocs({ [subAsmPath]: subDoc });
    const partInfo = new Map<string, PartInfo>([['parts/cube.zipt', { name: 'cube' }]]);
    render(<BomTable partInfo={partInfo} />);
    // qty=2 row for cube via 2 leaves inside the sub-asm; QTY is 4th column
    const cubeRow = rowFor('cube');
    const cubeCells = within(cubeRow).getAllByRole('cell');
    expect(cubeCells[3]!.textContent).toBe('2');
    // Click the color cell (currently '—'), then pick palette Cherry
    fireEvent.click(within(cubeRow).getByText('—'));
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'palette:Cherry' } });
    const overrides = useAppStore.getState().activeDocument!.kind === 'assembly'
      ? (useAppStore.getState().activeDocument as { kind: 'assembly'; document: AssemblyDocument }).document.colorOverrides
      : {};
    const ka = pathKey(['sub-id', 'leaf-a']);
    const kb = pathKey(['sub-id', 'leaf-b']);
    expect(overrides[ka]).toEqual({ kind: 'palette', name: 'Cherry' });
    expect(overrides[kb]).toEqual({ kind: 'palette', name: 'Cherry' });
  });

  it('Export CSV button invokes ExportBomCsvCommand (showSaveFilePicker is called)', async () => {
    seedAssembly(makeAsm());
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
      render(<BomTable partInfo={basicPartInfo()} />);
      fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(picker).toHaveBeenCalled();
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });

  it('renders Part # and Description columns and shows their values for parts with iProperties', () => {
    seedAssembly(makeAsm());
    const partInfo = new Map<string, PartInfo>([
      ['parts/cube.zipt', { name: 'cube', partNumber: 'CUBE-001', description: 'A test cube' }],
      ['parts/shelf.zipt', { name: 'shelf' }],
    ]);
    render(<BomTable partInfo={partInfo} />);
    // Header columns include Part # and Description
    expect(screen.getByText('Part #')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    // cube row populates partNumber + description
    expect(screen.getByText('CUBE-001')).toBeInTheDocument();
    expect(screen.getByText('A test cube')).toBeInTheDocument();
    // shelf row leaves them as empty cells
    const shelfRow = rowFor('shelf');
    const shelfCells = within(shelfRow).getAllByRole('cell');
    expect(shelfCells[1]!.textContent).toBe('');
    expect(shelfCells[2]!.textContent).toBe('');
  });
});
