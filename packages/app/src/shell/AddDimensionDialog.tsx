import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddDrawingDimensionCommand } from '../commands/AddDrawingDimensionCommand';
import type { DrawingDimension } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 300, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 };
const labelStyle: React.CSSProperties = { width: 110, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type DialogState = { sheetId: string; dim: DrawingDimension; computedValue: number };

export function AddDimensionDialog(): JSX.Element | null {
  const state = useAppStore((s) => (s as any).addDimensionDialogState as DialogState | null);
  const bus = useAppStore((s) => s.bus);
  const [decimalPlaces, setDecimalPlaces] = React.useState('2');

  if (!state) return null;

  const close = () => useAppStore.setState({ addDimensionDialogState: null } as any);

  const handleOk = async (): Promise<void> => {
    await bus.execute(new AddDrawingDimensionCommand({ sheetId: state.sheetId, dim: state.dim }));
    close();
  };

  const formatted = state.computedValue.toFixed(Number(decimalPlaces));

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={panelStyle} role="dialog" aria-label="Dimension"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }} tabIndex={-1}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>
          {state.dim.kind === 'radial' ? 'Radial Dimension' : 'Diametric Dimension'}
        </div>

        <div style={{ marginBottom: 10, fontSize: 13, color: '#cce' }}>
          Value: <strong>{formatted}</strong> mm
        </div>

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="dim-dp">Decimal places</label>
          <select
            id="dim-dp"
            aria-label="Decimal places"
            style={inputStyle}
            value={decimalPlaces}
            onChange={(e) => setDecimalPlaces(e.target.value)}
          >
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button style={okBtnStyle} onClick={() => { void handleOk(); }}>OK</button>
        </div>
      </div>
    </div>
  );
}
