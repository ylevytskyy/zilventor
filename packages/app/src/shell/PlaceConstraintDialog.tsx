import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Mode = 'mate' | 'flush' | 'angle' | 'insert' | 'coincident' | 'tangent';
type PickedRefDescription = { label: string };

type Props = {
  mode: Mode;
  pickedRefA: PickedRefDescription | null;
  pickedRefB: PickedRefDescription | null;
  valueExpression: string;
  onPick: (slot: 'A' | 'B') => void;
  onValueChange: (expression: string) => void;
  onCommit: () => void;
  onApply: () => void;
  onCancel: () => void;
  /** For tangent cyl↔cyl: expression for the second cylinder's radius (r2). When defined, the r2 input is shown. */
  value2Expression?: string;
  onValue2Change?: (v: string) => void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 380,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const row: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6,
};

export function PlaceConstraintDialog(p: Props): JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(p.mode);
  const valueLabel = mode === 'angle'   ? t('dialog.placeConstraint.angleLabel')
                   : mode === 'tangent' ? t('dialog.placeConstraint.radiusLabel')
                   : t('dialog.placeConstraint.offsetLabel');
  const valueUnit = mode === 'angle' ? '°' : 'mm';
  const okEnabled = p.pickedRefA !== null && p.pickedRefB !== null;

  return (
    <div role="dialog" aria-label={t('dialog.placeConstraint.ariaLabel')} style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.placeConstraint.title')}</div>
      <div style={row}>
        <span style={{ width: 60 }}>{t('dialog.placeConstraint.type')}</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={btn}>
          <option value="mate">{t('dialog.placeConstraint.mate')}</option>
          <option value="flush">{t('dialog.placeConstraint.flush')}</option>
          <option value="angle">{t('dialog.placeConstraint.angle')}</option>
          <option value="insert">{t('dialog.placeConstraint.insert')}</option>
          <option value="coincident">{t('dialog.placeConstraint.coincident')}</option>
          <option value="tangent">{t('dialog.placeConstraint.tangent')}</option>
        </select>
      </div>
      <div style={row}>
        <span style={{ width: 80 }}>{t('dialog.placeConstraint.selection1')}</span>
        <button style={btn} onClick={() => p.onPick('A')}>{t('common.pick_ellipsis')}</button>
        <span style={{ marginLeft: 6, color: '#aaa' }}>{p.pickedRefA?.label ?? t('dialog.placeConstraint.noneSelected')}</span>
      </div>
      <div style={row}>
        <span style={{ width: 80 }}>{t('dialog.placeConstraint.selection2')}</span>
        <button style={btn} onClick={() => p.onPick('B')}>{t('common.pick_ellipsis')}</button>
        <span style={{ marginLeft: 6, color: '#aaa' }}>{p.pickedRefB?.label ?? t('dialog.placeConstraint.noneSelected')}</span>
      </div>
      {mode !== 'coincident' && (
        <div style={row}>
          <span style={{ width: 60 }}>{valueLabel}</span>
          <input value={p.valueExpression} onChange={(e) => p.onValueChange(e.target.value)} style={{ ...btn, width: 80 }} />
          <span>{valueUnit}</span>
        </div>
      )}
      {mode === 'tangent' && p.value2Expression !== undefined && (
        <div style={row}>
          <span style={{ width: 60 }}>{t('dialog.placeConstraint.radius2Label')}</span>
          <input value={p.value2Expression} onChange={(e) => p.onValue2Change?.(e.target.value)} style={{ ...btn, width: 80 }} />
          <span>mm</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <button onClick={p.onApply} disabled={!okEnabled} style={btn}>{t('common.apply')}</button>
        <button onClick={p.onCancel} style={btn}>{t('common.cancel')}</button>
        <button onClick={p.onCommit} disabled={!okEnabled} style={btn}>{t('common.ok')}</button>
      </div>
    </div>
  );
}
