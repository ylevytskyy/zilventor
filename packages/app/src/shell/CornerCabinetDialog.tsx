import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CornerCabinetParams, MaterialId } from '@zilventor/shared';
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

const DEFAULTS: Omit<CornerCabinetParams, 'carcassMaterialId' | 'backMaterialId'> = {
  name: 'Corner Cabinet 1',
  width1: 900, depth1: 600,
  width2: 900, depth2: 600,
  height: 720,
  bandMaterialId: null,
};

export function CornerCabinetDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.cornerCabinetDialog);
  const setDialog = useAppStore((s) => s.setCornerCabinetDialog);
  const asm = useAppStore((s) => s.activeAssembly);

  const initialCarcass = asm?.materials.find((m) => m.defaultThickness >= 12)?.id
    ?? asm?.materials[0]?.id ?? '';
  const initialBack = asm?.materials.find((m) => m.defaultThickness <= 8 && m.id !== initialCarcass)?.id
    ?? asm?.materials[0]?.id ?? '';

  const [params, setParams] = React.useState<CornerCabinetParams>({
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

  function patch<K extends keyof CornerCabinetParams>(k: K, v: CornerCabinetParams[K]): void {
    setParams((p) => ({ ...p, [k]: v }));
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
        aria-label={t('aria.cornerCabinet')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { void handleOk(); }
          else if (e.key === 'Escape') handleCancel();
        }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.cornerCabinet.title')}</div>

        <div style={sectionHeading}>{t('dialog.cabinet.name_section')}</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="ccab-name">{t('common.name')}</label>
          <input id="ccab-name" style={inputStyle} value={params.name} onChange={(e) => patch('name', e.target.value)} />
        </div>
        {errors.name && <div style={errStyle}>{errors.name}</div>}

        <div style={sectionHeading}>{t('dialog.cabinet.dimensions_section')}</div>
        {(['width1', 'depth1', 'width2', 'depth2', 'height'] as const).map((k) => (
          <React.Fragment key={k}>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor={`ccab-${k}`}>{t(`dialog.cornerCabinet.${k}`)}</label>
              <input
                id={`ccab-${k}`}
                aria-label={t(`dialog.cornerCabinet.${k}`)}
                type="number"
                style={inputStyle}
                value={params[k]}
                onChange={(e) => patch(k, Number(e.target.value))}
              />
            </div>
            {errors[k] && <div style={errStyle}>{errors[k]}</div>}
          </React.Fragment>
        ))}

        <div style={sectionHeading}>{t('dialog.cabinet.materials_section')}</div>
        {asm.materials.length === 0 && (
          <div style={{ ...errStyle, color: '#ffd6a3', marginLeft: 0 }}>
            {t('dialog.cabinet.no_materials')}
          </div>
        )}
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="ccab-carcass">{t('dialog.cabinet.carcass_material')}</label>
          <select id="ccab-carcass" aria-label={t('dialog.cabinet.carcass_material')} style={inputStyle}
            value={params.carcassMaterialId}
            onChange={(e) => patch('carcassMaterialId', e.target.value as MaterialId)}>
            <option value="">{t('dialog.cabinet.pick_placeholder')}</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {errors.carcassMaterialId && <div style={errStyle}>{errors.carcassMaterialId}</div>}

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="ccab-back">{t('dialog.cabinet.back_material')}</label>
          <select id="ccab-back" aria-label={t('dialog.cabinet.back_material')} style={inputStyle}
            value={params.backMaterialId}
            onChange={(e) => patch('backMaterialId', e.target.value as MaterialId)}>
            <option value="">{t('dialog.cabinet.pick_placeholder')}</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {errors.backMaterialId && <div style={errStyle}>{errors.backMaterialId}</div>}

        <div style={sectionHeading}>{t('dialog.cabinet.edge_bands_section')}</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="ccab-band">{t('dialog.cabinet.edge_band_material')}</label>
          <select id="ccab-band" aria-label={t('dialog.cabinet.edge_band_material')} style={inputStyle}
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

function validate(
  p: CornerCabinetParams,
  registry: ReadonlyArray<{ id: string; defaultThickness: number }>,
): Record<string, string> {
  const carcass = registry.find((m) => m.id === p.carcassMaterialId);
  const Tc = carcass?.defaultThickness ?? 18;
  const e: Record<string, string> = {};
  if (p.name.trim() === '') e.name = 'Cabinet name required.';
  if (p.width1 <= 2 * Tc) e.width1 = `Width 1 must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.depth1 <= 2 * Tc) e.depth1 = `Depth 1 must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.width2 <= 2 * Tc) e.width2 = `Width 2 must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.depth2 <= 2 * Tc) e.depth2 = `Depth 2 must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.height <= 2 * Tc) e.height = `Height must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.width1 <= p.depth2) e.width1 = 'Leg must extend past the corner (width1 > depth2).';
  if (p.width2 <= p.depth1) e.width2 = 'Leg must extend past the corner (width2 > depth1).';
  if (!carcass) e.carcassMaterialId = 'Pick a carcass material.';
  if (!registry.find((m) => m.id === p.backMaterialId)) e.backMaterialId = 'Pick a back material.';
  return e;
}
