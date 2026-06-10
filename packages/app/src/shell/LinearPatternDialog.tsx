import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PatternAxis } from '@zilventor/shared';

export type LinearPatternDialogValue = {
  sourceFeatureId: string;
  direction: PatternAxis;
  spacing: string;
  count: number;
};

export type PatternableFeatureSummary = {
  id: string;
  label: string;
};

type Props = {
  patternableFeatures: PatternableFeatureSummary[];
  previewError: string | null;
  onCommit(v: LinearPatternDialogValue): void;
  onCancel(): void;
  validateExpression?(expression: string): string | null;
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

export function LinearPatternDialog({
  patternableFeatures,
  previewError,
  onCommit,
  onCancel,
  validateExpression,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [sourceFeatureId, setSourceFeatureId] = useState(patternableFeatures[0]?.id ?? '');
  const [direction, setDirection] = useState<PatternAxis>('x');
  const [spacing, setSpacing] = useState('20');
  const [countStr, setCountStr] = useState('3');

  const count = Number.parseInt(countStr, 10);
  const countValid = Number.isFinite(count) && count >= 2 && count <= 200;
  const exprError = validateExpression ? validateExpression(spacing) : null;
  const canCommit = sourceFeatureId !== '' && countValid && exprError === null;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit({ sourceFeatureId, direction, spacing, count });
  };

  return (
    <form role="dialog" aria-label={t('dialog.linearPattern.title')} onSubmit={handleSubmit} style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.linearPattern.title')}</div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.linearPattern.source')}</label>
        <select
          aria-label={t('dialog.linearPattern.source')}
          value={sourceFeatureId}
          onChange={(e) => setSourceFeatureId(e.target.value)}
          style={inputStyle}
        >
          {patternableFeatures.length === 0 && <option value="">{t('dialog.linearPattern.noFeature')}</option>}
          {patternableFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <span style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.linearPattern.axis')}</span>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {(['x', 'y', 'z'] as PatternAxis[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setDirection(a)}
              style={{
                ...btnStyle,
                flex: 1,
                background: direction === a ? '#3b5a8a' : '#2a2a2a',
                borderColor: direction === a ? '#6a8ec4' : '#444',
              }}
            >
              {a.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.linearPattern.spacing')}</label>
        <input
          aria-label={t('dialog.linearPattern.spacing')}
          value={spacing}
          onChange={(e) => setSpacing(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.linearPattern.count')}</label>
        <input
          aria-label={t('dialog.linearPattern.count')}
          type="number"
          min={2}
          max={200}
          value={countStr}
          onChange={(e) => setCountStr(e.target.value)}
          style={inputStyle}
        />
      </div>

      {exprError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{exprError}</div>}
      {!countValid && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{t('dialog.linearPattern.countError')}</div>
      )}
      {previewError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{previewError}</div>}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>{t('common.cancel')}</button>
        <button type="submit" disabled={!canCommit} style={btnStyle}>{t('common.ok')}</button>
      </div>
    </form>
  );
}
