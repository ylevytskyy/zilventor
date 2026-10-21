import React from 'react';
import { useTranslation } from 'react-i18next';
import type { GrainDirection, MaterialEntry, MaterialId, PanelEdgeKey, PanelFeature, ParamOrLiteral } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { parseParamOrLiteral } from './parseParamOrLiteral';
import { MaterialRegistryEditor } from './MaterialRegistryEditor';

/**
 * PanelDialog (T24) — modal dialog bound to `useAppStore.panelDialog` state
 * (set by `OpenPanelDialogCommand`). Submits via `panelDialog.onSubmit` —
 * does NOT mutate the store directly.
 *
 * Layout:
 *   - Dimensions: Length, Width, Thickness (mm or =param). Thickness shows
 *     a `(from material)` badge when `thicknessFromMaterial === true`.
 *     Typing in Thickness clears the flag. Changing Material with flag=true
 *     refills Thickness from the new material's defaultThickness.
 *   - Material: <select> from active registry + Manage… toggle for inline
 *     MaterialRegistryEditor.
 *   - Grain: Length / Width / None radio buttons + arrow icons.
 *   - Edge bands: Front / Back / Left / Right material picks (None + registry).
 *   - OK / Cancel; Esc cancels; click on backdrop dismisses.
 */

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

const panelStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 16,
  width: 460,
  color: '#eee',
  fontSize: 12,
  maxHeight: '90vh',
  overflowY: 'auto',
};

const sectionHeading: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  fontSize: 12,
  marginBottom: 6,
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
};

const labelStyle: React.CSSProperties = { width: 80, fontSize: 11 };

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#222',
  border: '1px solid #444',
  color: '#eee',
  padding: '4px 6px',
  fontSize: 11,
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 11,
};

const okBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#3b5a8a',
  borderColor: '#6a8ec4',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#9ec0e8',
  marginLeft: 6,
};

const errorStyle: React.CSSProperties = {
  background: '#3a1a1a',
  border: '1px solid #6a3333',
  color: '#ffb3b3',
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 11,
  marginTop: 6,
};

function paramOrLiteralToText(p: ParamOrLiteral | undefined): string {
  if (!p) return '';
  if (p.kind === 'param') return `=${p.paramName}`;
  return String(p.value);
}

const EDGE_KEYS: readonly PanelEdgeKey[] = ['front', 'back', 'left', 'right'];
const EDGE_LABELS: Record<PanelEdgeKey, string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
};

