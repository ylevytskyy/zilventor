import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelHeaderPresetsDialog } from '../LabelHeaderPresetsDialog';
import { useAppStore } from '../../store/useAppStore';
import * as fsaFallback from '../fsaFallback';
import type { LabelHeaderPreset } from '../../store/labelHeaderPreset';

const preset1: LabelHeaderPreset = { id: 'h1', name: 'Kitchen job', line1: 'Acme Cabinets', line2: 'Order #123' };
const preset2: LabelHeaderPreset = { id: 'h2', name: 'Bath job', line1: 'Acme Cabinets', line2: 'Order #456' };

beforeEach(() => {
  useAppStore.getState().toggleLabelHeaderPresetsDialog(false);
  useAppStore.setState({ labelHeaderPresets: [] });
});

describe('LabelHeaderPresetsDialog', () => {
  it('renders nothing when labelHeaderPresetsDialogOpen is false', () => {
    render(<LabelHeaderPresetsDialog />);
    expect(screen.queryByRole('dialog', { name: /label header presets/i })).toBeNull();
  });

  it('renders empty state when open with no presets', () => {
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    render(<LabelHeaderPresetsDialog />);
    expect(screen.getByRole('dialog', { name: /label header presets/i })).toBeTruthy();
    expect(screen.getByText(/no.*presets/i)).toBeTruthy();
  });

  it('add fills the form and creates a preset via addLabelHeaderPreset', () => {
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    render(<LabelHeaderPresetsDialog />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'My Preset' } });
    fireEvent.change(screen.getByLabelText(/header line 1/i), { target: { value: 'Acme Cabinets' } });
    fireEvent.change(screen.getByLabelText(/header line 2/i), { target: { value: 'Order #789' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    const stored = useAppStore.getState().labelHeaderPresets;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe('My Preset');
    expect(stored[0]!.line1).toBe('Acme Cabinets');
    expect(stored[0]!.line2).toBe('Order #789');
    expect(typeof stored[0]!.id).toBe('string');
    expect(stored[0]!.id.length).toBeGreaterThan(0);
    expect(screen.getByText('My Preset')).toBeTruthy();
  });

  it('edit populates the form and Save updates the existing preset in place', () => {
    useAppStore.setState({ labelHeaderPresets: [preset1] });
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    render(<LabelHeaderPresetsDialog />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Kitchen job');

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Kitchen renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const stored = useAppStore.getState().labelHeaderPresets;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe('h1');
    expect(stored[0]!.name).toBe('Kitchen renamed');
  });

  it('delete removes the preset from the store', () => {
    useAppStore.setState({ labelHeaderPresets: [preset1, preset2] });
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    render(<LabelHeaderPresetsDialog />);

    fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]!);

    const stored = useAppStore.getState().labelHeaderPresets;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe('h2');
  });

  it('Esc key closes the dialog', () => {
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    render(<LabelHeaderPresetsDialog />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useAppStore.getState().labelHeaderPresetsDialogOpen).toBe(false);
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
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    const json = JSON.stringify([{ id: 'imp1', name: 'Imported', line1: 'A', line2: 'B' }]);
    vi.spyOn(fsaFallback, 'pickFile').mockResolvedValue(fakeFile(json));

    render(<LabelHeaderPresetsDialog />);
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await screen.findByText('Imported');

    const stored = useAppStore.getState().labelHeaderPresets;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe('imp1');
  });

  it('import with invalid JSON shows an error and does not modify the store', async () => {
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    vi.spyOn(fsaFallback, 'pickFile').mockResolvedValue(fakeFile('not json'));

    render(<LabelHeaderPresetsDialog />);
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/import failed/i);
    expect(useAppStore.getState().labelHeaderPresets).toHaveLength(0);
  });

  it('import with an invalid entry shows an error and leaves the store unchanged (atomic)', async () => {
    useAppStore.setState({ labelHeaderPresets: [preset1] });
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    const json = JSON.stringify([{ id: 'imp1', name: 'Imported', line1: 'A' }]);
    vi.spyOn(fsaFallback, 'pickFile').mockResolvedValue(fakeFile(json));

    render(<LabelHeaderPresetsDialog />);
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/import failed/i);
    expect(useAppStore.getState().labelHeaderPresets).toEqual([preset1]);
  });

  it('export saves the serialized presets via saveBlob', async () => {
    useAppStore.setState({ labelHeaderPresets: [preset1] });
    useAppStore.getState().toggleLabelHeaderPresetsDialog(true);
    const saveBlobSpy = vi.spyOn(fsaFallback, 'saveBlob').mockResolvedValue(true);

    render(<LabelHeaderPresetsDialog />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await vi.waitFor(() => expect(saveBlobSpy).toHaveBeenCalled());
    const [blob, suggestedName] = saveBlobSpy.mock.calls[0]!;
    expect(suggestedName).toBe('label-header-presets.json');
    const text = await readBlobText(blob as Blob);
    expect(JSON.parse(text)).toEqual([preset1]);
  });
});
