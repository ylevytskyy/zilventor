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

export function ShelfPinDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.shelfPinDialog);
  const setDialog = useAppStore((s) => s.setShelfPinDialog);

  const [pitch, setPitch] = React.useState('32');
  const [diameter, setDiameter] = React.useState('5');
  const [depth, setDepth] = React.useState('13');
  const [frontSetback, setFrontSetback] = React.useState('37');
  const [backSetback, setBackSetback] = React.useState('37');
  const [topMargin, setTopMargin] = React.useState('64');
  const [bottomMargin, setBottomMargin] = React.useState('64');
  const [columns, setColumns] = React.useState<'1' | '2'>('2');

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setPitch('32');
      setDiameter('5');
      setDepth('13');
      setFrontSetback('37');
      setBackSetback('37');
      setTopMargin('64');
      setBottomMargin('64');
      setColumns('2');
    }
  }, [dialog]);

  if (!dialog) return null;

  const handleOk = (): void => {
    dialog.onSubmit({
      pitch: Number(pitch),
      diameter: Number(diameter),
      depth: Number(depth),
      frontSetback: Number(frontSetback),
      backSetback: Number(backSetback),
      topMargin: Number(topMargin),
      bottomMargin: Number(bottomMargin),
      columns: (columns === '1' ? 1 : 2),
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
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.shelf_pin_dialog')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.shelfPin.title')}</div>

        {numRow('shelfpin-pitch', 'dialog.shelfPin.pitch', pitch, setPitch)}
        {numRow('shelfpin-diameter', 'dialog.shelfPin.diameter', diameter, setDiameter)}
        {numRow('shelfpin-depth', 'dialog.shelfPin.depth', depth, setDepth)}
        {numRow('shelfpin-frontsetback', 'dialog.shelfPin.frontSetback', frontSetback, setFrontSetback)}
        {numRow('shelfpin-backsetback', 'dialog.shelfPin.backSetback', backSetback, setBackSetback)}
        {numRow('shelfpin-topmargin', 'dialog.shelfPin.topMargin', topMargin, setTopMargin)}
        {numRow('shelfpin-bottommargin', 'dialog.shelfPin.bottomMargin', bottomMargin, setBottomMargin)}

        <div style={rowStyle}>
          <label htmlFor="shelfpin-columns">{t('dialog.shelfPin.columns')}</label>
          <select
            id="shelfpin-columns"
            aria-label={t('dialog.shelfPin.columns')}
            style={fieldStyle}
            value={columns}
            onChange={(e) => setColumns(e.target.value as '1' | '2')}
          >
            <option value="1">{t('dialog.shelfPin.columnsOne')}</option>
            <option value="2">{t('dialog.shelfPin.columnsTwo')}</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={handleOk}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
