import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MirrorPlane } from '@zilventor/shared';

export type MirrorDialogValue = {
  sourceFeatureId: string;
  plane: MirrorPlane;
};

export type PatternableFeatureSummary = {
  id: string;
  label: string;
};

type Props = {
  patternableFeatures: PatternableFeatureSummary[];
  onCommit(v: MirrorDialogValue): void;
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
  width: 320,
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

export function MirrorDialog({
  patternableFeatures,
  onCommit,
  onCancel,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [sourceFeatureId, setSourceFeatureId] = useState(patternableFeatures[0]?.id ?? '');
  const [plane, setPlane] = useState<MirrorPlane>('yz');

  const canCommit = sourceFeatureId !== '';

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit({ sourceFeatureId, plane });
  };

  return (
    <form role="dialog" aria-label={t('dialog.mirror.title')} onSubmit={handleSubmit} style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.mirror.title')}</div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.mirror.source')}</label>
        <select
          aria-label={t('dialog.mirror.sourceAriaLabel')}
          value={sourceFeatureId}
          onChange={(e) => setSourceFeatureId(e.target.value)}
          style={inputStyle}
        >
          {patternableFeatures.length === 0 && <option value="">{t('dialog.mirror.noSource')}</option>}
          {patternableFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <span style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>{t('dialog.mirror.plane')}</span>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {(['yz', 'xz', 'xy'] as MirrorPlane[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlane(p)}
              style={{
                ...btnStyle,
                flex: 1,
                background: plane === p ? '#3b5a8a' : '#2a2a2a',
                borderColor: plane === p ? '#6a8ec4' : '#444',
              }}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>
        {t('dialog.mirror.hint')}
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>{t('common.cancel')}</button>
        <button type="submit" disabled={!canCommit} style={btnStyle}>{t('common.ok')}</button>
      </div>
    </form>
  );
}