function GrainArrow({ kind }: { kind: GrainDirection }): JSX.Element {
  if (kind === 'none') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <line x1="3" y1="3" x2="11" y2="11" stroke="#888" strokeWidth="1.5" />
        <line x1="11" y1="3" x2="3" y2="11" stroke="#888" strokeWidth="1.5" />
      </svg>
    );
  }
  // length = horizontal arrow ; width = vertical arrow
  const horizontal = kind === 'length';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {horizontal ? (
        <>
          <line x1="2" y1="7" x2="12" y2="7" stroke="#9ec0e8" strokeWidth="1.5" />
          <polyline points="9,4 12,7 9,10" fill="none" stroke="#9ec0e8" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <line x1="7" y1="2" x2="7" y2="12" stroke="#9ec0e8" strokeWidth="1.5" />
          <polyline points="4,9 7,12 10,9" fill="none" stroke="#9ec0e8" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

export function PanelDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const panelDialog = useAppStore((s) => s.panelDialog);
  const setPanelDialog = useAppStore((s) => s.setPanelDialog);
  const activePart = useAppStore((s) => s.activePart);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const materials: readonly MaterialEntry[] = activeAssembly
    ? activeAssembly.materials
    : (activePart?.materials ?? []);

  const initial = panelDialog?.initial;

  const [length, setLength] = React.useState<string>(() => paramOrLiteralToText(initial?.length) || '600');
  const [width, setWidth] = React.useState<string>(() => paramOrLiteralToText(initial?.width) || '400');
  const [thickness, setThickness] = React.useState<string>(() => paramOrLiteralToText(initial?.thickness) || '18');
  const [thicknessFromMaterial, setThicknessFromMaterial] = React.useState<boolean>(
    initial ? initial.thicknessFromMaterial : true,
  );
  const [materialId, setMaterialId] = React.useState<MaterialId>(() => {
    if (initial) return initial.materialId;
    return materials[0]?.id ?? '';
  });
  const [grain, setGrain] = React.useState<GrainDirection>(initial?.grain ?? 'length');
  const [edgeBands, setEdgeBands] = React.useState<Record<PanelEdgeKey, MaterialId | null>>(() => {
    if (initial) {
      return {
        front: initial.edgeBands.front?.materialId ?? null,
        back: initial.edgeBands.back?.materialId ?? null,
        left: initial.edgeBands.left?.materialId ?? null,
        right: initial.edgeBands.right?.materialId ?? null,
      };
    }
    return { front: null, back: null, left: null, right: null };
  });

  const [showRegistry, setShowRegistry] = React.useState(false);

  // Re-sync local field state whenever a new dialog request opens. PanelDialog
  // is rendered unconditionally by App (`<PanelDialog />`, never unmounted),
  // so the useState lazy initializers above only ever run ONCE — on the very
  // first render, back when `panelDialog` was still null (`initial` was
  // `undefined`). Every subsequent `setPanelDialog({..., initial})` call (e.g.
  // Convert-imported-part-to-panel's derived draft) was silently ignored by
  // the already-mounted fields. Without this effect the dialog always shows
  // stale/default values instead of the caller-supplied `initial`.
  React.useEffect(() => {
    if (!panelDialog) return;
    const init = panelDialog.initial;
    setLength(paramOrLiteralToText(init?.length) || '600');
    setWidth(paramOrLiteralToText(init?.width) || '400');
    setThickness(paramOrLiteralToText(init?.thickness) || '18');
    setThicknessFromMaterial(init ? init.thicknessFromMaterial : true);
    setMaterialId(init ? init.materialId : (materials[0]?.id ?? ''));
    setGrain(init?.grain ?? 'length');
    setEdgeBands(init
      ? {
          front: init.edgeBands.front?.materialId ?? null,
          back: init.edgeBands.back?.materialId ?? null,
          left: init.edgeBands.left?.materialId ?? null,
          right: init.edgeBands.right?.materialId ?? null,
        }
      : { front: null, back: null, left: null, right: null });
    setShowRegistry(false);
    // Intentionally keyed on `panelDialog` identity only (open/close
    // transitions), not `materials` — the registry can change while the
    // dialog is open (Manage… editor) without clobbering user edits.
  }, [panelDialog]);

  // Esc cancel handling.
  React.useEffect(() => {
    if (!panelDialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelDialog]);

  if (!panelDialog) return null;

  const materialResolves = materials.some((m) => m.id === materialId);
  const brokenMaterialRef = !materialResolves && materials.length > 0;

  const onMaterialChange = (newId: MaterialId) => {
    setMaterialId(newId);
    if (thicknessFromMaterial) {
      const m = materials.find((x) => x.id === newId);
      if (m) {
        setThickness(String(m.defaultThickness));
      }
    }
  };

  const onThicknessChange = (s: string) => {
    setThickness(s);
    // Typing in Thickness clears the from-material flag.
    if (thicknessFromMaterial) setThicknessFromMaterial(false);
  };

  const cancel = () => {
    panelDialog.onCancel();
    setPanelDialog(null);
  };

  const bandFor = (matId: MaterialId | '' | null): { materialId: MaterialId; thickness: number } | null =>
    matId ? { materialId: matId, thickness: materials.find((m) => m.id === matId)?.bandThicknessMm ?? 0.4 } : null;

  const submit = () => {
    if (brokenMaterialRef) return;
    const id = initial?.id ?? `pf-${Date.now()}`;
    const feature: PanelFeature = {
      kind: 'panel',
      id,
      length: parseParamOrLiteral(length),
      width: parseParamOrLiteral(width),
      thickness: parseParamOrLiteral(thickness),
      thicknessFromMaterial,
      materialId,
      grain,
      edgeBands: {
        front: bandFor(edgeBands.front),
        back: bandFor(edgeBands.back),
        left: bandFor(edgeBands.left),
        right: bandFor(edgeBands.right),
      },
    };
    panelDialog.onSubmit(feature);
    setPanelDialog(null);
  };

  const onOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      cancel();
    }
  };

  return (
    <div style={overlayStyle} onClick={onOverlayClick} data-testid="panel-dialog-backdrop">
      <div role="dialog" aria-label={t('dialog.panel.ariaLabel')} style={panelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>{t('dialog.panel.title')}</div>

        <section style={{ marginBottom: 12 }}>
          <h2 style={sectionHeading}>{t('dialog.panel.dimensions')}</h2>
          <div style={fieldRow}>
            <span style={labelStyle}>{t('dialog.panel.length')}</span>
            <input
              aria-label={t('dialog.panel.lengthAriaLabel')}
              type="text"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldRow}>
            <span style={labelStyle}>{t('dialog.panel.width')}</span>
            <input
              aria-label={t('dialog.panel.widthAriaLabel')}
              type="text"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldRow}>
            <span style={labelStyle}>{t('dialog.panel.thickness')}</span>
            <input
              aria-label={t('dialog.panel.thicknessAriaLabel')}
              type="text"
              value={thickness}
              onChange={(e) => onThicknessChange(e.target.value)}
              style={inputStyle}
            />
            {thicknessFromMaterial && (
              <span style={badgeStyle} data-testid="thickness-from-material-badge">
                {t('dialog.panel.fromMaterial')}
              </span>
            )}
          </div>
        </section>

        <section style={{ marginBottom: 12 }}>
          <h2 style={sectionHeading}>{t('dialog.panel.material')}</h2>
          <div style={fieldRow}>
            <select
              aria-label={t('dialog.panel.materialAriaLabel')}
              value={materialId}
              onChange={(e) => onMaterialChange(e.target.value)}
              style={selectStyle}
            >
              {!materialResolves && (
                <option value={materialId}>{materialId || '<none>'}</option>
              )}
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <button
              type="button"
              style={btnStyle}
              onClick={() => setShowRegistry((v) => !v)}
            >
              {t('common.manage')}
            </button>
          </div>
          {brokenMaterialRef && (
            <div role="alert" style={errorStyle}>
              {t('dialog.panel.brokenMaterial', { id: materialId })}
            </div>
          )}
          {showRegistry && (
            <div style={{ marginTop: 8, padding: 8, border: '1px solid #333', borderRadius: 4 }}>
              <MaterialRegistryEditor />
            </div>
          )}
        </section>

        <section style={{ marginBottom: 12 }}>
          <h2 style={sectionHeading}>{t('dialog.panel.grain')}</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            {(['length', 'width', 'none'] as const).map((g) => (
              <label
                key={g}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              >
                <input
                  type="radio"
                  name="panelGrain"
                  checked={grain === g}
                  onChange={() => setGrain(g)}
                />
                <GrainArrow kind={g} />
                {g === 'none' ? t('dialog.panel.grainNone') : g === 'length' ? t('dialog.panel.grainLength') : t('dialog.panel.grainWidth')}
              </label>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 12 }}>
          <h2 style={sectionHeading}>{t('dialog.panel.edgeBands')}</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              {EDGE_KEYS.map((k) => (
                <tr key={k}>
                  <td style={{ padding: '3px 6px', width: 80 }}>{EDGE_LABELS[k]}</td>
                  <td style={{ padding: '3px 6px' }}>
                    <select
                      aria-label={t('dialog.panel.edgeAriaLabel', { edge: EDGE_LABELS[k] })}
                      value={edgeBands[k] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEdgeBands((cur) => ({ ...cur, [k]: v === '' ? null : v }));
                      }}
                      style={{ ...selectStyle, width: '100%' }}
                    >
                      <option value="">&lt;None&gt;</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={cancel} style={btnStyle}>{t('common.cancel')}</button>
          <button
            type="button"
            onClick={submit}
            style={okBtnStyle}
            disabled={brokenMaterialRef}
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
