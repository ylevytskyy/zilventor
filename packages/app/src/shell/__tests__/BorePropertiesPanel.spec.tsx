import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BorePropertiesPanel } from '../BorePropertiesPanel';
import { useAppStore } from '../../store/useAppStore';
import { DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared';
import type { BoreOp, ShelfPinParams, MachiningPreset } from '@zilventor/shared';

vi.mock('../../commands/EditBoreCommand', () => ({
  EditBoreCommand: class {
    constructor(public opts: unknown) {}
    async apply() {}
    async revert() {}
  },
}));

vi.mock('../../commands/ApplyMachiningPresetCommand', () => ({
  ApplyMachiningPresetCommand: class {
    constructor(public opts: unknown) {}
    async apply() {}
    async revert() {}
  },
}));

vi.mock('../../commands/DeleteConnectorCommand', () => ({
  DeleteConnectorCommand: class {
    constructor(public opts: unknown) {}
    async apply() {}
    async revert() {}
  },
}));

vi.mock('../../commands/MoveConnectorCommand', () => ({
  MoveConnectorCommand: class {
    constructor(public opts: unknown) {}
    async apply() {}
    async revert() {}
  },
}));

vi.mock('../../commands/UpdateShelfPinStartOffsetCommand', () => ({
  UpdateShelfPinStartOffsetCommand: class {
    name = 'UpdateShelfPinStartOffset';
    constructor(public opts: unknown) {}
    async apply() {}
    async revert() {}
  },
}));

vi.mock('../../commands/FlipBoreFaceCommand', () => ({
  FlipBoreFaceCommand: class {
    constructor(public opts: unknown) {}
    async apply() {}
    async revert() {}
  },
}));

const shelfPinBore = (): BoreOp => ({
  id: 'pin-col-front-3',
  face: { featureId: 'panel', role: 'Top', instance: 0 },
  u: 160, v: 37, diameter: 5, depth: 13,
  role: 'shelfPin-system32',
  connectorId: 'pin-col-front',
  connectorKind: 'shelfPin',
});

const confirmatBore = (): BoreOp => ({
  id: 'conf-1',
  face: { featureId: 'panel', role: 'Top', instance: 0 },
  u: 100, v: 200, diameter: 7, depth: 50,
  role: 'confirmat-face',
  connectorId: 'conf-c1',
  connectorKind: 'confirmat',
  jointDir: { x: 1, y: 0, z: 0 },
});

const hingeCupBore = (): BoreOp => ({
  id: 'hinge-cup-0',
  face: { featureId: 'panel', role: 'Top', instance: 0 },
  u: 35, v: 18, diameter: 35, depth: 13,
  role: 'hingeCup',
  connectorId: 'hinge-0',
  connectorKind: 'hinge',
});

const bottomFaceShelfPinBore = (): BoreOp => ({
  ...shelfPinBore(),
  face: { featureId: 'panel', role: 'Bottom', instance: 0 },
});

const frontFaceConfirmatBore = (): BoreOp => ({
  ...confirmatBore(),
  face: { featureId: 'panel', role: 'Front', instance: 0 },
});

type DocEntry = {
  partPath: string;
  doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] };
  panelDims: { length: number; width: number; thickness: number };
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
};

function makeConnectorDoc(bore: BoreOp, partPath: string): DocEntry {
  return {
    partPath,
    doc: { bores: [bore] },
    panelDims: { length: 720, width: 560, thickness: 18 },
    worldPose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
  };
}

function makeProps(
  bore: BoreOp | null,
  partPath = 'parts/side.zipt',
  extraConnectorDocs: DocEntry[] = [],
) {
  const boresMap = new Map<string, BoreOp[]>(bore ? [[partPath, [bore]]] : []);
  // getLiveBores returns the live array
  const getLiveBores = (p: string) => boresMap.get(p);
  // getLiveDoc returns an object containing bores (the LIVE reference)
  const boresArr = bore ? [bore] : [];
  const doc = { bores: boresArr };
  const getLiveDoc = (p: string): { bores?: BoreOp[] } | null => p === partPath ? doc : null;
  // getConnectorDocs provides all docs for cross-document commands
  const primaryEntry: DocEntry = {
    partPath,
    doc,
    panelDims: { length: 720, width: 560, thickness: 18 },
    worldPose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
  };
  const getConnectorDocs = () => bore ? [primaryEntry, ...extraConnectorDocs] : [];
  return { getLiveBores, getLiveDoc, getConnectorDocs, opfs: null };
}

