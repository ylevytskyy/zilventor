import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilletEdgeSpec, FilletSelectionMode } from '@zilventor/shared';

export type FilletMode = 'constant' | 'variable';

export type FilletDialogValue = {
  mode: FilletMode;
  radius: string;
  edges: FilletEdgeSpec[];
  setbacks: Array<{
    vertexKey: string;
    perEdge: Array<{ edgeKey: string; setback: string }>;
  }>;
};

export type FilletVertexDescriptor = {
  vertexKey: string;
  perEdge: Array<{
    edgeKey: string;
    defaultSetback: number;
    currentSetback?: string;
  }>;
};

type Props = {
  edges: FilletEdgeSpec[];
  pickingMode: FilletSelectionMode;
  previewError: string | null;
  initialMode?: FilletMode;
  initialRadius?: string | undefined;
  vertices?: FilletVertexDescriptor[];
  onCommit(v: FilletDialogValue): void;
  onApply(v: FilletDialogValue): void;
  onCancel(): void;
  onAddEdges(): void;
  onRemoveEdge(spec: FilletEdgeSpec): void;
  onClearEdges(): void;
  onSelectionModeChange(mode: FilletSelectionMode): void;
  onModeChange(mode: FilletMode): void;
  onRadiusChange(expression: string): void;
  onVariableRadiiChange?(
    edge: FilletEdgeSpec,
    startR: string,
    endR: string,
  ): void;
  onSetbackChange?(
    vertexKey: string,
    edgeKey: string,
    setback: string,
  ): void;
  validateExpression?(expression: string): string | null;
};

// Styling palette mirrors RevolveDialog (#1a1a1a panel, #eee text, #2a2a2a
// buttons, #3b5a8a pressed, #ff6b6b error).
const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  right: 20,
  background: '#1a1a1a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 12,
  width: 400,
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

const smallInputStyle: React.CSSProperties = {
  ...inputStyle,
  width: 60,
  flex: 'none',
};

const pickBtnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 8px',
  cursor: 'pointer',
};

const toggleBtnStyle = (
  pressed: boolean,
  disabled: boolean,
): React.CSSProperties => ({
  background: pressed ? '#3b5a8a' : '#2a2a2a',
  color: disabled ? '#777' : '#eee',
  border: pressed ? '1px solid #6a8ec4' : '1px solid #444',
  padding: '4px 10px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  flex: 1,
});

const tabBtnStyle = (
  active: boolean,
  disabled: boolean,
): React.CSSProperties => ({
  background: active ? '#2a2a2a' : 'transparent',
  color: disabled ? '#666' : active ? '#eee' : '#bbb',
  border: '1px solid #444',
  borderBottom: active ? '1px solid #2a2a2a' : '1px solid #444',
  padding: '4px 10px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: active ? 600 : 400,
});

const removeBtnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '2px 6px',
  cursor: 'pointer',
  fontSize: 11,
};

function edgeKey(spec: FilletEdgeSpec): string {
  const a = spec.edgeId.faceA;
  const b = spec.edgeId.faceB;
  return `${a.featureId}|${a.role}|${a.instance ?? 0}__${b.featureId}|${b.role}|${b.instance ?? 0}`;
}

function edgeLabel(spec: FilletEdgeSpec): string {
  const a = spec.edgeId.faceA;
  const b = spec.edgeId.faceB;
  const aLabel = a.instance != null ? `${a.role}${a.instance}` : a.role;
  const bLabel = b.instance != null ? `${b.role}${b.instance}` : b.role;
  return `${aLabel}-${bLabel}`;
}

function radiusText(r: { kind: 'param'; paramName: string } | { kind: 'literal'; value: number }): string {
  return r.kind === 'literal' ? String(r.value) : r.paramName;
}

// Tiny pictogram for the selection mode on a per-edge row.
function selectionIcon(mode: FilletSelectionMode): string {
  switch (mode) {
    case 'edge':
      return 'E';
    case 'loop':
      return 'L';
    case 'feature':
      return 'F';
    case 'all-fillets':
      return 'AF';
    case 'all-rounds':
      return 'AR';
  }
}

type Tab = 'edges' | 'variable' | 'setbacks';

