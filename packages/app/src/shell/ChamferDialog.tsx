import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChamferEdgeSpec, FilletSelectionMode } from '@zilventor/shared';

export type ChamferDialogValue = {
  distance: string;
  edges: ChamferEdgeSpec[];
};

type Props = {
  edges: ChamferEdgeSpec[];
  pickingMode: FilletSelectionMode;
  previewError: string | null;
  initialDistance?: string | undefined;
  onCommit(v: ChamferDialogValue): void;
  onApply(v: ChamferDialogValue): void;
  onCancel(): void;
  onAddEdges(): void;
  onRemoveEdge(spec: ChamferEdgeSpec): void;
  onClearEdges(): void;
  onSelectionModeChange(mode: FilletSelectionMode): void;
  onDistanceChange(expression: string): void;
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

const sectionLabelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
};

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

const toggleBtnStyle = (pressed: boolean): React.CSSProperties => ({
  background: pressed ? '#3b5a8a' : '#2a2a2a',
  color: '#eee',
  border: pressed ? '1px solid #6a8ec4' : '1px solid #444',
  padding: '4px 10px',
  cursor: 'pointer',
  flex: 1,
});

function edgeLabel(spec: ChamferEdgeSpec): string {
  const a = spec.edgeId.faceA;
  const b = spec.edgeId.faceB;
  const aLabel = a.instance != null ? `${a.role}${a.instance}` : a.role;
  const bLabel = b.instance != null ? `${b.role}${b.instance}` : b.role;
  return `${aLabel}-${bLabel}`;
}

export function ChamferDialog({
  edges,
  pickingMode,
  previewError,
  initialDistance,
  onCommit,
  onApply,
  onCancel,
  onAddEdges,
  onRemoveEdge,
  onClearEdges,
  onSelectionModeChange,
  onDistanceChange,
  validateExpression,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [distance, setDistance] = useState(initialDistance ?? '1');

  const exprError = validateExpression ? validateExpression(distance) : null;
  const canCommit = edges.length > 0 && exprError === null;

  const buildValue = (): ChamferDialogValue => ({ distance, edges });

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit(buildValue());
  };

  const handleApply = (): void => {
    if (!canCommit) return;
    onApply(buildValue());
  };

  const handleDistanceChange = (v: string): void => {
    setDistance(v);
    onDistanceChange(v);
  };

  const selectionModes: FilletSelectionMode[] = ['edge', 'loop', 'feature'];
  const selectionLabels: Record<FilletSelectionMode, string> = {
    edge: 'Edge',
    loop: 'Loop',
    feature: 'Feature',
    'all-fillets': 'All Fillets',
    'all-rounds': 'All Rounds',
  };

  return (
    <form
      role="dialog"
      aria-label={t('aria.chamfer')}
      onSubmit={handleSubmit}
      style={panelStyle}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.chamfer.title')}</div>

      <div style={{ marginBottom: 10 }}>
        <span style={sectionLabelStyle}>{t('dialog.chamfer.pick_mode')}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {selectionModes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSelectionModeChange(m)}
              style={toggleBtnStyle(pickingMode === m)}
            >
              {selectionLabels[m]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ ...rowStyle, marginBottom: 4 }}>
          <span style={{ ...sectionLabelStyle, marginBottom: 0 }}>{t('dialog.chamfer.edges_count', { count: edges.length })}</span>
          <button type="button" onClick={onAddEdges} style={btnStyle}>{t('common.add')}</button>
          <button type="button" onClick={onClearEdges} style={btnStyle}>{t('common.clear')}</button>
        </div>
        {edges.length === 0 ? (
          <div style={{ color: '#888', fontStyle: 'italic' }}>{t('dialog.chamfer.no_edges')}</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 120, overflowY: 'auto' }}>
            {edges.map((spec, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <span style={{ flex: 1 }}>{edgeLabel(spec)}</span>
                <button
                  type="button"
                  onClick={() => onRemoveEdge(spec)}
                  style={{ ...btnStyle, padding: '2px 6px', fontSize: 11 }}
                  aria-label={`Remove ${edgeLabel(spec)}`}
                >✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={rowStyle}>
        <label style={{ minWidth: 60 }}>{t('dialog.chamfer.distance')}</label>
        <input
          aria-label={t('aria.distance')}
          value={distance}
          onChange={(e) => handleDistanceChange(e.target.value)}
          style={inputStyle}
        />
      </div>
      {exprError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{exprError}</div>}
      {previewError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{previewError}</div>}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>{t('common.cancel')}</button>
        <button type="button" onClick={handleApply} disabled={!canCommit} style={btnStyle}>{t('common.apply')}</button>
        <button type="submit" disabled={!canCommit} style={btnStyle}>{t('common.ok')}</button>
      </div>
    </form>
  );
}
