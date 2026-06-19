import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { GenerateNestCommand } from '../commands/GenerateNestCommand';
import { useCutListResult } from './useCutListResult';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 360, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const labelStyle: React.CSSProperties = { width: 80, fontSize: 11 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const errStyle: React.CSSProperties = { color: '#ffb3b3', fontSize: 10, marginBottom: 4 };
const summaryStyle: React.CSSProperties = { fontSize: 11, color: '#aaa', marginBottom: 12 };
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function NestDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.nestDialog);
  const setDialog = useAppStore((s) => s.setNestDialog);
  const bus = useAppStore((s) => s.bus);
  const materials = useAppStore((s) => s.activeAssembly?.materials ?? []);
  const cutListResult = useCutListResult();
  const [kerfStr, setKerfStr] = React.useState('3');
  const [oversizeLStr, setOversizeLStr] = React.useState('0');
  const [oversizeWStr, setOversizeWStr] = React.useState('0');
  const [error, setError] = React.useState<string | null>(null);

  if (!dialog) return null;

  const kerf = Number(kerfStr);
  const validKerf = kerfStr.trim() !== '' && Number.isFinite(kerf) && kerf > 0;
  const oversizeL = Number(oversizeLStr);
  const oversizeW = Number(oversizeWStr);
  const validOversize =
    oversizeLStr.trim() !== '' && oversizeWStr.trim() !== '' &&
    Number.isFinite(oversizeL) && Number.isFinite(oversizeW) &&
    oversizeL >= 0 && oversizeW >= 0;

  const panelCount = cutListResult.rows.reduce((sum, r) => sum + r.qty, 0);
  const materialIdsWithRows = new Set(cutListResult.rows.map((r) => r.materialId));
  const materialsWithStock = materials.filter(
    (m) => materialIdsWithRows.has(m.id) && m.sheetLengthMm !== undefined && m.sheetWidthMm !== undefined,
  );
  const summary = t('dialog.nest.summary', { count: panelCount, materials: materialsWithStock.length });

  const handleOk = async (): Promise<void> => {
    if (!validKerf || !validOversize) return;
    setError(null);
    const oversize = oversizeL > 0 || oversizeW > 0 ? { lengthMm: oversizeL, widthMm: oversizeW } : undefined;
    try {
      await bus.execute(new GenerateNestCommand({ kerfMm: kerf, ...(oversize ? { oversize } : {}), result: cutListResult, materials }));
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleCancel = (): void => {
    setDialog(null);
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        style={panelStyle}
        role="dialog"
        aria-label={t('dialog.nest.ariaLabel')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.nest.title')}</div>

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nest-kerf">{t('dialog.nest.kerf')}</label>
          <input
            id="nest-kerf"
            aria-label={t('dialog.nest.kerfAriaLabel')}
            type="text"
            inputMode="numeric"
            style={inputStyle}
            value={kerfStr}
            onChange={(e) => setKerfStr(e.target.value)}
          />
        </div>
        {!validKerf && (
          <div role="alert" style={errStyle}>{t('dialog.nest.kerfError')}</div>
        )}

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nest-oversize-l">{t('dialog.nest.oversizeLength')}</label>
          <input
            id="nest-oversize-l"
            aria-label={t('dialog.nest.oversizeLengthAriaLabel')}
            type="text"
            inputMode="numeric"
            style={inputStyle}
            value={oversizeLStr}
            onChange={(e) => setOversizeLStr(e.target.value)}
          />
        </div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nest-oversize-w">{t('dialog.nest.oversizeWidth')}</label>
          <input
            id="nest-oversize-w"
            aria-label={t('dialog.nest.oversizeWidthAriaLabel')}
            type="text"
            inputMode="numeric"
            style={inputStyle}
            value={oversizeWStr}
            onChange={(e) => setOversizeWStr(e.target.value)}
          />
        </div>
        {!validOversize && (
          <div role="alert" style={errStyle}>{t('dialog.nest.oversizeError')}</div>
        )}

        {error && (
          <div role="alert" style={errStyle}>{error}</div>
        )}

        <p style={summaryStyle}>{summary}</p>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button
            style={okBtnStyle}
            onClick={() => { void handleOk(); }}
            disabled={!validKerf || !validOversize}
            aria-disabled={!validKerf || !validOversize}
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
