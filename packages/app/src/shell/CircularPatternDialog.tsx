import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PatternAxis } from '@zilventor/shared';

export type CircularPatternDialogValue = {
  sourceComponentId: string;
  axis: PatternAxis;
  center: { x: number; y: number; z: number };
  count: number;
  totalAngleDeg: number;
  rotateInstances: boolean;
};

type ComponentSummary = {
  id: string;
  label: string;
};

type Props = {
  components: ComponentSummary[];
  onCommit(v: CircularPatternDialogValue): void;
  onCancel(): void;
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  right: 20,
  background: '#1a1a1a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 12,
  width: 360,
  color: '#eee',
  zIndex: 50,
  fontSize: 12,
};

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#222',
  color: '#eee',
  border: '1px solid #333',
  padding: '4px 6px',
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 10px',
  cursor: 'pointer',
};

export function CircularPatternDialog({ components, onCommit, onCancel }: Props): JSX.Element {
  const { t } = useTranslation();
  const [sourceComponentId, setSourceComponentId] = useState(components[0]?.id ?? '');
  const [axis, setAxis] = useState<PatternAxis>('z');
  const [centerX, setCenterX] = useState('0');
  const [centerY, setCenterY] = useState('0');
  const [centerZ, setCenterZ] = useState('0');
  const [countStr, setCountStr] = useState('4');
  const [angleStr, setAngleStr] = useState('360');
  const [rotateInstances, setRotateInstances] = useState(true);

  const count = parseInt(countStr, 10);
  const countValid = Number.isInteger(count) && count >= 2 && count <= 200;

  const angle = parseFloat(angleStr);
  const angleValid = Number.isFinite(angle) && angle > 0 && angle <= 360;

  const cx = parseFloat(centerX);
  const cy = parseFloat(centerY);
  const cz = parseFloat(centerZ);
  const centerNumeric = Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz);

  const canCommit = sourceComponentId !== '' && countValid && angleValid && centerNumeric;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit({
      sourceComponentId,
      axis,
      center: { x: cx, y: cy, z: cz },
      count,
      totalAngleDeg: angle,
      rotateInstances,
    });
  };

  return (
    <form role="dialog" aria-label={t('aria.circular_pattern')} onSubmit={handleSubmit} style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.circularPattern.title')}</div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-cp-source">
          {t('dialog.circularPattern.source')}
        </label>
        <select
          id="cpd-cp-source"
          aria-label={t('dialog.circularPattern.source_component')}
          value={sourceComponentId}
          onChange={(e) => setSourceComponentId(e.target.value)}
          style={inputStyle}
        >
          {components.length === 0 && <option value="">{t('dialog.circularPattern.no_components')}</option>}
          {components.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <span style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.circularPattern.axis')}</span>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {(['x', 'y', 'z'] as PatternAxis[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAxis(a)}
              style={{
                ...btnStyle,
                flex: 1,
                background: axis === a ? '#3b5a8a' : '#2a2a2a',
                borderColor: axis === a ? '#6a8ec4' : '#444',
              }}
            >
              {a.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={rowStyle}>
        <span style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.circularPattern.center')}</span>
        <input
          aria-label={`${t('dialog.circularPattern.center')} X`}
          type="number"
          value={centerX}
          onChange={(e) => setCenterX(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
          placeholder="X"
        />
        <input
          aria-label={`${t('dialog.circularPattern.center')} Y`}
          type="number"
          value={centerY}
          onChange={(e) => setCenterY(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
          placeholder="Y"
        />
        <input
          aria-label={`${t('dialog.circularPattern.center')} Z`}
          type="number"
          value={centerZ}
          onChange={(e) => setCenterZ(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
          placeholder="Z"
        />
      </div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-cp-count">
          {t('dialog.circularPattern.count')}
        </label>
        <input
          id="cpd-cp-count"
          aria-label={t('dialog.circularPattern.count')}
          type="number"
          min={2}
          max={200}
          step={1}
          value={countStr}
          onChange={(e) => setCountStr(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ color: '#888', marginBottom: 8, fontSize: 11 }}>{t('dialog.circularPattern.count_hint')}</div>
      {!countValid && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{t('dialog.circularPattern.count_error')}</div>
      )}

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-cp-angle">
          {t('dialog.circularPattern.angle')}
        </label>
        <input
          id="cpd-cp-angle"
          aria-label={t('dialog.circularPattern.angle')}
          type="number"
          value={angleStr}
          onChange={(e) => setAngleStr(e.target.value)}
          style={inputStyle}
        />
        <span style={{ color: '#888' }}>°</span>
      </div>
      {!angleValid && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{t('dialog.circularPattern.angle_error')}</div>
      )}

      <div style={rowStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            aria-label={t('dialog.circularPattern.rotate')}
            checked={rotateInstances}
            onChange={(e) => setRotateInstances(e.target.checked)}
          />
          {t('dialog.circularPattern.rotate')}
        </label>
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>{t('common.cancel')}</button>
        <button type="submit" disabled={!canCommit} style={btnStyle}>{t('common.ok')}</button>
      </div>
    </form>
  );
}
