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
});
