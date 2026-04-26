import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorPicker } from '../ColorPicker';
import type { ComponentColor } from '@zilventor/shared';

describe('ColorPicker', () => {
  const palette = { Maple: '#d4a574' };

  it('renders dropdown options including (no color), palette name, + New palette color…, and Custom hex…', () => {
    render(<ColorPicker value={undefined} palette={palette} onChange={() => {}} />);
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(
      expect.arrayContaining(['(no color)', 'Maple', '+ New palette color…', 'Custom hex…']),
    );
  });

  it('selecting (no color) calls onChange(undefined)', () => {
    const onChange = vi.fn();
    const value: ComponentColor = { kind: 'palette', name: 'Maple' };
    render(<ColorPicker value={value} palette={palette} onChange={onChange} />);
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__none__' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('selecting a palette name calls onChange({kind:"palette", name})', () => {
    const onChange = vi.fn();
    render(<ColorPicker value={undefined} palette={palette} onChange={onChange} />);
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'palette:Maple' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'palette', name: 'Maple' });
  });

  it('+ New palette color… → fill name + hex → OK calls onAddPaletteColor then onChange', () => {
    const onChange = vi.fn();
    const onAddPaletteColor = vi.fn();
    render(
      <ColorPicker
        value={undefined}
        palette={palette}
        onChange={onChange}
        onAddPaletteColor={onAddPaletteColor}
      />,
    );
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__newPalette__' } });
    fireEvent.change(screen.getByLabelText('palette-name'), { target: { value: 'Cherry' } });
    fireEvent.change(screen.getByLabelText('palette-hex'), { target: { value: '#ff00ff' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onAddPaletteColor).toHaveBeenCalledWith('Cherry', '#ff00ff');
    expect(onChange).toHaveBeenCalledWith({ kind: 'palette', name: 'Cherry' });
  });

  it('Custom hex… → pick a hex → OK calls onChange({kind:"hex", hex})', () => {
    const onChange = vi.fn();
    render(<ColorPicker value={undefined} palette={palette} onChange={onChange} />);
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__customHex__' } });
    fireEvent.change(screen.getByLabelText('custom-hex'), { target: { value: '#123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'hex', hex: '#123456' });
  });

  it('+ New palette color… with empty name → OK is a no-op', () => {
    const onChange = vi.fn();
    const onAddPaletteColor = vi.fn();
    render(
      <ColorPicker
        value={undefined}
        palette={palette}
        onChange={onChange}
        onAddPaletteColor={onAddPaletteColor}
      />,
    );
    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__newPalette__' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onAddPaletteColor).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
