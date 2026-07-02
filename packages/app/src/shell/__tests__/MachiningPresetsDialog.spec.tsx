import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MachiningPresetsDialog } from '../MachiningPresetsDialog';
import { useAppStore } from '../../store/useAppStore';
import * as fsaFallback from '../fsaFallback';
import type { MachiningPreset } from '@zilventor/shared';

const preset1: MachiningPreset = {
  id: 'p1', name: 'Confirmat std', opType: 'confirmat-face',
  diameter: 5, depth: 13, layerName: 'CONFIRMAT',
};
const preset2: MachiningPreset = {
  id: 'p2', name: 'Groove std', opType: 'groove',
  diameter: 8, depth: 10, layerName: 'GROOVE', toolNumber: 3, speed: 18000,
};

beforeEach(() => {
  useAppStore.getState().toggleMachiningPresetsDialog(false);
  useAppStore.setState({ machiningPresets: [] });
});

describe('MachiningPresetsDialog', () => {
  it('renders nothing when machiningPresetsDialogOpen is false', () => {
    render(<MachiningPresetsDialog />);
    expect(screen.queryByRole('dialog', { name: /machining presets/i })).toBeNull();
  });

  it('renders the dialog when open', () => {
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    render(<MachiningPresetsDialog />);
    expect(screen.getByRole('dialog', { name: /machining presets/i })).toBeTruthy();
  });

  it('lists existing presets from the store', () => {
    useAppStore.setState({ machiningPresets: [preset1, preset2] });
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    render(<MachiningPresetsDialog />);
    expect(screen.getByText('Confirmat std')).toBeTruthy();
    expect(screen.getByText('Groove std')).toBeTruthy();
  });

  it('Esc key closes the dialog', () => {
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    render(<MachiningPresetsDialog />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useAppStore.getState().machiningPresetsDialogOpen).toBe(false);
  });

  it('add fills the form and creates a preset with only the provided optional fields present', () => {
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    render(<MachiningPresetsDialog />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'My Preset' } });
    fireEvent.change(screen.getByLabelText(/operation type/i), { target: { value: 'hingeCup' } });
    fireEvent.change(screen.getByLabelText(/ø \(mm\)/i), { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText(/depth/i), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/layer name/i), { target: { value: 'HINGE_CUP' } });
    // offset/toolNumber/speed left blank
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const stored = useAppStore.getState().machiningPresets;
    expect(stored).toHaveLength(1);
    const p = stored[0]!;
    expect(p.name).toBe('My Preset');
    expect(p.opType).toBe('hingeCup');
    expect(p.diameter).toBe(35);
    expect(p.depth).toBe(12);
    expect(p.layerName).toBe('HINGE_CUP');
    expect('offset' in p).toBe(false);
    expect('toolNumber' in p).toBe(false);
    expect('speed' in p).toBe(false);
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBeGreaterThan(0);
  });

  it('add with optional fields filled includes them on the created preset', () => {
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    render(<MachiningPresetsDialog />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'With optionals' } });
    fireEvent.change(screen.getByLabelText(/ø \(mm\)/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/depth/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/layer name/i), { target: { value: 'L' } });
    fireEvent.change(screen.getByLabelText(/offset/i), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText(/tool #/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/speed/i), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const p = useAppStore.getState().machiningPresets[0]!;
    expect(p.offset).toBe(2.5);
    expect(p.toolNumber).toBe(4);
    expect(p.speed).toBe(12000);
  });

  it('edit populates the form and Save updates the existing preset in place', () => {
    useAppStore.setState({ machiningPresets: [preset1] });
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    render(<MachiningPresetsDialog />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Confirmat std');

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Confirmat renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const stored = useAppStore.getState().machiningPresets;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe('p1');
    expect(stored[0]!.name).toBe('Confirmat renamed');
  });

  it('delete removes the preset from the store', () => {
    useAppStore.setState({ machiningPresets: [preset1, preset2] });
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    render(<MachiningPresetsDialog />);

    fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]!);

    const stored = useAppStore.getState().machiningPresets;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe('p2');
  });

  /** jsdom's File/Blob lack .text()/.arrayBuffer() — stub the minimal shape the dialog needs. */
  function fakeFile(text: string): File {
    return { text: () => Promise.resolve(text) } as unknown as File;
  }

  function readBlobText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsText(blob);
    });
  }

  it('import happy path parses the file and adds validated presets to the store', async () => {
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    const json = JSON.stringify([{ id: 'imp1', name: 'Imported', opType: 'groove', diameter: 8, depth: 10, layerName: 'GROOVE' }]);
    vi.spyOn(fsaFallback, 'pickFile').mockResolvedValue(fakeFile(json));

    render(<MachiningPresetsDialog />);
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await screen.findByText('Imported');

    const stored = useAppStore.getState().machiningPresets;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe('imp1');
  });

  it('import with invalid JSON shows an error and does not modify the store', async () => {
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    vi.spyOn(fsaFallback, 'pickFile').mockResolvedValue(fakeFile('not json'));

    render(<MachiningPresetsDialog />);
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/import failed/i);
    expect(useAppStore.getState().machiningPresets).toHaveLength(0);
  });

  it('export saves the serialized presets via saveBlob', async () => {
    useAppStore.setState({ machiningPresets: [preset1] });
    useAppStore.getState().toggleMachiningPresetsDialog(true);
    const saveBlobSpy = vi.spyOn(fsaFallback, 'saveBlob').mockResolvedValue(true);

    render(<MachiningPresetsDialog />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await vi.waitFor(() => expect(saveBlobSpy).toHaveBeenCalled());
    const [blob, suggestedName] = saveBlobSpy.mock.calls[0]!;
    expect(suggestedName).toBe('machining-presets.json');
    const text = await readBlobText(blob as Blob);
    expect(JSON.parse(text)).toEqual([preset1]);
  });
});
