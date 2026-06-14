import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_STILE_WIDTH, DEFAULT_RAIL_WIDTH, DEFAULT_FRAME_THICKNESS } from '@zilventor/shared';

// COPY the style consts verbatim from DrawerBankDialog.tsx:5-25.
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 300, color: '#eee', fontSize: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6,
};
const fieldStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444', fontSize: 11,
  padding: '2px 4px', width: 130,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };
const errorStyle: React.CSSProperties = { color: '#ff6b6b', fontSize: 11, marginBottom: 6 };

export function FaceFrameDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.addFaceFrameDialog);
  const setDialog = useAppStore((s) => s.setAddFaceFrameDialog);

  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(1);
  const [stileWidth, setStileWidth] = useState(String(DEFAULT_STILE_WIDTH));
  const [railWidth, setRailWidth] = useState(String(DEFAULT_RAIL_WIDTH));
  const [thickness, setThickness] = useState(String(DEFAULT_FRAME_THICKNESS));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dialog) {
      setRows(1); setCols(1);
      setStileWidth(String(DEFAULT_STILE_WIDTH));
      setRailWidth(String(DEFAULT_RAIL_WIDTH));
      setThickness(String(DEFAULT_FRAME_THICKNESS));
      setError(null);
    }
  }, [dialog]);

  if (!dialog) return null;

  const sw = Number(stileWidth), rw = Number(railWidth), th = Number(thickness);
  const valid = rows >= 1 && cols >= 1 && sw > 0 && rw > 0 && th > 0;

  const handleOk = async (): Promise<void> => {
    if (!valid) { setError(t('dialog.faceFrame.error.invalidInput')); return; }
    setError(null);
    try {
      await dialog.onSubmit({ rows, cols, stileWidth: sw, railWidth: rw, thickness: th });
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t(msg, { defaultValue: msg }));
      // Dialog stays open — do NOT call setDialog(null).
    }
  };

  const handleCancel = (): void => {
    dialog.onCancel();
    setDialog(null);
  };

  return (
    <div style={overlayStyle} role="dialog" aria-label={t('dialog.faceFrame.title')}>
      <div style={panelStyle}>
        <h2>{t('dialog.faceFrame.title')}</h2>
        <label style={rowStyle}>{t('dialog.faceFrame.rows')}
          <input style={fieldStyle} type="number" min={1} max={10} value={rows} onChange={(e) => { setRows(Number(e.target.value)); setError(null); }} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.cols')}
          <input style={fieldStyle} type="number" min={1} max={10} value={cols} onChange={(e) => { setCols(Number(e.target.value)); setError(null); }} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.stileWidth')}
          <input style={fieldStyle} type="number" value={stileWidth} onChange={(e) => { setStileWidth(e.target.value); setError(null); }} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.railWidth')}
          <input style={fieldStyle} type="number" value={railWidth} onChange={(e) => { setRailWidth(e.target.value); setError(null); }} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.thickness')}
          <input style={fieldStyle} type="number" value={thickness} onChange={(e) => { setThickness(e.target.value); setError(null); }} /></label>
        {error && <div style={errorStyle} role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} type="button" onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} type="button" onClick={() => { void handleOk(); }} disabled={!valid}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
