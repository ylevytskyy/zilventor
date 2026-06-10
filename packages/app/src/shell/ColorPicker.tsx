import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentColor } from '@zilventor/shared';

type Props = {
  value: ComponentColor | undefined;
  palette: Record<string, string>;
  onChange: (next: ComponentColor | undefined) => void;
  onAddPaletteColor?: (name: string, hex: string) => void;
};

export function ColorPicker({ value, palette, onChange, onAddPaletteColor }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'select' | 'newPalette' | 'customHex'>('select');
  const [pendingName, setPendingName] = useState('');
  const [pendingHex, setPendingHex] = useState('#888888');

  if (mode === 'newPalette') {
    return (
      <div>
        <input
          aria-label={t('aria.palette_name')}
          value={pendingName}
          onChange={(e) => setPendingName(e.target.value)}
          placeholder={t('color.name_placeholder')}
        />
        <input
          aria-label={t('aria.palette_hex')}
          type="color"
          value={pendingHex}
          onChange={(e) => setPendingHex(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            if (!pendingName) return;
            onAddPaletteColor?.(pendingName, pendingHex);
            onChange({ kind: 'palette', name: pendingName });
            setMode('select');
            setPendingName('');
          }}
        >
          {t('common.ok')}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('select');
            setPendingName('');
          }}
        >
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  if (mode === 'customHex') {
    return (
      <div>
        <input
          aria-label={t('aria.custom_hex')}
          type="color"
          value={pendingHex}
          onChange={(e) => setPendingHex(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            onChange({ kind: 'hex', hex: pendingHex });
            setMode('select');
          }}
        >
          {t('common.ok')}
        </button>
        <button type="button" onClick={() => setMode('select')}>{t('common.cancel')}</button>
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
      aria-label={t('aria.component_color')}
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
      <option value="__none__">{t('color.no_color')}</option>
      {Object.entries(palette).map(([n, h]) => (
        <option key={n} value={`palette:${n}`} style={{ backgroundColor: h }}>
          {n}
        </option>
      ))}
      <option value="__newPalette__">{t('color.new_palette')}</option>
      <option value="__customHex__">{t('color.custom_hex')}</option>
    </select>
  );
}
