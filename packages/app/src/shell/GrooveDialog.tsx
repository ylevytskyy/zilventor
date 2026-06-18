import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';

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
  padding: '2px 4px', width: 120,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function GrooveDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.grooveDialog);
  const setDialog = useAppStore((s) => s.setGrooveDialog);

  const [faceRole, setFaceRole] = React.useState<'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right'>('Bottom');
  const [axis, setAxis] = React.useState<'u' | 'v'>('u');
  const [position, setPosition] = React.useState('50');
  const [width, setWidth] = React.useState('6');
  const [depth, setDepth] = React.useState('9');

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setFaceRole(dialog.defaultFace);
      setAxis('u');
      setPosition('50');
      setWidth('6');
      setDepth('9');
    }
  }, [dialog]);

  if (!dialog) return null;

  const handleOk = (): void => {
    void dialog.onSubmit({ faceRole, axis, position: Number(position), width: Number(width), depth: Number(depth) });
    setDialog(null);
  };

  const handleCancel = (): void => {
    dialog.onCancel();
    setDialog(null);
  };

  const numRow = (
    id: string,
    labelKey: string,
    value: string,
    set: (v: string) => void,
  ): JSX.Element => (
    <div style={rowStyle}>
      <label htmlFor={id}>{t(labelKey)}</label>
      <input
        id={id}
        aria-label={t(labelKey)}
        style={fieldStyle}
        type="number"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        data-testid="groove-dialog"
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.groove')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.groove.title')}</div>

        <div style={rowStyle}>
          <label htmlFor="groove-face">{t('dialog.groove.face')}</label>
          <select
            id="groove-face"
            aria-label={t('dialog.groove.face')}
            style={fieldStyle}
            value={faceRole}
            onChange={(e) => setFaceRole(e.target.value as typeof faceRole)}
          >
            <option value="Top">Top</option>
            <option value="Bottom">Bottom</option>
            <option value="Front">Front</option>
            <option value="Back">Back</option>
            <option value="Left">Left</option>
            <option value="Right">Right</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="groove-axis">{t('dialog.groove.axis')}</label>
          <select
            id="groove-axis"
            aria-label={t('dialog.groove.axis')}
            style={fieldStyle}
            value={axis}
            onChange={(e) => setAxis(e.target.value as 'u' | 'v')}
          >
            <option value="u">u</option>
            <option value="v">v</option>
          </select>
        </div>

        {numRow('groove-position', 'dialog.groove.position', position, setPosition)}
        {numRow('groove-width', 'dialog.groove.width', width, setWidth)}
        {numRow('groove-depth', 'dialog.groove.depth', depth, setDepth)}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={handleOk}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
