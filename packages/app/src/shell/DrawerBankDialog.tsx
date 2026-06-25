import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';

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
const sectionStyle: React.CSSProperties = { fontWeight: 600, marginTop: 8, marginBottom: 4, fontSize: 11 };

export interface DrawerBankDialogOpts {
  count: number;
  overlay: 'full' | 'half' | 'inset';
  thickness: number;
}

/**
 * canFitDrawers — degenerate guard per spec §14.3.
 * openW ≤ 57 → front/back panel width ≤ 0.
 * slotH ≤ 24 → box height bh ≤ 0 (BOX_VERT_CLEARANCE: 12 both ends).
 */
export function canFitDrawers(
  dims: { openW: number; openH: number },
  count: number,
): boolean {
  if (count < 1) return false;
  const slotH = dims.openH / count;
  return dims.openW > 57 && slotH > 24;
}

export function DrawerBankDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.addDrawerBankDialog);
  const setDialog = useAppStore((s) => s.setAddDrawerBankDialog);

  const [countStr, setCountStr] = React.useState('3');
  const [overlay, setOverlay] = React.useState<'full' | 'half' | 'inset'>('full');
  const [thicknessStr, setThicknessStr] = React.useState('18');
  const [error, setError] = React.useState<string | null>(null);
  const [heightStrs, setHeightStrs] = React.useState<string[]>([]);

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setCountStr('3');
      setOverlay('full');
      setThicknessStr('18');
      setError(null);
    }
  }, [dialog]);

  // (Re)initialize height inputs when count or openH changes.
  const count = parseInt(countStr, 10);
  const countValid = Number.isInteger(count) && count >= 2 && count <= 10;
  const openH = dialog?.dims?.openH;

  React.useEffect(() => {
    if (!countValid || openH == null) {
      setHeightStrs([]);
      return;
    }
    const base = Math.round(openH / count);
    const others = Array.from({ length: count - 1 }, () => base);
    const othersSum = others.reduce((a, b) => a + b, 0);
    const last = openH - othersSum;
    setHeightStrs([...others.map(String), String(last)]);
  }, [count, openH, countValid]);

  if (!dialog) return null;

  // Parse heights and compute validity.
  const heights = heightStrs.map(Number);
  const sum = heights.reduce((a, b) => a + b, 0);
  const remaining = openH != null ? openH - sum : 0;
  const heightsValid = openH == null
    ? true
    : Number.isFinite(sum) && Math.abs(remaining) <= 0.5 && heights.every((h) => Number.isFinite(h) && h > 0);

  const handleOk = async (): Promise<void> => {
    if (!countValid) {
      setError(t('dialog.drawerBank.error.invalidCount'));
      return;
    }
    // Degenerate guard: use dims from the dialog if available; fallback to passing dims
    // if the dialog supplies them (for tests). For real usage, dims are derived inside the command.
    if (dialog.dims && !canFitDrawers(dialog.dims, count)) {
      setError(t('dialog.drawerBank.error.tooSmall'));
      return;
    }
    setError(null);
    try {
      await dialog.onSubmit({
        count,
        overlay,
        thickness: Number(thicknessStr),
        ...(openH != null ? { heights } : {}),
      });
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // If the message is an i18n key (e.g. "drawerBank.error.tooSmall"), translate it.
      // Otherwise display the raw message.
      const translated = t(msg, { defaultValue: msg });
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
        aria-label={t('aria.add_drawers_dialog')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.drawerBank.title')}</div>

        <div style={rowStyle}>
          <label htmlFor="drawerbank-count">{t('dialog.drawerBank.count')}</label>
          <input
            id="drawerbank-count"
            aria-label={t('dialog.drawerBank.count')}
            style={fieldStyle}
            type="number"
            min={2}
            max={10}
            step={1}
            value={countStr}
            onChange={(e) => { setCountStr(e.target.value); setError(null); }}
          />
        </div>
        {!countValid && countStr !== '' && (
          <div style={errorStyle}>{t('dialog.drawerBank.error.invalidCount')}</div>
        )}

        <div style={rowStyle}>
          <label htmlFor="drawerbank-overlay">{t('dialog.drawerBank.overlay')}</label>
          <select
            id="drawerbank-overlay"
            aria-label={t('dialog.drawerBank.overlay')}
            style={fieldStyle}
            value={overlay}
            onChange={(e) => setOverlay(e.target.value as 'full' | 'half' | 'inset')}
          >
            <option value="full">{t('dialog.drawerBank.overlayFull')}</option>
            <option value="half">{t('dialog.drawerBank.overlayHalf')}</option>
            <option value="inset">{t('dialog.drawerBank.overlayInset')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="drawerbank-thickness">{t('dialog.drawerBank.thickness')}</label>
          <input
            id="drawerbank-thickness"
            aria-label={t('dialog.drawerBank.thickness')}
            style={fieldStyle}
            type="number"
            value={thicknessStr}
            onChange={(e) => setThicknessStr(e.target.value)}
          />
        </div>

        {countValid && openH != null && (
          <>
            <div style={sectionStyle}>{t('dialog.drawerBank.heights')}</div>
            {heightStrs.map((hStr, i) => (
              <div key={i} style={rowStyle}>
                <label htmlFor={`drawerbank-height-${i}`}>{t('dialog.drawerBank.heightN', { n: i + 1 })}</label>
                <input
                  id={`drawerbank-height-${i}`}
                  aria-label={t('dialog.drawerBank.heightN', { n: i + 1 })}
                  style={fieldStyle}
                  type="number"
                  value={hStr}
                  onChange={(e) => {
                    const next = [...heightStrs];
                    next[i] = e.target.value;
                    setHeightStrs(next);
                  }}
                />
              </div>
            ))}
            <div style={helperStyle}>{t('dialog.drawerBank.remaining', { mm: Math.round(remaining) })}</div>
          </>
        )}

        {error && (
          <div style={errorStyle} role="alert">{error}</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={() => { void handleOk(); }} disabled={!countValid || !heightsValid}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
