import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroovePropertiesPanel } from '../GroovePropertiesPanel';
import { useAppStore } from '../../store/useAppStore';
import type { GrooveFeature, MachiningPreset } from '@zilventor/shared';

const groove = (overrides: Partial<GrooveFeature> = {}): GrooveFeature => ({
  kind: 'groove', id: 'g1', faceRole: 'Front', axis: 'u', position: 10, width: 8, depth: 6,
  ...overrides,
});

function makeProps(g: GrooveFeature | null, partPath = 'parts/side.zipt') {
  const groovesMap = new Map<string, GrooveFeature[]>(g ? [[partPath, [g]]] : []);
  const getLiveGrooves = (p: string) => groovesMap.get(p);
  const doc = { featureTree: g ? [g] : [] };
  const getLiveDoc = (p: string) => (p === partPath ? doc : null);
  return { getLiveGrooves, getLiveDoc, opfs: null };
}

function setSelectedGroove(g: GrooveFeature | null, partPath = 'parts/side.zipt') {
  if (g) {
    useAppStore.getState().setSelectedGroove(g.id, partPath);
  } else {
    useAppStore.getState().setSelectedGroove(null, null);
  }
}

describe('GroovePropertiesPanel', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedGroove(null, null);
    useAppStore.setState({ machiningPresets: [] });
  });

  it('renders nothing when no groove is selected', () => {
    const { container } = render(<GroovePropertiesPanel {...makeProps(null)} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the groove current toolNumber/speed/presetLayerName', () => {
    const g = groove({ toolNumber: 3, speed: 12000, presetLayerName: 'GROOVE_LAYER' });
    setSelectedGroove(g);
    render(<GroovePropertiesPanel {...makeProps(g)} />);
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/12000/)).toBeInTheDocument();
    expect(screen.getByText(/GROOVE_LAYER/)).toBeInTheDocument();
  });

  const groovePreset = (): MachiningPreset => ({
    id: 'preset-groove', name: 'Groove std', opType: 'groove',
    diameter: 0, depth: 0, layerName: 'GROOVE_STD', toolNumber: 5, speed: 18000,
  });
  const borePreset = (): MachiningPreset => ({
    id: 'preset-bore', name: 'Bore std', opType: 'confirmat-face',
    diameter: 8, depth: 15, layerName: 'BORE_STD',
  });

  it('shows a preset picker listing only presets with opType === "groove"', () => {
    useAppStore.setState({ machiningPresets: [groovePreset(), borePreset()] });
    const g = groove();
    setSelectedGroove(g);
    render(<GroovePropertiesPanel {...makeProps(g)} />);
    const select = screen.getByLabelText(/machining preset/i) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain('Groove std');
    expect(optionLabels).not.toContain('Bore std');
  });

  it('does NOT show the preset picker when no groove presets exist', () => {
    useAppStore.setState({ machiningPresets: [borePreset()] });
    const g = groove();
    setSelectedGroove(g);
    render(<GroovePropertiesPanel {...makeProps(g)} />);
    expect(screen.queryByLabelText(/machining preset/i)).toBeNull();
  });

  it('Apply dispatches ApplyMachiningPresetCommand via bus.execute() (undoable), not a direct .apply() bypass', async () => {
    const preset = groovePreset();
    useAppStore.setState({ machiningPresets: [preset] });
    const g = groove();
    setSelectedGroove(g);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { ApplyMachiningPresetCommand } = await import('../../commands/ApplyMachiningPresetCommand');
    const applySpy = vi.spyOn(ApplyMachiningPresetCommand.prototype, 'apply');

    render(<GroovePropertiesPanel {...makeProps(g)} />);
    const select = screen.getByLabelText(/machining preset/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: preset.id } });
    const applyBtn = screen.getByRole('button', { name: /apply/i });
    fireEvent.click(applyBtn);

    expect(executeSpy).toHaveBeenCalled();
    expect(applySpy).toHaveBeenCalled();
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { groove: GrooveFeature; values: { layerName: string; toolNumber?: number; speed?: number; diameter?: number; depth?: number } };
    };
    expect(instance.opts.groove).toBe(g);
    expect(instance.opts.values.layerName).toBe('GROOVE_STD');
    expect(instance.opts.values.toolNumber).toBe(5);
    expect(instance.opts.values.speed).toBe(18000);
    // Invariant (D4): the panel must never snapshot diameter/depth for a groove target.
    expect('diameter' in instance.opts.values).toBe(false);
    expect('depth' in instance.opts.values).toBe(false);

    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  // ── P14 W2: inline-editable groove parameters ─────────────────────────────

  it('renders position/width/depth as editable numeric inputs seeded with current values', () => {
    const g = groove({ position: 10, width: 8, depth: 6 });
    setSelectedGroove(g);
    render(<GroovePropertiesPanel {...makeProps(g)} />);
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6')).toBeInTheDocument();
  });

  it('committing a numeric edit (Enter or blur) dispatches EditGrooveCommand via bus.execute() with the changed field', async () => {
    const g = groove({ width: 8, depth: 6 });
    setSelectedGroove(g);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditGrooveCommand } = await import('../../commands/EditGrooveCommand');
    const applySpy = vi.spyOn(EditGrooveCommand.prototype, 'apply');

    render(<GroovePropertiesPanel {...makeProps(g)} />);

    const widthInput = screen.getByDisplayValue('8') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '12' } });
    fireEvent.keyDown(widthInput, { key: 'Enter' });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
    const enterInstance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { groove: GrooveFeature; patch: Record<string, unknown> };
    };
    expect(enterInstance).toBeInstanceOf(EditGrooveCommand);
    expect(enterInstance.opts.groove).toBe(g);
    expect(enterInstance.opts.patch).toEqual({ width: 12 });

    const depthInput = screen.getByDisplayValue('6') as HTMLInputElement;
    fireEvent.change(depthInput, { target: { value: '15' } });
    fireEvent.blur(depthInput);

    expect(executeSpy).toHaveBeenCalledTimes(2);
    const blurInstance = executeSpy.mock.calls[1]![0] as unknown as {
      opts: { groove: GrooveFeature; patch: Record<string, unknown> };
    };
    expect(blurInstance.opts.patch).toEqual({ depth: 15 });

    executeSpy.mockRestore();
    applySpy.mockRestore();
  });

  it('changing the face-role select dispatches EditGrooveCommand with a faceRole patch', async () => {
    const g = groove({ faceRole: 'Front' });
    setSelectedGroove(g);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditGrooveCommand } = await import('../../commands/EditGrooveCommand');

    render(<GroovePropertiesPanel {...makeProps(g)} />);
    const select = screen.getByLabelText(/face/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Top' } });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { groove: GrooveFeature; patch: Record<string, unknown> };
    };
    expect(instance).toBeInstanceOf(EditGrooveCommand);
    expect(instance.opts.groove).toBe(g);
    expect(instance.opts.patch).toEqual({ faceRole: 'Top' });

    executeSpy.mockRestore();
  });

  it('changing the axis select dispatches EditGrooveCommand with an axis patch', async () => {
    const g = groove({ axis: 'u' });
    setSelectedGroove(g);

    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    const { EditGrooveCommand } = await import('../../commands/EditGrooveCommand');

    render(<GroovePropertiesPanel {...makeProps(g)} />);
    const select = screen.getByLabelText(/axis/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'v' } });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const instance = executeSpy.mock.calls[0]![0] as unknown as {
      opts: { groove: GrooveFeature; patch: Record<string, unknown> };
    };
    expect(instance).toBeInstanceOf(EditGrooveCommand);
    expect(instance.opts.groove).toBe(g);
    expect(instance.opts.patch).toEqual({ axis: 'v' });

    executeSpy.mockRestore();
  });
});