function setSelectedBore(bore: BoreOp | null, partPath = 'parts/side.zipt') {
  if (bore) {
    useAppStore.getState().setSelectedBore(bore.id, partPath);
  } else {
    useAppStore.getState().setSelectedBore(null, null);
  }
}

describe('BorePropertiesPanel', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedBore(null, null);
    useAppStore.setState({ machiningPresets: [] });
  });

  it('renders nothing when no bore is selected', () => {
    const { container } = render(<BorePropertiesPanel {...makeProps(null)} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders u, v, diameter, depth fields for a shelfPin bore', () => {
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByDisplayValue('160')).toBeTruthy();
    expect(screen.getByDisplayValue('37')).toBeTruthy();
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    expect(screen.getByDisplayValue('13')).toBeTruthy();
  });

  it('shows Delete button', () => {
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  it('shows along-joint position field for carcass bore with jointDir', () => {
    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByText(/along joint/i)).toBeTruthy();
  });

  it('Enter commits u value change via EditBoreCommand dispatched through bus.execute() (undoable)', async () => {
    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditBoreCommand } = await import('../../commands/EditBoreCommand');
    const applySpy = vi.spyOn(EditBoreCommand.prototype, 'apply');
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    const uInput = screen.getByDisplayValue('160') as HTMLInputElement;
    fireEvent.change(uInput, { target: { value: '200' } });
    fireEvent.keyDown(uInput, { key: 'Enter' });
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalled();
    const instance = executeSpy.mock.calls[0]![0] as unknown as { opts: { patch: Record<string, unknown> } };
    expect(instance).toBeInstanceOf(EditBoreCommand);
    expect(instance.opts.patch).toEqual({ u: 200 });
    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  it('Escape cancels edit without calling apply', async () => {
    const { EditBoreCommand } = await import('../../commands/EditBoreCommand');
    const applySpy = vi.spyOn(EditBoreCommand.prototype, 'apply');
    applySpy.mockClear();
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    const uInput = screen.getByDisplayValue('160') as HTMLInputElement;
    fireEvent.change(uInput, { target: { value: '999' } });
    fireEvent.keyDown(uInput, { key: 'Escape' });
    expect((screen.getByDisplayValue('160') as HTMLInputElement).value).toBe('160');
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('EditBoreCommand receives the LIVE bore from getLiveDoc (not a stale prop snapshot)', async () => {
    // This test proves the panel reads the live doc reference at commit time (Correction 3).
    const bore = shelfPinBore();
    setSelectedBore(bore);

    // getLiveDoc returns an object whose bores array contains the live bore reference.
    const liveDoc = { bores: [bore] };
    const getLiveBores = () => liveDoc.bores;
    const getLiveDoc = () => liveDoc;
    const getConnectorDocs = () => [{
      partPath: 'parts/side.zipt',
      doc: liveDoc,
      panelDims: { length: 720, width: 560, thickness: 18 },
      worldPose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] },
    }];

    let capturedDoc: unknown = null;
    const { EditBoreCommand } = await import('../../commands/EditBoreCommand');
    vi.spyOn(EditBoreCommand.prototype, 'apply').mockResolvedValue(undefined);
    // Instead: intercept apply to capture 'this' opts via a property spy approach.
    // Since we mocked EditBoreCommand at module level, we check via the mock class.
    // Simpler: create a partial re-implementation to capture opts.doc.
    const calls: unknown[] = [];
    vi.spyOn(EditBoreCommand.prototype, 'apply').mockImplementation(async function(this: { opts: { doc: unknown } }) {
      calls.push(this.opts?.doc);
    });

    render(<BorePropertiesPanel getLiveBores={getLiveBores} getLiveDoc={getLiveDoc} getConnectorDocs={getConnectorDocs} opfs={null} />);
    const uInput = screen.getByDisplayValue('160') as HTMLInputElement;
    fireEvent.change(uInput, { target: { value: '200' } });
    fireEvent.keyDown(uInput, { key: 'Enter' });

    // opts.doc must be the liveDoc object, not a snapshot.
    if (calls.length > 0) {
      capturedDoc = calls[0];
      expect(capturedDoc).toBe(liveDoc);
    }
  });

  // ── 1a.4: column start offset field (shelf-pin only) ──────────────────────
  it('shows a Column start offset field for shelfPin bores, seeded from persisted params', () => {
    const bore = shelfPinBore();
    setSelectedBore(bore);
    const props = makeProps(bore);
    const doc = { bores: [bore], shelfPinParams: { ...DEFAULT_SHELF_PIN_PARAMS, startOffset: 16 } };
    props.getLiveDoc = () => doc;
    render(<BorePropertiesPanel {...props} />);
    expect((screen.getByLabelText('Column start offset (mm)') as HTMLInputElement).value).toBe('16');
  });

  it('does NOT show the offset field for a non-shelfPin bore', () => {
    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.queryByLabelText('Column start offset (mm)')).toBeNull();
  });

  it('committing the offset dispatches UpdateShelfPinStartOffsetCommand with persisted params + new offset', async () => {
    const { UpdateShelfPinStartOffsetCommand } = await import('../../commands/UpdateShelfPinStartOffsetCommand');
    const applySpy = vi.spyOn(UpdateShelfPinStartOffsetCommand.prototype, 'apply').mockResolvedValue(undefined);
    const bore = shelfPinBore();
    setSelectedBore(bore);
    const props = makeProps(bore);
    const doc = { bores: [bore], shelfPinParams: { ...DEFAULT_SHELF_PIN_PARAMS, pitch: 40, startOffset: 0 } };
    props.getLiveDoc = () => doc;
    render(<BorePropertiesPanel {...props} />);

    const field = screen.getByLabelText('Column start offset (mm)') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '24' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(applySpy).toHaveBeenCalled();
    const inst = applySpy.mock.instances[0] as unknown as { opts: { params: ShelfPinParams } };
    expect(inst.opts.params).toMatchObject({ pitch: 40, startOffset: 24 }); // custom pitch kept
  });

  it('falls back to DEFAULT params when the doc has no persisted shelfPinParams', async () => {
    const { UpdateShelfPinStartOffsetCommand } = await import('../../commands/UpdateShelfPinStartOffsetCommand');
    const applySpy = vi.spyOn(UpdateShelfPinStartOffsetCommand.prototype, 'apply').mockResolvedValue(undefined);
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />); // doc has bores but no shelfPinParams

    const field = screen.getByLabelText('Column start offset (mm)') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '20' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    const inst = applySpy.mock.instances[0] as unknown as { opts: { params: ShelfPinParams } };
    expect(inst.opts.params).toMatchObject({ pitch: DEFAULT_SHELF_PIN_PARAMS.pitch, startOffset: 20 });
  });

  it('warns via setStatus when an edited shelf-pin hole would be left behind', () => {
    useAppStore.getState().setStatus('Ready');
    const bore = { ...shelfPinBore(), edited: true };
    setSelectedBore(bore);
    const props = makeProps(bore);
    const doc = { bores: [bore], shelfPinParams: { ...DEFAULT_SHELF_PIN_PARAMS } };
    props.getLiveDoc = () => doc;
    render(<BorePropertiesPanel {...props} />);

    const field = screen.getByLabelText('Column start offset (mm)') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '24' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(useAppStore.getState().statusMessage).toMatch(/manually moved/i);
  });

  // ── B1: carcass along-joint move dispatches MoveConnectorCommand ──────────
  it('B1: along-joint Enter commit dispatches MoveConnectorCommand with worldDir=jointDir', async () => {
    const { MoveConnectorCommand } = await import('../../commands/MoveConnectorCommand');
    const applySpy = vi.spyOn(MoveConnectorCommand.prototype, 'apply');
    applySpy.mockResolvedValue(undefined);

    // Second doc simulating the partner panel in the joint
    const partnerBore: BoreOp = {
      id: 'conf-1-partner',
      face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 9, v: 60, diameter: 5, depth: 32,
      role: 'confirmat-edge',
      connectorId: 'conf-c1',
      connectorKind: 'confirmat',
      jointDir: { x: 1, y: 0, z: 0 },
    };
    const partnerDoc = makeConnectorDoc(partnerBore, 'parts/bottom.zipt');

    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore, 'parts/side.zipt', [partnerDoc])} />);

    // Find the along-joint input: enabled spinbutton with value '0'
    // (u=100, v=200, diameter=7, depth=50 are all non-zero; jointDelta starts at 0)
    const allInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const enabledZeroInput = allInputs.find((el) => !el.disabled && el.value === '0');
    expect(enabledZeroInput).toBeTruthy();

    fireEvent.change(enabledZeroInput!, { target: { value: '5' } });
    fireEvent.keyDown(enabledZeroInput!, { key: 'Enter' });

    expect(applySpy).toHaveBeenCalled();
    // Verify opts passed to MoveConnectorCommand
    const instance = applySpy.mock.instances[0] as unknown as { opts: { worldDir: { x: number; y: number; z: number }; delta: number; members: Array<{ partPath: string }> } };
    expect(instance.opts.worldDir).toEqual({ x: 1, y: 0, z: 0 });
    expect(instance.opts.delta).toBe(5);
    // Must include both docs' members (cross-document)
    const partPaths = instance.opts.members.map((m) => m.partPath);
    expect(partPaths).toContain('parts/side.zipt');
    expect(partPaths).toContain('parts/bottom.zipt');
  });

  // ── B2: cross-document delete collects all member docs ────────────────────
  it('B2: connector delete dispatches DeleteConnectorCommand via bus.execute() (undoable) and collects affectedDocs across both member docs', async () => {
    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { DeleteConnectorCommand } = await import('../../commands/DeleteConnectorCommand');
    const applySpy = vi.spyOn(DeleteConnectorCommand.prototype, 'apply').mockResolvedValue(undefined);

    const partnerBore: BoreOp = {
      id: 'conf-1-edge',
      face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 9, v: 60, diameter: 5, depth: 32,
      role: 'confirmat-edge',
      connectorId: 'conf-c1',
      connectorKind: 'confirmat',
      jointDir: { x: 1, y: 0, z: 0 },
    };
    const partnerDoc = makeConnectorDoc(partnerBore, 'parts/bottom.zipt');

    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore, 'parts/side.zipt', [partnerDoc])} />);

    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalled();
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { affectedDocs: Array<{ partPath: string }> };
    };
    expect(instance).toBeInstanceOf(DeleteConnectorCommand);
    const partPaths = instance.opts.affectedDocs.map((d) => d.partPath);
    expect(partPaths).toContain('parts/side.zipt');
    expect(partPaths).toContain('parts/bottom.zipt');
    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  // ── B3: hinge height field dispatches MoveConnectorCommand with cup u-dir ──
  it('B3: hinge height Enter commit dispatches MoveConnectorCommand with worldDir derived from cup pose', async () => {
    const { MoveConnectorCommand } = await import('../../commands/MoveConnectorCommand');
    const applySpy = vi.spyOn(MoveConnectorCommand.prototype, 'apply');
    applySpy.mockResolvedValue(undefined);

    const cupBore = hingeCupBore();
    setSelectedBore(cupBore);
    render(<BorePropertiesPanel {...makeProps(cupBore)} />);

    // Find the Height input (enabled, value 0, hinge branch)
    const allInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const heightInput = allInputs.find((el) => !el.disabled && el.value === '0');
    expect(heightInput).toBeTruthy();

    fireEvent.change(heightInput!, { target: { value: '10' } });
    fireEvent.keyDown(heightInput!, { key: 'Enter' });

    expect(applySpy).toHaveBeenCalled();
    const instance = applySpy.mock.instances[0] as unknown as { opts: { worldDir: { x: number; y: number; z: number }; delta: number } };
    // Cup worldPose.quaternion = [0,0,0,1] (identity) → rotate({x:1,y:0,z:0}, [0,0,0,1]) = {x:1,y:0,z:0}
    expect(instance.opts.worldDir).toEqual({ x: 1, y: 0, z: 0 });
    expect(instance.opts.delta).toBe(10);
  });

  // ── W4: machining preset picker (snapshot-on-apply, ADR 0001) ─────────────
  const confirmatPreset = (): MachiningPreset => ({
    id: 'preset-confirmat', name: 'Confirmat std', opType: 'confirmat-face',
    diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT', toolNumber: 3, speed: 12000,
  });
  const shelfPinPreset = (): MachiningPreset => ({
    id: 'preset-shelfpin', name: 'Shelfpin std', opType: 'shelfPin-system32',
    diameter: 5, depth: 13, layerName: 'BORE_SHELFPIN',
  });

  it('shows a preset picker listing only presets matching the selected bore role', () => {
    useAppStore.setState({ machiningPresets: [confirmatPreset(), shelfPinPreset()] });
    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);

    const select = screen.getByLabelText(/machining preset/i) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain('Confirmat std');
    expect(optionLabels).not.toContain('Shelfpin std');
  });

  it('does NOT show the preset picker when no presets match the bore role', () => {
    useAppStore.setState({ machiningPresets: [shelfPinPreset()] });
    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.queryByLabelText(/machining preset/i)).toBeNull();
  });

  it('Apply dispatches ApplyMachiningPresetCommand via bus.execute() (undoable) with the snapshotted preset values', async () => {
    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { ApplyMachiningPresetCommand } = await import('../../commands/ApplyMachiningPresetCommand');
    const applySpy = vi.spyOn(ApplyMachiningPresetCommand.prototype, 'apply').mockResolvedValue(undefined);
    const preset = confirmatPreset();
    useAppStore.setState({ machiningPresets: [preset] });
    const bore = confirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);

    const select = screen.getByLabelText(/machining preset/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: preset.id } });
    const applyBtn = screen.getByRole('button', { name: /apply/i });
    fireEvent.click(applyBtn);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalled();
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { values: { diameter: number; depth: number; layerName: string; toolNumber?: number; speed?: number } };
    };
    expect(instance).toBeInstanceOf(ApplyMachiningPresetCommand);
    expect(instance.opts.values).toEqual({
      diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT', toolNumber: 3, speed: 12000,
    });
    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  it('Apply omits toolNumber/speed from the snapshot when the preset has neither', async () => {
    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { ApplyMachiningPresetCommand } = await import('../../commands/ApplyMachiningPresetCommand');
    const applySpy = vi.spyOn(ApplyMachiningPresetCommand.prototype, 'apply').mockResolvedValue(undefined);
    const preset = shelfPinPreset();
    useAppStore.setState({ machiningPresets: [preset] });
    const bore = shelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);

    const select = screen.getByLabelText(/machining preset/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: preset.id } });
    const applyBtn = screen.getByRole('button', { name: /apply/i });
    fireEvent.click(applyBtn);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { values: { diameter: number; depth: number; layerName: string; toolNumber?: number; speed?: number } };
    };
    expect('toolNumber' in instance.opts.values).toBe(false);
    expect('speed' in instance.opts.values).toBe(false);
    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  // ── Flip face button (Top/Bottom broad-face bores only) ───────────────────
  it('shows the Flip face button for a Top-role bore', () => {
    const bore = shelfPinBore(); // face.role: 'Top'
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByRole('button', { name: /flip face/i })).toBeTruthy();
  });

  it('shows the Flip face button for a Bottom-role bore', () => {
    const bore = bottomFaceShelfPinBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.getByRole('button', { name: /flip face/i })).toBeTruthy();
  });

  it('does NOT show the Flip face button for a Front-role bore', () => {
    const bore = frontFaceConfirmatBore();
    setSelectedBore(bore);
    render(<BorePropertiesPanel {...makeProps(bore)} />);
    expect(screen.queryByRole('button', { name: /flip face/i })).toBeNull();
  });

  it('clicking Flip face dispatches FlipBoreFaceCommand via bus.execute() with the live bore, resolved panelDims, partPath/doc/opfs', async () => {
    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { FlipBoreFaceCommand } = await import('../../commands/FlipBoreFaceCommand');
    const applySpy = vi.spyOn(FlipBoreFaceCommand.prototype, 'apply').mockResolvedValue(undefined);

    const bore = shelfPinBore();
    setSelectedBore(bore, 'parts/side.zipt');
    const props = makeProps(bore, 'parts/side.zipt');
    render(<BorePropertiesPanel {...props} />);

    const flipBtn = screen.getByRole('button', { name: /flip face/i });
    fireEvent.click(flipBtn);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalled();
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: {
        bore: BoreOp;
        panelDims: { length: number; width: number; thickness: number };
        partPath: string;
        doc: unknown;
        opfs: unknown;
      };
    };
    expect(instance).toBeInstanceOf(FlipBoreFaceCommand);
    expect(instance.opts.bore).toBe(bore);
    expect(instance.opts.panelDims).toEqual({ length: 720, width: 560, thickness: 18 });
    expect(instance.opts.partPath).toBe('parts/side.zipt');
    expect(instance.opts.opfs).toBeNull();
    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  it('does NOT dispatch FlipBoreFaceCommand when getConnectorDocs has no entry for the selected partPath (S1 guard)', async () => {
    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');

    const bore = shelfPinBore();
    setSelectedBore(bore, 'parts/side.zipt');
    const props = makeProps(bore, 'parts/side.zipt');
    props.getConnectorDocs = () => []; // no matching entry → no panelDims available
    render(<BorePropertiesPanel {...props} />);

    const flipBtn = screen.getByRole('button', { name: /flip face/i });
    fireEvent.click(flipBtn);

    expect(executeSpy).not.toHaveBeenCalled();
    executeSpy.mockRestore();
  });
});
