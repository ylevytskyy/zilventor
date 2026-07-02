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

export function TenonMortiseDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.tenonMortiseDialog);
  const setDialog = useAppStore((s) => s.setTenonMortiseDialog);

  const [width, setWidth] = React.useState('8');
  const [depth, setDepth] = React.useState('12');
  const [count, setCount] = React.useState('1');
  const [spacing, setSpacing] = React.useState('32');
  const [fitClearance, setFitClearance] = React.useState('0.1');
  const [position, setPosition] = React.useState('');

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setWidth('8');
      setDepth('12');
      setCount('1');
      setSpacing('32');
      setFitClearance('0.1');
      setPosition('');
    }
  }, [dialog]);

  if (!dialog) return null;

  const handleOk = (): void => {
    const params: { width: number; depth: number; count: number; spacing: number; fitClearance: number; position?: number } = {
      width: Number(width),
      depth: Number(depth),
      count: Number(count),
      spacing: Number(spacing),
      fitClearance: Number(fitClearance),
    };
    if (position !== '') params.position = Number(position);
    void dialog.onSubmit(params);
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
        data-testid="tenon-mortise-dialog"
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.tenonMortise')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.tenonMortise.title')}</div>

        <div style={rowStyle}>
          <span>{t('dialog.tenonMortise.panelA')}</span>
          <span style={{ fontSize: 10, color: '#aaa' }}>{dialog.panelPathA}</span>
        </div>
        <div style={rowStyle}>
          <span>{t('dialog.tenonMortise.panelB')}</span>
          <span style={{ fontSize: 10, color: '#aaa' }}>{dialog.panelPathB}</span>
        </div>

        {numRow('tenon-mortise-width', 'dialog.tenonMortise.width', width, setWidth)}
        {numRow('tenon-mortise-depth', 'dialog.tenonMortise.depth', depth, setDepth)}
        {numRow('tenon-mortise-count', 'dialog.tenonMortise.count', count, setCount)}
        {numRow('tenon-mortise-spacing', 'dialog.tenonMortise.spacing', spacing, setSpacing)}
        {numRow('tenon-mortise-fitClearance', 'dialog.tenonMortise.fitClearance', fitClearance, setFitClearance)}
        {numRow('tenon-mortise-position', 'dialog.tenonMortise.position', position, setPosition)}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={handleOk}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
