import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 300, color: '#eee', fontSize: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6,
};
const fieldStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444', fontSize: 11,
  padding: '2px 4px', width: 130,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };
const errorStyle: React.CSSProperties = { color: '#ff6b6b', fontSize: 11, marginBottom: 6 };
const helperStyle: React.CSSProperties = { color: '#aaa', fontSize: 11, marginBottom: 6 };

const LEG_LEVELER_SKUS = BUILTIN_CATALOG.filter((e) => e.category === 'legLevelers');
const DEFAULT_SKU = 'leg-leveler-100';
const DEFAULT_LEGS_PER_ROW = 2;

export function LegLevelersDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.addLegLevelersDialog);
  const setDialog = useAppStore((s) => s.setAddLegLevelersDialog);
  const machiningPresets = useAppStore((s) => s.machiningPresets);
  const matchingPresets = machiningPresets.filter((p) => p.opType === 'legLeveler');

  const [legsPerRowStr, setLegsPerRowStr] = React.useState(String(DEFAULT_LEGS_PER_ROW));
  const [skuId, setSkuId] = React.useState(DEFAULT_SKU);
  const [presetId, setPresetId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setLegsPerRowStr(String(DEFAULT_LEGS_PER_ROW));
      setSkuId(DEFAULT_SKU);
      setPresetId('');
      setError(null);
    }
  }, [dialog]);

  if (!dialog) return null;

  const legsPerRow = parseInt(legsPerRowStr, 10);
  const legsPerRowValid = Number.isInteger(legsPerRow) && legsPerRow >= 2;
  const totalLegs = legsPerRowValid ? 2 * legsPerRow : 0;

  const handleOk = async (): Promise<void> => {
    if (!legsPerRowValid) {
      setError(t('dialog.legLevelers.error.tooFewLegs'));
      return;
    }
    setError(null);
    const preset = matchingPresets.find((p) => p.id === presetId);
    const presetValues = preset
      ? {
          diameter: preset.diameter,
          depth: preset.depth,
          layerName: preset.layerName,
          ...(preset.toolNumber === undefined ? {} : { toolNumber: preset.toolNumber }),
          ...(preset.speed === undefined ? {} : { speed: preset.speed }),
        }
      : undefined;
    try {
      await dialog.onSubmit({ legsPerRow, skuId, ...(presetValues ? { presetValues } : {}) });
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // If the message is an i18n key (e.g. "legLeveler.error.tooSmall"), translate it.
      // Map command error keys (legLeveler.error.*) to dialog i18n keys (dialog.legLevelers.error.*).
      const i18nKey = msg.startsWith('legLeveler.error.')
        ? `dialog.legLevelers.error.${msg.slice('legLeveler.error.'.length)}`
        : msg;
      const translated = t(i18nKey, { defaultValue: msg });
      setError(translated);
      // Dialog stays open — do NOT call setDialog(null)
    }
  };

  const handleCancel = (): void => {
    dialog.onCancel();
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
        aria-label={t('dialog.legLevelers.title')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.legLevelers.title')}</div>

        <div style={rowStyle}>
          <label htmlFor="leglevelers-count">{t('dialog.legLevelers.legsPerRow')}</label>
          <input
            id="leglevelers-count"
            aria-label={t('dialog.legLevelers.legsPerRow')}
            style={fieldStyle}
            type="number"
            min={2}
            step={1}
            value={legsPerRowStr}
            onChange={(e) => { setLegsPerRowStr(e.target.value); setError(null); }}
          />
        </div>

        <div style={rowStyle}>
          <label htmlFor="leglevelers-sku">{t('dialog.legLevelers.sku')}</label>
          <select
            id="leglevelers-sku"
            aria-label={t('dialog.legLevelers.sku')}
            style={fieldStyle}
            value={skuId}
            onChange={(e) => setSkuId(e.target.value)}
          >
            {LEG_LEVELER_SKUS.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        {legsPerRowValid && (
          <div style={helperStyle}>{t('dialog.legLevelers.total', { n: totalLegs })}</div>
        )}

        {matchingPresets.length > 0 && (
          <div style={rowStyle}>
            <label htmlFor="leglevelers-preset">{t('bore.machining_preset', 'Machining preset')}</label>
            <select
              id="leglevelers-preset"
              aria-label={t('bore.machining_preset', 'Machining preset')}
              style={fieldStyle}
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value="">{t('common.none')}</option>
              {matchingPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div style={errorStyle} role="alert">{error}</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button
            style={okBtnStyle}
            onClick={() => { void handleOk(); }}
            disabled={!legsPerRowValid}
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
