import { useState } from 'react';
import type { ComponentColor } from '@zilventor/shared';

type Props = {
  value: ComponentColor | undefined;
  palette: Record<string, string>;
  onChange: (next: ComponentColor | undefined) => void;
  onAddPaletteColor?: (name: string, hex: string) => void;
};

export function ColorPicker({ value, palette, onChange, onAddPaletteColor }: Props) {
  const [mode, setMode] = useState<'select' | 'newPalette' | 'customHex'>('select');
  const [pendingName, setPendingName] = useState('');
  const [pendingHex, setPendingHex] = useState('#888888');

  if (mode === 'newPalette') {
    return (
      <div>
        <input
          aria-label="palette-name"
          value={pendingName}
          onChange={(e) => setPendingName(e.target.value)}
          placeholder="Color name"
        />
        <input
          aria-label="palette-hex"
          type="color"
          value={pendingHex}
          onChange={(e) => setPendingHex(e.target.value)}
        />
        <button
          onClick={() => {
            if (!pendingName) return;
            onAddPaletteColor?.(pendingName, pendingHex);
            onChange({ kind: 'palette', name: pendingName });
            setMode('select');
            setPendingName('');
          }}
        >
          OK
        </button>
        <button
          onClick={() => {
            setMode('select');
            setPendingName('');
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (mode === 'customHex') {
    return (
      <div>
        <input
          aria-label="custom-hex"
          type="color"
          value={pendingHex}
          onChange={(e) => setPendingHex(e.target.value)}
        />
        <button
          onClick={() => {
            onChange({ kind: 'hex', hex: pendingHex });
            setMode('select');
          }}
        >
          OK
        </button>
        <button onClick={() => setMode('select')}>Cancel</button>
      </div>
    );
  }

  const selected = !value
    ? '__none__'
    : value.kind === 'palette'
      ? `palette:${value.name}`
      : `hex:${value.hex}`;
  return (
    <select
      aria-label="component-color"
      value={selected}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__none__') onChange(undefined);
        else if (v === '__newPalette__') setMode('newPalette');
        else if (v === '__customHex__') setMode('customHex');
        else if (v.startsWith('palette:')) onChange({ kind: 'palette', name: v.slice('palette:'.length) });
        else if (v.startsWith('hex:')) onChange({ kind: 'hex', hex: v.slice('hex:'.length) });
      }}
    >
      <option value="__none__">(no color)</option>
      {Object.entries(palette).map(([n, h]) => (
        <option key={n} value={`palette:${n}`} style={{ backgroundColor: h }}>
          {n}
        </option>
      ))}
      <option value="__newPalette__">+ New palette color…</option>
      <option value="__customHex__">Custom hex…</option>
    </select>
  );
}
