import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BaseCabinetParams, CabinetType, MaterialId } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 480, color: '#eee', fontSize: 12, maxHeight: '90vh', overflowY: 'auto',
};
const sectionHeading: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: 12, marginTop: 8, marginBottom: 6,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const labelStyle: React.CSSProperties = { width: 130, fontSize: 11 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const errStyle: React.CSSProperties = { color: '#ffb3b3', fontSize: 10, marginLeft: 130, marginBottom: 4 };
const submitErrStyle: React.CSSProperties = { color: '#ff6b6b', fontSize: 11, marginBottom: 6 };
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

const DEFAULTS: Omit<BaseCabinetParams, 'carcassMaterialId' | 'backMaterialId'> = {
  name: 'Base Cabinet 1',
  cabinetType: 'base',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50,
  shelfCount: 1, bandMaterialId: null,
};

// Dimension presets applied when the user switches cabinet type. Wall uppers
// hang on the wall (no toekick); tall units use a full-height preset (≥2000 mm).
const TYPE_PRESETS: Record<CabinetType, Pick<BaseCabinetParams, 'height' | 'depth' | 'toekickHeight'>> = {
  base: { height: 720, depth: 560, toekickHeight: 100 },
  wall: { height: 720, depth: 320, toekickHeight: 0 },
  tall: { height: 2100, depth: 560, toekickHeight: 100 },
};

export function CabinetDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.cabinetDialog);
  const setDialog = useAppStore((s) => s.setCabinetDialog);
  const asm = useAppStore((s) => s.activeAssembly);

  const initialCarcass = asm?.materials.find((m) => m.defaultThickness >= 12)?.id
    ?? asm?.materials[0]?.id ?? '';
  const initialBack = asm?.materials.find((m) => m.defaultThickness <= 8 && m.id !== initialCarcass)?.id
    ?? asm?.materials[0]?.id ?? '';

  const [params, setParams] = React.useState<BaseCabinetParams>({
    ...DEFAULTS,
    carcassMaterialId: initialCarcass,
    backMaterialId: initialBack,
    ...(dialog?.initial ?? {}),
  });

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!dialog) return;
    setParams((prev) => ({
      ...prev,
      carcassMaterialId: dialog.initial?.carcassMaterialId ?? initialCarcass,
      backMaterialId: dialog.initial?.backMaterialId ?? initialBack,
      ...(dialog.initial ?? {}),
    }));
    setSubmitError(null);
  }, [dialog, initialCarcass, initialBack]);

  if (!dialog || !asm) return null;

  const errors = validate(params, asm.materials);
  const hasErr = Object.keys(errors).length > 0;

  function patch<K extends keyof BaseCabinetParams>(k: K, v: BaseCabinetParams[K]): void {
    setParams((p) => ({ ...p, [k]: v }));
  }

  function changeType(type: CabinetType): void {
    setParams((p) => ({ ...p, cabinetType: type, ...TYPE_PRESETS[type] }));
  }

  async function handleOk(): Promise<void> {
    if (hasErr) return;
    setSubmitError(null);
    try {
      await dialog!.onSubmit(params);
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
    }
  }

  function handleCancel(): void {
    dialog!.onCancel();
    setDialog(null);
  }

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}>
      <div
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.cabinet')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { void handleOk(); }
          else if (e.key === 'Escape') handleCancel();
        }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.cabinet.title')}</div>

        <div style={sectionHeading}>{t('dialog.cabinet.name_section')}</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-name">{t('common.name')}</label>
          <input id="cab-name" style={inputStyle} value={params.name} onChange={(e) => patch('name', e.target.value)} />
        </div>
        {errors.name && <div style={errStyle}>{errors.name}</div>}

        <div style={sectionHeading}>{t('dialog.cabinet.type_section')}</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-type">{t('dialog.cabinet.type_label')}</label>
          <select id="cab-type" aria-label={t('dialog.cabinet.type_label')} style={inputStyle}
            value={params.cabinetType ?? 'base'}
            onChange={(e) => changeType(e.target.value as CabinetType)}>
            <option value="base">{t('dialog.cabinet.type_base')}</option>
            <option value="wall">{t('dialog.cabinet.type_wall')}</option>
            <option value="tall">{t('dialog.cabinet.type_tall')}</option>
          </select>
        </div>

        <div style={sectionHeading}>{t('dialog.cabinet.dimensions_section')}</div>
        {(['width', 'depth', 'height'] as const).map((k) => (
          <React.Fragment key={k}>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor={`cab-${k}`}>{cap(k)}</label>
              <input id={`cab-${k}`} aria-label={cap(k)} type="number" style={inputStyle}
                value={params[k]} onChange={(e) => patch(k, Number(e.target.value))} />
            </div>
            {errors[k] && <div style={errStyle}>{errors[k]}</div>}
          </React.Fragment>
        ))}

        <div style={sectionHeading}>{t('dialog.cabinet.toekick_section')}</div>
        {(['toekickHeight', 'toekickSetback'] as const).map((k) => (
          <React.Fragment key={k}>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor={`cab-${k}`}>{titleFor(k)}</label>
              <input id={`cab-${k}`} aria-label={titleFor(k)} type="number" style={inputStyle}
                value={params[k]} onChange={(e) => patch(k, Number(e.target.value))} />
            </div>
            {errors[k] && <div style={errStyle}>{errors[k]}</div>}
          </React.Fragment>
        ))}

        <div style={sectionHeading}>{t('dialog.cabinet.shelves_section')}</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-shelfCount">{t('dialog.cabinet.shelf_count')}</label>
          <input id="cab-shelfCount" aria-label={t('dialog.cabinet.shelf_count')} type="number" min={0} style={inputStyle}
            value={params.shelfCount}
            onChange={(e) => patch('shelfCount', Math.max(0, Math.floor(Number(e.target.value))))} />
        </div>
        {errors.shelfCount && <div style={errStyle}>{errors.shelfCount}</div>}

        <div style={sectionHeading}>{t('dialog.cabinet.materials_section')}</div>
        {asm.materials.length === 0 && (
          <div style={{ ...errStyle, color: '#ffd6a3', marginLeft: 0 }}>
            {t('dialog.cabinet.no_materials')}
          </div>
        )}
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-carcass">{t('dialog.cabinet.carcass_material')}</label>
          <select id="cab-carcass" aria-label={t('dialog.cabinet.carcass_material')} style={inputStyle}
            value={params.carcassMaterialId}
            onChange={(e) => patch('carcassMaterialId', e.target.value as MaterialId)}>
            <option value="">{t('dialog.cabinet.pick_placeholder')}</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {errors.carcassMaterialId && <div style={errStyle}>{errors.carcassMaterialId}</div>}

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-back">{t('dialog.cabinet.back_material')}</label>
          <select id="cab-back" aria-label={t('dialog.cabinet.back_material')} style={inputStyle}
            value={params.backMaterialId}
            onChange={(e) => patch('backMaterialId', e.target.value as MaterialId)}>
            <option value="">{t('dialog.cabinet.pick_placeholder')}</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {errors.backMaterialId && <div style={errStyle}>{errors.backMaterialId}</div>}

        <div style={sectionHeading}>{t('dialog.cabinet.edge_bands_section')}</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-band">{t('dialog.cabinet.edge_band_material')}</label>
          <select id="cab-band" aria-label={t('dialog.cabinet.edge_band_material')} style={inputStyle}
            value={params.bandMaterialId ?? ''}
            onChange={(e) => patch('bandMaterialId', e.target.value === '' ? null : (e.target.value as MaterialId))}>
            <option value="">{t('dialog.cabinet.none')}</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div style={{ ...errStyle, color: '#9ec0e8', fontStyle: 'italic' }}>
          {t('dialog.cabinet.front_edges_note')}
        </div>

        {submitError && (
          <div style={submitErrStyle} role="alert">{submitError}</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={() => { void handleOk(); }} disabled={hasErr} aria-disabled={hasErr}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function titleFor(k: 'toekickHeight' | 'toekickSetback'): string {
  return k === 'toekickHeight' ? 'Toekick height' : 'Toekick setback';
}

function validate(
  p: BaseCabinetParams,
  registry: ReadonlyArray<{ id: string; defaultThickness: number }>,
): Record<string, string> {
  const carcass = registry.find((m) => m.id === p.carcassMaterialId);
  const Tc = carcass?.defaultThickness ?? 18;
  const e: Record<string, string> = {};
  if (p.name.trim() === '') e.name = 'Cabinet name required.';
  if (p.width <= 2 * Tc) e.width = `Width must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.depth <= 2 * Tc) e.depth = `Depth must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.height <= 2 * Tc + p.toekickHeight) e.height = 'Height must exceed toekick + 2× carcass thickness.';
  if (p.toekickHeight !== 0 && p.toekickHeight >= p.height / 2) e.toekickHeight = 'Toekick must be less than half the cabinet height.';
  if (p.toekickSetback < 0 || p.toekickSetback >= p.depth - Tc) e.toekickSetback = `Setback must be between 0 and ${p.depth - Tc - 1} mm.`;
  const innerH = p.height - p.toekickHeight - 2 * Tc;
  const maxShelves = Math.max(0, Math.floor(innerH / 100));
  if (p.shelfCount < 0 || p.shelfCount > maxShelves) e.shelfCount = `0 ≤ shelf count ≤ ${maxShelves}.`;
  if (!carcass) e.carcassMaterialId = 'Pick a carcass material.';
  if (!registry.find((m) => m.id === p.backMaterialId)) e.backMaterialId = 'Pick a back material.';
  return e;
}
