import { useState, type FormEvent } from 'react';
import type { FaceName } from '@zilventor/shared';

export type ShellDialogValue = {
  thickness: string;
  facesToRemove: FaceName[];
};

type Props = {
  availableFaces: FaceName[];
  selectedFaces: FaceName[];
  previewError: string | null;
  initialThickness?: string | undefined;
  onCommit(v: ShellDialogValue): void;
  onCancel(): void;
  onToggleFace(face: FaceName): void;
  onThicknessChange(expression: string): void;
  validateExpression?(expression: string): string | null;
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

const sectionLabelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
};

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

function faceKey(f: FaceName): string {
  return `${f.featureId}|${f.role}|${f.instance ?? 0}`;
}

function faceLabel(f: FaceName): string {
  const suffix = f.instance != null ? String(f.instance) : '';
  return `${f.featureId}/${f.role}${suffix}`;
}

export function ShellDialog({
  availableFaces,
  selectedFaces,
  previewError,
  initialThickness,
  onCommit,
  onCancel,
  onToggleFace,
  onThicknessChange,
  validateExpression,
}: Props): JSX.Element {
  const [thickness, setThickness] = useState(initialThickness ?? '-1');

  const exprError = validateExpression ? validateExpression(thickness) : null;
  const canCommit = selectedFaces.length > 0 && exprError === null;

  const selectedKeys = new Set(selectedFaces.map(faceKey));

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit({ thickness, facesToRemove: selectedFaces });
  };

  const handleThicknessChange = (v: string): void => {
    setThickness(v);
    onThicknessChange(v);
  };

  return (
    <form
      role="dialog"
      aria-label="Shell"
      onSubmit={handleSubmit}
      style={panelStyle}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Shell</div>

      <div style={{ marginBottom: 10 }}>
        <span style={sectionLabelStyle}>Faces to remove ({selectedFaces.length})</span>
        {availableFaces.length === 0 ? (
          <div style={{ color: '#888', fontStyle: 'italic' }}>
            No body in the tree. Add an extrude / revolve first.
          </div>
        ) : (
          <ul
            data-testid="shell-face-list"
            style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflowY: 'auto' }}
          >
            {availableFaces.map((f) => {
              const k = faceKey(f);
              const on = selectedKeys.has(k);
              return (
                <li key={k} style={{ padding: '2px 0' }}>
                  <label style={{ cursor: 'pointer', display: 'flex', gap: 6 }}>
                    <input
                      type="checkbox"
                      data-face-key={k}
                      checked={on}
                      onChange={() => onToggleFace(f)}
                    />
                    <span>{faceLabel(f)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div style={rowStyle}>
        <label style={{ minWidth: 70 }}>Thickness</label>
        <input
          aria-label="Thickness"
          value={thickness}
          onChange={(e) => handleThicknessChange(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>
        Negative = hollow inward (cup). Positive = grow outward.
      </div>
      {exprError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{exprError}</div>}
      {previewError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{previewError}</div>}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
        <button type="submit" disabled={!canCommit} style={btnStyle}>OK</button>
      </div>
    </form>
  );
}
