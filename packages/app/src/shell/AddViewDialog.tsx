import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToolModeStore } from '../drawing/toolMode';
import type { DrawingView } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 360, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 };
const labelStyle: React.CSSProperties = { width: 120, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type DialogState = { kind: 'base' } | { kind: 'projected' } | { kind: 'iso' };

export function AddViewDialog(): JSX.Element | null {
  const dialogState = useAppStore((s) => (s as any).addViewDialogState as DialogState | null);
  const activeDocument = useAppStore((s) => s.activeDocument);
  const setPendingViewParams = useToolModeStore((s) => s.setPendingViewParams);

  // Base view state
  const [baseOrientation, setBaseOrientation] = React.useState<string>('front');
  const [baseScaleN, setBaseScaleN] = React.useState('1');
  const [baseScaleD, setBaseScaleD] = React.useState('1');

  // Projected view state
  const [projBaseViewId, setProjBaseViewId] = React.useState<string>('');
  const [projDirection, setProjDirection] = React.useState<'top' | 'bottom' | 'left' | 'right'>('right');

  // Iso view state
  const [isoCorner, setIsoCorner] = React.useState<'NE' | 'NW' | 'SE' | 'SW'>('NE');
  const [isoScaleN, setIsoScaleN] = React.useState('1');
  const [isoScaleD, setIsoScaleD] = React.useState('1');

  if (!dialogState) return null;

  const activeSheet = activeDocument?.kind === 'drawing'
    ? activeDocument.document.sheets.find(
        (sh) => sh.id === activeDocument.document.activeSheetId,
      )
    : undefined;
  const baseViews: DrawingView[] = (activeSheet?.views ?? []).filter(
    (v): v is Extract<DrawingView, { kind: 'base' }> => v.kind === 'base',
  );

  const close = () => {
    useAppStore.setState({ addViewDialogState: null } as any);
  };

  const handleOk = (): void => {
    if (dialogState.kind === 'base') {
      setPendingViewParams({
        kind: 'base',
        orientation: baseOrientation as 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left',
        scale: { n: Number(baseScaleN), d: Number(baseScaleD) },
      });
    } else if (dialogState.kind === 'projected') {
      setPendingViewParams({
        kind: 'projected',
        baseViewId: projBaseViewId || (baseViews[0]?.id ?? ''),
        direction: projDirection,
      });
    } else {
      setPendingViewParams({
        kind: 'iso',
        corner: isoCorner,
        scale: { n: Number(isoScaleN), d: Number(isoScaleD) },
      });
    }
    close();
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        style={panelStyle}
        role="dialog"
        aria-label="Add View"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 12 }}>
          {dialogState.kind === 'base' ? 'Base View' :
           dialogState.kind === 'projected' ? 'Projected View' : 'Isometric View'}
        </div>

        {dialogState.kind === 'base' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-orientation">Orientation</label>
              <select
                id="av-orientation"
                aria-label="Orientation"
                style={inputStyle}
                value={baseOrientation}
                onChange={(e) => setBaseOrientation(e.target.value)}
              >
                <option value="front">Front</option>
                <option value="top">Top</option>
                <option value="right">Right</option>
                <option value="back">Back</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
              </select>
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-scale-n">Scale numerator</label>
              <input id="av-scale-n" aria-label="Scale numerator" type="number"
                style={inputStyle} value={baseScaleN}
                onChange={(e) => setBaseScaleN(e.target.value)} />
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-scale-d">Scale denominator</label>
              <input id="av-scale-d" aria-label="Scale denominator" type="number"
                style={inputStyle} value={baseScaleD}
                onChange={(e) => setBaseScaleD(e.target.value)} />
            </div>
          </>
        )}

        {dialogState.kind === 'projected' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-parent">Parent view</label>
              <select
                id="av-parent"
                aria-label="Parent view"
                style={inputStyle}
                value={projBaseViewId || baseViews[0]?.id}
                onChange={(e) => setProjBaseViewId(e.target.value)}
              >
                {baseViews.map((v) => (
                  <option key={v.id} value={v.id}>{v.id}</option>
                ))}
              </select>
            </div>
            <div style={{ ...fieldRow, gap: 12 }}>
              <span style={labelStyle}>Direction</span>
              {(['top', 'bottom', 'left', 'right'] as const).map((dir) => (
                <label key={dir} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                  <input
                    type="radio"
                    name="av-direction"
                    value={dir}
                    checked={projDirection === dir}
                    onChange={() => setProjDirection(dir)}
                  />
                  {dir.charAt(0).toUpperCase() + dir.slice(1)}
                </label>
              ))}
            </div>
          </>
        )}

        {dialogState.kind === 'iso' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-corner">Corner</label>
              <select
                id="av-corner"
                aria-label="Corner"
                style={inputStyle}
                value={isoCorner}
                onChange={(e) => setIsoCorner(e.target.value as 'NE' | 'NW' | 'SE' | 'SW')}
              >
                <option value="NE">NE</option>
                <option value="NW">NW</option>
                <option value="SE">SE</option>
                <option value="SW">SW</option>
              </select>
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-iso-scale-n">Scale numerator</label>
              <input id="av-iso-scale-n" aria-label="Scale numerator" type="number"
                style={inputStyle} value={isoScaleN}
                onChange={(e) => setIsoScaleN(e.target.value)} />
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="av-iso-scale-d">Scale denominator</label>
              <input id="av-iso-scale-d" aria-label="Scale denominator" type="number"
                style={inputStyle} value={isoScaleD}
                onChange={(e) => setIsoScaleD(e.target.value)} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button style={okBtnStyle} onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
