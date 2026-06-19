import React from 'react';
import { useTranslation } from 'react-i18next';
import { hingeCountForHeight } from '@zilventor/shared';
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

export function AddDoorDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.addDoorDialog);
  const setDialog = useAppStore((s) => s.setAddDoorDialog);

  const [count, setCount] = React.useState<'single' | 'double'>('single');
  const [hingeSide, setHingeSide] = React.useState<'left' | 'right'>('left');
  const [overlay, setOverlay] = React.useState<'full' | 'half' | 'inset'>('full');
  const [style, setStyle] = React.useState<'slab' | 'shaker' | 'raisedPanel'>('slab');
  const [frameWidth, setFrameWidth] = React.useState('70');
  const [thickness, setThickness] = React.useState('18');
  const [reveal, setReveal] = React.useState('2');
  const [clearance, setClearance] = React.useState('2');
  const [centerReveal, setCenterReveal] = React.useState('3');

  const [error, setError] = React.useState<string | null>(null);

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setCount('single');
      setHingeSide('left');
      setOverlay('full');
      setStyle('slab');
      setFrameWidth('70');
      setThickness('18');
      setReveal('2');
      setClearance('2');
      setCenterReveal('3');
      setError(null);
    }
  }, [dialog]);

  if (!dialog) return null;

  // Read-only hinge-count hint at a nominal door height (informational only;
  // the real count is resolved by AddDoorCommand from the computed doorH).
  const hingeHint = hingeCountForHeight(720);

  const handleOk = async (): Promise<void> => {
    setError(null);
    try {
      await dialog.onSubmit({
        count,
        overlay,
        hingeSide,
        thickness: Number(thickness),
        reveal: Number(reveal),
        clearance: Number(clearance),
        centerReveal: Number(centerReveal),
        style,
        frameWidth: Number(frameWidth),
      });
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
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
        aria-label={t('aria.add_door_dialog')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.addDoor.title')}</div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-count">{t('dialog.addDoor.count')}</label>
          <select
            id="adddoor-count"
            aria-label={t('dialog.addDoor.count')}
            style={fieldStyle}
            value={count}
            onChange={(e) => setCount(e.target.value as 'single' | 'double')}
          >
            <option value="single">{t('dialog.addDoor.countSingle')}</option>
            <option value="double">{t('dialog.addDoor.countDouble')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-hingeside">{t('dialog.addDoor.hingeSide')}</label>
          <select
            id="adddoor-hingeside"
            aria-label={t('dialog.addDoor.hingeSide')}
            style={fieldStyle}
            value={hingeSide}
            disabled={count === 'double'}
            onChange={(e) => setHingeSide(e.target.value as 'left' | 'right')}
          >
            <option value="left">{t('dialog.addDoor.hingeLeft')}</option>
            <option value="right">{t('dialog.addDoor.hingeRight')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-overlay">{t('dialog.addDoor.overlay')}</label>
          <select
            id="adddoor-overlay"
            aria-label={t('dialog.addDoor.overlay')}
            style={fieldStyle}
            value={overlay}
            onChange={(e) => setOverlay(e.target.value as 'full' | 'half' | 'inset')}
          >
            <option value="full">{t('dialog.addDoor.overlayFull')}</option>
            <option value="half">{t('dialog.addDoor.overlayHalf')}</option>
            <option value="inset">{t('dialog.addDoor.overlayInset')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-style">{t('dialog.addDoor.style')}</label>
          <select
            id="adddoor-style"
            aria-label={t('dialog.addDoor.style')}
            style={fieldStyle}
            value={style}
            onChange={(e) => setStyle(e.target.value as 'slab' | 'shaker' | 'raisedPanel')}
          >
            <option value="slab">{t('dialog.addDoor.styleSlab')}</option>
            <option value="shaker">{t('dialog.addDoor.styleShaker')}</option>
            <option value="raisedPanel">{t('dialog.addDoor.styleRaisedPanel')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-framewidth">{t('dialog.addDoor.frameWidth')}</label>
          <input
            id="adddoor-framewidth"
            aria-label={t('dialog.addDoor.frameWidth')}
            style={fieldStyle}
            type="number"
            value={frameWidth}
            disabled={style === 'slab'}
            onChange={(e) => setFrameWidth(e.target.value)}
          />
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-thickness">{t('dialog.addDoor.thickness')}</label>
          <input
            id="adddoor-thickness"
            aria-label={t('dialog.addDoor.thickness')}
            style={fieldStyle}
            type="number"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
          />
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-reveal">{t('dialog.addDoor.reveal')}</label>
          <input
            id="adddoor-reveal"
            aria-label={t('dialog.addDoor.reveal')}
            style={fieldStyle}
            type="number"
            value={reveal}
            onChange={(e) => setReveal(e.target.value)}
          />
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-clearance">{t('dialog.addDoor.clearance')}</label>
          <input
            id="adddoor-clearance"
            aria-label={t('dialog.addDoor.clearance')}
            style={fieldStyle}
            type="number"
            value={clearance}
            onChange={(e) => setClearance(e.target.value)}
          />
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-centerreveal">{t('dialog.addDoor.centerReveal')}</label>
          <input
            id="adddoor-centerreveal"
            aria-label={t('dialog.addDoor.centerReveal')}
            style={fieldStyle}
            type="number"
            value={centerReveal}
            disabled={count === 'single'}
            onChange={(e) => setCenterReveal(e.target.value)}
          />
        </div>

        <div style={rowStyle}>
          <span>{t('dialog.addDoor.hingeCount')}</span>
          <span aria-label={t('dialog.addDoor.hingeCount')}>{hingeHint}</span>
        </div>

        {error && (
          <div style={errorStyle} role="alert">{error}</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={() => { void handleOk(); }}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
