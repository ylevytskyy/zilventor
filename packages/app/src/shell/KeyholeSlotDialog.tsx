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

export function KeyholeSlotDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.keyholeSlotDialog);
  const setDialog = useAppStore((s) => s.setKeyholeSlotDialog);

  // Default face is fixed to 'Bottom' (not role-derived like Groove's) — the
  // large rear face (Top/Bottom are the two large thickness-normal faces;
  // Front/Back/Left/Right are the narrow edge faces, which have no flat-drawing
  // representation for the keyhole DXF/CSV output).
  const [faceRole, setFaceRole] = React.useState<'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right'>('Bottom');
  const [axis, setAxis] = React.useState<'u' | 'v'>('u');
  const [direction, setDirection] = React.useState<'1' | '-1'>('1');
  const [u, setU] = React.useState('0');
  const [v, setV] = React.useState('0');
  const [entryDiameter, setEntryDiameter] = React.useState('15');
  const [slotWidth, setSlotWidth] = React.useState('8');
  const [slotLength, setSlotLength] = React.useState('25');
  const [depth, setDepth] = React.useState('6');

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setFaceRole('Bottom');
      setAxis('u');
      setDirection('1');
      setU('0');
      setV('0');
      setEntryDiameter('15');
      setSlotWidth('8');
      setSlotLength('25');
      setDepth('6');
    }
  }, [dialog]);

  if (!dialog) return null;

  const handleOk = (): void => {
    void dialog.onSubmit({
      faceRole,
      axis,
      direction: Number(direction) as 1 | -1,
      u: Number(u),
      v: Number(v),
      entryDiameter: Number(entryDiameter),
      slotWidth: Number(slotWidth),
      slotLength: Number(slotLength),
      depth: Number(depth),
    });
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
        data-testid="keyhole-slot-dialog"
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.keyholeSlot')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.keyholeSlot.title')}</div>

        <div style={rowStyle}>
          <label htmlFor="keyhole-slot-face">{t('dialog.keyholeSlot.face')}</label>
          <select
            id="keyhole-slot-face"
            aria-label={t('dialog.keyholeSlot.face')}
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
          <label htmlFor="keyhole-slot-axis">{t('dialog.keyholeSlot.axis')}</label>
          <select
            id="keyhole-slot-axis"
            aria-label={t('dialog.keyholeSlot.axis')}
            style={fieldStyle}
            value={axis}
            onChange={(e) => setAxis(e.target.value as 'u' | 'v')}
          >
            <option value="u">u</option>
            <option value="v">v</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="keyhole-slot-direction">{t('dialog.keyholeSlot.direction')}</label>
          <select
            id="keyhole-slot-direction"
            aria-label={t('dialog.keyholeSlot.direction')}
            style={fieldStyle}
            value={direction}
            onChange={(e) => setDirection(e.target.value as '1' | '-1')}
          >
            <option value="1">+1</option>
            <option value="-1">-1</option>
          </select>
        </div>

        {numRow('keyhole-slot-u', 'dialog.keyholeSlot.u', u, setU)}
        {numRow('keyhole-slot-v', 'dialog.keyholeSlot.v', v, setV)}
        {numRow('keyhole-slot-entry-diameter', 'dialog.keyholeSlot.entryDiameter', entryDiameter, setEntryDiameter)}
        {numRow('keyhole-slot-width', 'dialog.keyholeSlot.slotWidth', slotWidth, setSlotWidth)}
        {numRow('keyhole-slot-length', 'dialog.keyholeSlot.slotLength', slotLength, setSlotLength)}
        {numRow('keyhole-slot-depth', 'dialog.keyholeSlot.depth', depth, setDepth)}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={handleOk}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