export function FilletDialog({
  edges,
  pickingMode,
  previewError,
  initialMode = 'constant',
  initialRadius,
  vertices,
  onCommit,
  onApply,
  onCancel,
  onAddEdges,
  onRemoveEdge,
  onClearEdges,
  onSelectionModeChange,
  onModeChange,
  onRadiusChange,
  onVariableRadiiChange,
  onSetbackChange,
  validateExpression,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<FilletMode>(initialMode);
  const [radius, setRadius] = useState(initialRadius ?? '1');
  const [tab, setTab] = useState<Tab>('edges');
  // Local per-edge variable-radius drafts keyed by canonical edge key.
  const [varDraft, setVarDraft] = useState<Record<string, { startR: string; endR: string }>>({});
  // Local per-vertex/per-edge setback drafts keyed by "vertexKey__edgeKey".
  const [setbackDraft, setSetbackDraft] = useState<Record<string, string>>({});

  // Keep internal mode in sync with host-driven initialMode (dialog is kept
  // mounted across mode swaps during a single editing session).
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const exprError = validateExpression ? validateExpression(radius) : null;
  const canCommit = edges.length > 0 && exprError === null;

  const buildValue = (): FilletDialogValue => ({
    mode,
    radius,
    edges,
    setbacks: vertices
      ? vertices.map((v) => ({
          vertexKey: v.vertexKey,
          perEdge: v.perEdge.map((pe) => ({
            edgeKey: pe.edgeKey,
            setback:
              setbackDraft[`${v.vertexKey}__${pe.edgeKey}`] ??
              pe.currentSetback ??
              String(pe.defaultSetback),
          })),
        }))
      : [],
  });

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit(buildValue());
  };

  const handleApply = (): void => {
    if (!canCommit) return;
    onApply(buildValue());
  };

  const handleRadiusChange = (v: string): void => {
    setRadius(v);
    onRadiusChange(v);
  };

  const handleModeChange = (next: FilletMode): void => {
    setMode(next);
    onModeChange(next);
    // Users flipping to variable mode naturally want to edit the per-edge
    // radii next; auto-swap to the Variable tab for them.
    if (next === 'variable') setTab('variable');
  };

  const variableDisabled = mode === 'constant';

  const selectionModes: FilletSelectionMode[] = [
    'edge',
    'loop',
    'feature',
    'all-fillets',
    'all-rounds',
  ];
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
      aria-label={t('aria.fillet')}
      onSubmit={handleSubmit}
      style={panelStyle}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.fillet.title')}</div>

      {/* Constant/Variable mode toggle */}
      <div style={{ marginBottom: 10 }}>
        <span style={sectionLabelStyle}>{t('dialog.fillet.mode')}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            aria-pressed={mode === 'constant'}
            style={toggleBtnStyle(mode === 'constant', false)}
            onClick={() => handleModeChange('constant')}
          >
            {t('dialog.fillet.constant')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'variable'}
            style={toggleBtnStyle(mode === 'variable', false)}
            onClick={() => handleModeChange('variable')}
          >
            {t('dialog.fillet.variable')}
          </button>
        </div>
      </div>

      {/* 5-way selection-mode toggle */}
      <div style={{ marginBottom: 10 }}>
        <span style={sectionLabelStyle}>{t('dialog.fillet.selection')}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {selectionModes.map((sm) => (
            <button
              key={sm}
              type="button"
              aria-pressed={pickingMode === sm}
              style={toggleBtnStyle(pickingMode === sm, false)}
              onClick={() => onSelectionModeChange(sm)}
            >
              {selectionLabels[sm]}
            </button>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={t('aria.fillet_tabs')}
        style={{ display: 'flex', gap: 2, marginBottom: 10, borderBottom: '1px solid #444' }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'edges'}
          style={tabBtnStyle(tab === 'edges', false)}
          onClick={() => setTab('edges')}
        >
          {t('dialog.fillet.edges_tab')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'variable'}
          aria-disabled={variableDisabled ? 'true' : 'false'}
          disabled={variableDisabled}
          style={tabBtnStyle(tab === 'variable' && !variableDisabled, variableDisabled)}
          onClick={() => {
            if (!variableDisabled) setTab('variable');
          }}
        >
          {t('dialog.fillet.variable_tab')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'setbacks'}
          style={tabBtnStyle(tab === 'setbacks', false)}
          onClick={() => setTab('setbacks')}
        >
          {t('dialog.fillet.setbacks_tab')}
        </button>
      </div>

      {/* Edges tab */}
      {tab === 'edges' && (
        <div>
          <label style={{ display: 'block', marginBottom: 8 }}>
            {t('dialog.fillet.radius')}
            <input
              aria-label={t('dialog.fillet.radius')}
              value={radius}
              onChange={(e) => handleRadiusChange(e.target.value)}
              style={{ ...inputStyle, marginTop: 2, width: '100%' }}
            />
            {exprError && (
              <span
                role="alert"
                style={{
                  display: 'block',
                  color: '#ff6b6b',
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                {exprError}
              </span>
            )}
          </label>

          <div style={{ marginBottom: 8 }}>
            <div style={{ ...rowStyle, marginBottom: 4 }}>
              <span style={sectionLabelStyle}>{t('dialog.fillet.edges_count', { count: edges.length })}</span>
              <div style={{ flex: 1 }} />
              <button type="button" style={pickBtnStyle} onClick={onAddEdges}>
                {t('common.add')}
              </button>
              <button type="button" style={pickBtnStyle} onClick={onClearEdges}>
                {t('dialog.fillet.clear_all')}
              </button>
            </div>

            <div
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            >
              {edges.length === 0 ? (
                <div style={{ color: '#888', padding: 8, fontStyle: 'italic' }}>
                  {t('dialog.fillet.no_edges')}
                </div>
              ) : (
                edges.map((spec) => (
                  <div
                    key={edgeKey(spec)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 8px',
                      borderBottom: '1px solid #2a2a2a',
                    }}
                  >
                    <span
                      title={spec.selectionMode}
                      style={{
                        display: 'inline-block',
                        width: 20,
                        textAlign: 'center',
                        fontWeight: 600,
                        color: '#8ab4f8',
                      }}
                    >
                      {selectionIcon(spec.selectionMode)}
                    </span>
                    <span style={{ flex: 1 }}>{edgeLabel(spec)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${edgeLabel(spec)}`}
                      style={removeBtnStyle}
                      onClick={() => onRemoveEdge(spec)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Variable tab */}
      {tab === 'variable' && !variableDisabled && (
        <div>
          <div style={{ ...sectionLabelStyle, marginBottom: 6 }}>
            {t('dialog.fillet.variable_radii')}
          </div>
          {edges.length === 0 ? (
            <div style={{ color: '#888', fontStyle: 'italic' }}>
              {t('dialog.fillet.no_edges_selected')}
            </div>
          ) : (
            edges.map((spec) => {
              const key = edgeKey(spec);
              const initialStart = spec.variableRadii
                ? radiusText(spec.variableRadii.startRadius)
                : radius;
              const initialEnd = spec.variableRadii
                ? radiusText(spec.variableRadii.endRadius)
                : radius;
              const draft = varDraft[key] ?? {
                startR: initialStart,
                endR: initialEnd,
              };
              const update = (startR: string, endR: string): void => {
                setVarDraft((prev) => ({ ...prev, [key]: { startR, endR } }));
                onVariableRadiiChange?.(spec, startR, endR);
              };
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      minWidth: 90,
                      fontSize: 11,
                      color: '#bbb',
                    }}
                  >
                    {edgeLabel(spec)}
                  </span>
                  <input
                    aria-label={t('aria.start_radius')}
                    value={draft.startR}
                    onChange={(e) => update(e.target.value, draft.endR)}
                    style={smallInputStyle}
                  />
                  {/* Gradient bar preview between start and end radii */}
                  <div
                    style={{
                      flex: 1,
                      height: 10,
                      borderRadius: 2,
                      background:
                        'linear-gradient(to right, #3b5a8a 0%, #8ab4f8 100%)',
                      border: '1px solid #444',
                    }}
                    aria-hidden="true"
                  />
                  <input
                    aria-label={t('aria.end_radius')}
                    value={draft.endR}
                    onChange={(e) => update(draft.startR, e.target.value)}
                    style={smallInputStyle}
                  />
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Setbacks tab */}
      {tab === 'setbacks' && (
        <div>
          <div style={{ ...sectionLabelStyle, marginBottom: 6 }}>
            {t('dialog.fillet.setbacks_label')}
          </div>
          {!vertices || vertices.length === 0 ? (
            <div style={{ color: '#888', fontStyle: 'italic' }}>
              {t('dialog.fillet.no_vertices')}
            </div>
          ) : (
            vertices.map((v) => (
              <fieldset
                key={v.vertexKey}
                style={{
                  border: '1px solid #333',
                  borderRadius: 4,
                  padding: 6,
                  marginBottom: 8,
                }}
              >
                <legend style={{ padding: '0 4px', color: '#bbb' }}>
                  Vertex {v.vertexKey}
                </legend>
                {v.perEdge.map((pe) => {
                  const draftKey = `${v.vertexKey}__${pe.edgeKey}`;
                  const value =
                    setbackDraft[draftKey] ??
                    pe.currentSetback ??
                    String(pe.defaultSetback);
                  return (
                    <div
                      key={pe.edgeKey}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          minWidth: 90,
                          fontSize: 11,
                          color: '#bbb',
                        }}
                      >
                        {pe.edgeKey}
                      </span>
                      <input
                        aria-label={t('aria.setback')}
                        value={value}
                        onChange={(e) => {
                          const next = e.target.value;
                          setSetbackDraft((prev) => ({
                            ...prev,
                            [draftKey]: next,
                          }));
                          onSetbackChange?.(v.vertexKey, pe.edgeKey, next);
                        }}
                        style={smallInputStyle}
                      />
                    </div>
                  );
                })}
              </fieldset>
            ))
          )}
        </div>
      )}

      {previewError && (
        <div
          role="alert"
          style={{
            background: '#3a1a1a',
            border: '1px solid #6a3333',
            color: '#ffb3b3',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            marginTop: 10,
            marginBottom: 8,
          }}
        >
          Preview: {previewError}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginTop: 10,
        }}
      >
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" onClick={handleApply} disabled={!canCommit}>
          {t('common.apply')}
        </button>
        <button type="submit" disabled={!canCommit}>
          {t('common.ok')}
        </button>
      </div>
    </form>
  );
}
