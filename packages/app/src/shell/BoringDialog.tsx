import React from 'react';
import { useAppStore } from '../store/useAppStore';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 280, color: '#eee', fontSize: 12,
};
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 };
const errStyle: React.CSSProperties = { color: '#ffb3b3', fontSize: 10, marginBottom: 8 };
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function BoringDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.boringDialog);
  const setDialog = useAppStore((s) => s.setBoringDialog);

  const [confirmat, setConfirmat] = React.useState(true);
  const [minifix, setMinifix] = React.useState(false);
  const [dowel, setDowel] = React.useState(false);

  // Reset defaults each time dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setConfirmat(true);
      setMinifix(false);
      setDowel(false);
    }
  }, [dialog]);

  if (!dialog) return null;

  const valid = confirmat || minifix || dowel;

  const handleOk = (): void => {
    if (!valid) return;
    dialog.onSubmit({ confirmat, minifix, dowel });
    setDialog(null);
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
        aria-label="Boring dialog"
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Connector Type</div>

        <div style={rowStyle}>
          <input
            id="boring-confirmat"
            type="checkbox"
            checked={confirmat}
            onChange={(e) => setConfirmat(e.target.checked)}
          />
          <label htmlFor="boring-confirmat">Confirmat</label>
        </div>
        <div style={rowStyle}>
          <input
            id="boring-minifix"
            type="checkbox"
            checked={minifix}
            onChange={(e) => setMinifix(e.target.checked)}
          />
          <label htmlFor="boring-minifix">Minifix</label>
        </div>
        <div style={rowStyle}>
          <input
            id="boring-dowel"
            type="checkbox"
            checked={dowel}
            onChange={(e) => setDowel(e.target.checked)}
          />
          <label htmlFor="boring-dowel">Dowel</label>
        </div>

        {!valid && (
          <div role="alert" style={errStyle}>Select at least one connector type.</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>Cancel</button>
          <button
            style={okBtnStyle}
            onClick={handleOk}
            disabled={!valid}
            aria-disabled={!valid ? 'true' : undefined}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
