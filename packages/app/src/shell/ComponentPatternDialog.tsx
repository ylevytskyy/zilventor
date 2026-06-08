import { useState, type FormEvent } from 'react';
import type { PatternAxis } from '@zilventor/shared';

export type ComponentPatternDialogValue = {
  sourceComponentId: string;
  dir1: PatternAxis;
  count1: number;
  spacing1: number;
  dir2?: PatternAxis;
  count2?: number;
  spacing2?: number;
};

type ComponentSummary = {
  id: string;
  label: string;
};

type Props = {
  components: ComponentSummary[];
  onCommit(v: ComponentPatternDialogValue): void;
  onCancel(): void;
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  right: 20,
  background: '#1a1a1a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: 12,
  width: 360,
  color: '#eee',
  zIndex: 50,
  fontSize: 12,
};

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#222',
  color: '#eee',
  border: '1px solid #333',
  padding: '4px 6px',
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 10px',
  cursor: 'pointer',
};

export function ComponentPatternDialog({ components, onCommit, onCancel }: Props): JSX.Element {
  const [sourceComponentId, setSourceComponentId] = useState(components[0]?.id ?? '');
  const [dir1, setDir1] = useState<PatternAxis>('x');
  const [count1Str, setCount1Str] = useState('3');
  const [spacing1, setSpacing1] = useState('10');

  const [dir2Enabled, setDir2Enabled] = useState(false);
  const [dir2, setDir2] = useState<PatternAxis>('y');
  const [count2Str, setCount2Str] = useState('2');
  const [spacing2, setSpacing2] = useState('10');

  const count1 = parseInt(count1Str, 10);
  const count1Valid = Number.isFinite(count1) && count1 >= 2 && count1 <= 200;

  const spacing1Val = parseFloat(spacing1);
  const spacing1Valid = Number.isFinite(spacing1Val) && spacing1Val !== 0;

  let dir2Valid = true;
  if (dir2Enabled) {
    const s2 = parseFloat(spacing2);
    const c2 = parseInt(count2Str, 10);
    dir2Valid =
      dir2 !== dir1 &&
      Number.isFinite(s2) && s2 !== 0 &&
      Number.isFinite(c2) && c2 >= 2 && c2 <= 200;
  }

  const canCommit = sourceComponentId !== '' && count1Valid && spacing1Valid && dir2Valid;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    const value: ComponentPatternDialogValue = {
      sourceComponentId,
      dir1,
      count1,
      spacing1: spacing1Val,
    };
    if (dir2Enabled) {
      value.dir2 = dir2;
      value.count2 = parseInt(count2Str, 10);
      value.spacing2 = parseFloat(spacing2);
    }
    onCommit(value);
  };

  return (
    <form role="dialog" aria-label="Component Pattern" onSubmit={handleSubmit} style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Rectangular Pattern</div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-source">Source</label>
        <select
          id="cpd-source"
          aria-label="Source component"
          value={sourceComponentId}
          onChange={(e) => setSourceComponentId(e.target.value)}
          style={inputStyle}
        >
          {components.length === 0 && <option value="">(no components)</option>}
          {components.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4 }}>Direction 1</div>

      <div style={rowStyle}>
        <span style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>Axis</span>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {(['x', 'y', 'z'] as PatternAxis[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setDir1(a)}
              style={{
                ...btnStyle,
                flex: 1,
                background: dir1 === a ? '#3b5a8a' : '#2a2a2a',
                borderColor: dir1 === a ? '#6a8ec4' : '#444',
              }}
            >
              {a.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-count1">Count 1</label>
        <input
          id="cpd-count1"
          aria-label="Count 1"
          type="number"
          min={2}
          max={200}
          value={count1Str}
          onChange={(e) => setCount1Str(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-spacing1">Spacing 1</label>
        <input
          id="cpd-spacing1"
          aria-label="Spacing 1"
          value={spacing1}
          onChange={(e) => setSpacing1(e.target.value)}
          style={inputStyle}
        />
        <span style={{ color: '#888' }}>mm</span>
      </div>

      {!count1Valid && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>Count 1 must be an integer 2–200.</div>
      )}
      {!spacing1Valid && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>Spacing 1 must be a non-zero number.</div>
      )}

      <div style={rowStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            aria-label="Second direction"
            checked={dir2Enabled}
            onChange={(e) => setDir2Enabled(e.target.checked)}
          />
          Second direction
        </label>
      </div>

      {dir2Enabled && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Direction 2</div>

          <div style={rowStyle}>
            <span style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }}>Axis</span>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              {(['x', 'y', 'z'] as PatternAxis[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setDir2(a)}
                  style={{
                    ...btnStyle,
                    flex: 1,
                    background: dir2 === a ? '#3b5a8a' : '#2a2a2a',
                    borderColor: dir2 === a ? '#6a8ec4' : '#444',
                  }}
                >
                  {a.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={rowStyle}>
            <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-count2">Count 2</label>
            <input
              id="cpd-count2"
              aria-label="Count 2"
              type="number"
              min={2}
              max={200}
              value={count2Str}
              onChange={(e) => setCount2Str(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={rowStyle}>
            <label style={{ ...labelStyle, marginBottom: 0, minWidth: 70 }} htmlFor="cpd-spacing2">Spacing 2</label>
            <input
              id="cpd-spacing2"
              aria-label="Spacing 2"
              value={spacing2}
              onChange={(e) => setSpacing2(e.target.value)}
              style={inputStyle}
            />
            <span style={{ color: '#888' }}>mm</span>
          </div>

          {dir2 === dir1 && (
            <div style={{ color: '#ff6b6b', marginBottom: 8 }}>Direction 2 must differ from Direction 1.</div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
        <button type="submit" disabled={!canCommit} style={btnStyle}>OK</button>
      </div>
    </form>
  );
}
