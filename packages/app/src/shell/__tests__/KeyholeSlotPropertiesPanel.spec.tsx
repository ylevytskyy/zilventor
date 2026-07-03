import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyholeSlotPropertiesPanel } from '../KeyholeSlotPropertiesPanel';
import { useAppStore } from '../../store/useAppStore';
import type { KeyholeSlotFeature } from '@zilventor/shared';

const keyholeSlot = (overrides: Partial<KeyholeSlotFeature> = {}): KeyholeSlotFeature => ({
  kind: 'keyholeSlot', id: 'k1', faceRole: 'Bottom', u: 150, v: 80, axis: 'u', direction: 1,
  entryDiameter: 15, slotWidth: 8, slotLength: 25, depth: 6,
  ...overrides,
});

function makeProps(k: KeyholeSlotFeature | null, partPath = 'parts/side.zipt') {
  const keyholeSlotsMap = new Map<string, KeyholeSlotFeature[]>(k ? [[partPath, [k]]] : []);
  const getLiveKeyholeSlots = (p: string) => keyholeSlotsMap.get(p);
  const doc = { featureTree: k ? [k] : [] };
  const getLiveDoc = (p: string) => (p === partPath ? doc : null);
  return { getLiveKeyholeSlots, getLiveDoc, opfs: null };
}

function setSelectedKeyholeSlot(k: KeyholeSlotFeature | null, partPath = 'parts/side.zipt') {
  if (k) {
    useAppStore.getState().setSelectedKeyholeSlot(k.id, partPath);
  } else {
    useAppStore.getState().setSelectedKeyholeSlot(null, null);
  }
}

describe('KeyholeSlotPropertiesPanel', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedKeyholeSlot(null, null);
  });

  it('renders nothing when no keyhole slot is selected', () => {
    const { container } = render(<KeyholeSlotPropertiesPanel {...makeProps(null)} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the keyhole slot current toolNumber/speed/presetLayerName', () => {
    const k = keyholeSlot({ toolNumber: 3, speed: 12000, presetLayerName: 'KEYHOLE_LAYER' });
    setSelectedKeyholeSlot(k);
    render(<KeyholeSlotPropertiesPanel {...makeProps(k)} />);
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/12000/)).toBeInTheDocument();
    expect(screen.getByText(/KEYHOLE_LAYER/)).toBeInTheDocument();
  });

  it('renders u/v/entryDiameter/slotWidth/slotLength/depth as editable numeric inputs seeded with current values', () => {
    const k = keyholeSlot({ u: 150, v: 80, entryDiameter: 15, slotWidth: 8, slotLength: 25, depth: 6 });
    setSelectedKeyholeSlot(k);
    render(<KeyholeSlotPropertiesPanel {...makeProps(k)} />);
    expect(screen.getByDisplayValue('150')).toBeInTheDocument();
    expect(screen.getByDisplayValue('80')).toBeInTheDocument();
    expect(screen.getByDisplayValue('15')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6')).toBeInTheDocument();
  });

  it('committing a numeric edit (Enter or blur) dispatches EditKeyholeSlotCommand via bus.execute() with the changed field', async () => {
    const k = keyholeSlot({ slotWidth: 8, depth: 6 });
    setSelectedKeyholeSlot(k);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditKeyholeSlotCommand } = await import('../../commands/EditKeyholeSlotCommand');
    const applySpy = vi.spyOn(EditKeyholeSlotCommand.prototype, 'apply');

    render(<KeyholeSlotPropertiesPanel {...makeProps(k)} />);

    const slotWidthInput = screen.getByDisplayValue('8') as HTMLInputElement;
    fireEvent.change(slotWidthInput, { target: { value: '12' } });
    fireEvent.keyDown(slotWidthInput, { key: 'Enter' });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
    const enterInstance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { keyholeSlot: KeyholeSlotFeature; patch: Record<string, unknown> };
    };
    expect(enterInstance).toBeInstanceOf(EditKeyholeSlotCommand);
    expect(enterInstance.opts.keyholeSlot).toBe(k);
    expect(enterInstance.opts.patch).toEqual({ slotWidth: 12 });

    const depthInput = screen.getByDisplayValue('6') as HTMLInputElement;
    fireEvent.change(depthInput, { target: { value: '15' } });
    fireEvent.blur(depthInput);

    expect(executeSpy).toHaveBeenCalledTimes(2);
    const blurInstance = executeSpy.mock.calls[1]![0] as unknown as {
      opts: { keyholeSlot: KeyholeSlotFeature; patch: Record<string, unknown> };
    };
    expect(blurInstance.opts.patch).toEqual({ depth: 15 });

    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  it('changing the face-role select dispatches EditKeyholeSlotCommand with a faceRole patch', async () => {
    const k = keyholeSlot({ faceRole: 'Bottom' });
    setSelectedKeyholeSlot(k);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditKeyholeSlotCommand } = await import('../../commands/EditKeyholeSlotCommand');

    render(<KeyholeSlotPropertiesPanel {...makeProps(k)} />);
    const select = screen.getByLabelText(/face/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Top' } });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { keyholeSlot: KeyholeSlotFeature; patch: Record<string, unknown> };
    };
    expect(instance).toBeInstanceOf(EditKeyholeSlotCommand);
    expect(instance.opts.keyholeSlot).toBe(k);
    expect(instance.opts.patch).toEqual({ faceRole: 'Top' });

    executeSpy.mockRestore();
  });

  it('changing the axis select dispatches EditKeyholeSlotCommand with an axis patch', async () => {
    const k = keyholeSlot({ axis: 'u' });
    setSelectedKeyholeSlot(k);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditKeyholeSlotCommand } = await import('../../commands/EditKeyholeSlotCommand');

    render(<KeyholeSlotPropertiesPanel {...makeProps(k)} />);
    const select = screen.getByLabelText(/axis/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'v' } });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { keyholeSlot: KeyholeSlotFeature; patch: Record<string, unknown> };
    };
    expect(instance).toBeInstanceOf(EditKeyholeSlotCommand);
    expect(instance.opts.keyholeSlot).toBe(k);
    expect(instance.opts.patch).toEqual({ axis: 'v' });

    executeSpy.mockRestore();
  });

  it('changing the direction select dispatches EditKeyholeSlotCommand with a direction patch as a number', async () => {
    const k = keyholeSlot({ direction: 1 });
    setSelectedKeyholeSlot(k);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditKeyholeSlotCommand } = await import('../../commands/EditKeyholeSlotCommand');

    render(<KeyholeSlotPropertiesPanel {...makeProps(k)} />);
    const select = screen.getByLabelText(/direction/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '-1' } });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { keyholeSlot: KeyholeSlotFeature; patch: Record<string, unknown> };
    };
    expect(instance).toBeInstanceOf(EditKeyholeSlotCommand);
    expect(instance.opts.keyholeSlot).toBe(k);
    expect(instance.opts.patch).toEqual({ direction: -1 });
    expect(typeof instance.opts.patch.direction).toBe('number');

    executeSpy.mockRestore();
  });
});
