import { useState } from 'react';

type Mode = 'mate' | 'flush' | 'angle' | 'insert';
type PickedRefDescription = { label: string };

type Props = {
  mode: Mode;
  pickedRefA: PickedRefDescription | null;
  pickedRefB: PickedRefDescription | null;
  valueExpression: string;
  onPick: (slot: 'A' | 'B') => void;
  onValueChange: (expression: string) => void;
  onCommit: () => void;
  onApply: () => void;
  onCancel: () => void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 380,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const row: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6,
};

export function PlaceConstraintDialog(p: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(p.mode);
  const valueLabel = mode === 'angle' ? 'Angle:' : 'Offset:';
  const valueUnit = mode === 'angle' ? '°' : 'mm';
  const okEnabled = p.pickedRefA !== null && p.pickedRefB !== null;

  return (
    <div role="dialog" aria-label="Place Constraint" style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Place Constraint</div>
      <div style={row}>
        <span style={{ width: 60 }}>Type:</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={btn}>
          <option value="mate">Mate</option>
          <option value="flush">Flush</option>
          <option value="angle">Angle</option>
          <option value="insert">Insert</option>
        </select>
      </div>
      <div style={row}>
        <span style={{ width: 80 }}>Selection 1:</span>
        <button style={btn} onClick={() => p.onPick('A')}>Pick…</button>
        <span style={{ marginLeft: 6, color: '#aaa' }}>{p.pickedRefA?.label ?? '(none)'}</span>
      </div>
      <div style={row}>
        <span style={{ width: 80 }}>Selection 2:</span>
        <button style={btn} onClick={() => p.onPick('B')}>Pick…</button>
        <span style={{ marginLeft: 6, color: '#aaa' }}>{p.pickedRefB?.label ?? '(none)'}</span>
      </div>
      <div style={row}>
        <span style={{ width: 60 }}>{valueLabel}</span>
        <input value={p.valueExpression} onChange={(e) => p.onValueChange(e.target.value)} style={{ ...btn, width: 80 }} />
        <span>{valueUnit}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <button onClick={p.onApply} disabled={!okEnabled} style={btn}>Apply</button>
        <button onClick={p.onCancel} style={btn}>Cancel</button>
        <button onClick={p.onCommit} disabled={!okEnabled} style={btn}>OK</button>
      </div>
    </div>
  );
}
