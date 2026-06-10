import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import type { HardwareCategory } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 440, color: '#eee', fontSize: 12, maxHeight: '90vh', overflowY: 'auto',
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function HardwareDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.hardwareDialog);
  const [category, setCategory] = React.useState<HardwareCategory>('hinges');
  const [selectedSkuId, setSelectedSkuId] = React.useState<string>('hinge-35mm-cup-full');
  const [qty, setQty] = React.useState(1);

  const filtered = BUILTIN_CATALOG.filter((e) => e.category === category);

  React.useEffect(() => {
    if (!dialog) return;
    setCategory('hinges');
    setSelectedSkuId('hinge-35mm-cup-full');
    setQty(1);
  }, [dialog]);

  React.useEffect(() => {
    const first = filtered[0];
    if (first && !filtered.find((e) => e.id === selectedSkuId)) {
      setSelectedSkuId(first.id);
    }
  }, [category]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialog) dialog.onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dialog]);

  if (!dialog) return null;

  const handleOk = () => {
    dialog.onSubmit(selectedSkuId, qty);
    useAppStore.getState().setHardwareDialog(null);
  };

  return (
    <div style={overlayStyle} onClick={dialog.onCancel} role="dialog" aria-label={t('aria.hardware')}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('dialog.hardware.title')}</div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, marginRight: 6 }} id="hw-cat-label">{t('dialog.hardware.category')}</label>
          <select
            aria-labelledby="hw-cat-label"
            aria-label={t('dialog.hardware.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value as HardwareCategory)}
            style={{ background: '#222', color: '#eee', border: '1px solid #444', fontSize: 11 }}
          >
            <option value="hinges">{t('dialog.hardware.hinges')}</option>
            <option value="shelfPins">{t('dialog.hardware.shelf_pins')}</option>
          </select>
        </div>

        <div style={{ marginBottom: 8 }}>
          {filtered.map((entry) => (
            <label key={entry.id} style={{ display: 'block', marginBottom: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                name="hw-variant"
                value={entry.id}
                checked={selectedSkuId === entry.id}
                onChange={() => setSelectedSkuId(entry.id)}
                style={{ marginRight: 6 }}
              />
              <span style={{ fontWeight: selectedSkuId === entry.id ? 600 : 400 }}>{entry.name}</span>
              <span style={{ color: '#888', marginLeft: 8 }}>
                {entry.bboxMm.l}×{entry.bboxMm.w}×{entry.bboxMm.h}mm
              </span>
              {entry.notes && (
                <span style={{ color: '#aaa', marginLeft: 8, fontSize: 10 }}>{entry.notes}</span>
              )}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 11 }}>{t('dialog.hardware.qty')}</span>
          <button
            type="button"
            aria-label={t('aria.decrement_qty')}
            style={btnStyle}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
          >−</button>
          <span style={{ minWidth: 24, textAlign: 'center' }}>{qty}</span>
          <button
            type="button"
            aria-label={t('aria.increment_qty')}
            style={btnStyle}
            onClick={() => setQty((q) => Math.min(100, q + 1))}
          >+</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" style={btnStyle} onClick={dialog.onCancel} aria-label={t('common.cancel')}>{t('common.cancel')}</button>
          <button type="button" style={okBtnStyle} onClick={handleOk} aria-label={t('common.ok')}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
