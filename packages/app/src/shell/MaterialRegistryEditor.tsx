import React from 'react';
import type { MaterialEntry } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { AddMaterialCommand } from '../commands/AddMaterialCommand';
import { EditMaterialCommand, type EditMaterialPatch } from '../commands/EditMaterialCommand';
import { DeleteMaterialCommand } from '../commands/DeleteMaterialCommand';

/**
 * MaterialRegistryEditor (T23) — small flat editor over the active document's
 * material registry. Reads from `activeAssembly.materials` if an assembly is
 * active, else from `activePart.materials`. Mutations go through
 * Add/Edit/DeleteMaterialCommand on the bus so undo/redo works.
 *
 * Layout:
 *   table[ Name | Default Thickness (mm) | Color | Actions ]
 *   + Add button -> inline add form
 *   row hover -> Edit / Delete buttons
 *   Edit -> inline row form
 *   Delete -> inline confirm; surfaces MATERIAL_IN_USE on conflict.
 */

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
  color: '#eee',
};

const cellStyle: React.CSSProperties = {
  borderBottom: '1px solid #333',
  padding: '4px 6px',
  verticalAlign: 'middle',
};

const inputStyle: React.CSSProperties = {
  background: '#222',
  border: '1px solid #444',
  color: '#eee',
  padding: '3px 6px',
  fontSize: 11,
  width: '100%',
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
};

const okBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#3b5a8a',
  borderColor: '#6a8ec4',
};

const dangerBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#5a2a2a',
  borderColor: '#a05050',
};

const errorStyle: React.CSSProperties = {
  color: '#ffb3b3',
  background: '#3a1a1a',
  border: '1px solid #6a3333',
  padding: '4px 8px',
  fontSize: 11,
  marginTop: 6,
  borderRadius: 4,
};

function validateSheetStock(lStr: string, wStr: string): string | null {
  const lEmpty = lStr.trim() === '';
  const wEmpty = wStr.trim() === '';
  if (lEmpty && wEmpty) return null;
  if (lEmpty || wEmpty) return 'Set both Sheet L and Sheet W, or leave both empty.';
  const ln = Number(lStr), wn = Number(wStr);
  if (!Number.isFinite(ln) || ln <= 0 || !Number.isFinite(wn) || wn <= 0) return 'Sheet dims must be positive numbers.';
  return null;
}

function validateHatchPattern(angleStr: string, spacingStr: string): string | null {
  const aEmpty = angleStr.trim() === '';
  const sEmpty = spacingStr.trim() === '';
  if (aEmpty && sEmpty) return null;
  if (aEmpty || sEmpty) return 'Set both Hatch angle and Hatch spacing, or leave both empty.';
  const a = Number(angleStr), s = Number(spacingStr);
  if (!Number.isFinite(a) || !Number.isFinite(s)) return 'Hatch angle/spacing must be numbers.';
  if (a < 0 || a >= 180) return 'Hatch angle must be in [0, 180).';
  if (s <= 0) return 'Hatch spacing must be > 0.';
  return null;
}

type RowEditState =
  | { mode: 'idle' }
  | { mode: 'edit'; id: string; name: string; defaultThickness: string; color: string; sheetLengthMm: string; sheetWidthMm: string; hatchAngleDeg: string; hatchSpacingMm: string; error: string | null }
  | { mode: 'confirmDelete'; id: string; error: string | null };

export type MaterialRegistryEditorProps = {
  /** Optional className for the outer container. */
  className?: string;
};

export function MaterialRegistryEditor(_props: MaterialRegistryEditorProps = {}): JSX.Element {
  const bus = useAppStore((s) => s.bus);
  const activePart = useAppStore((s) => s.activePart);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const materials: readonly MaterialEntry[] = activeAssembly
    ? activeAssembly.materials
    : (activePart?.materials ?? []);

  const [rowState, setRowState] = React.useState<RowEditState>({ mode: 'idle' });
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  // Add form
  const [addOpen, setAddOpen] = React.useState(false);
  const [addName, setAddName] = React.useState('');
  const [addThickness, setAddThickness] = React.useState('18');
  const [addColor, setAddColor] = React.useState('#cccccc');
  const [addError, setAddError] = React.useState<string | null>(null);

  const resetAdd = () => {
    setAddOpen(false);
    setAddName('');
    setAddThickness('18');
    setAddColor('#cccccc');
    setAddError(null);
  };

  const onAddSubmit = async () => {
    setAddError(null);
    const name = addName.trim();
    if (!name) {
      setAddError('Name is required');
      return;
    }
    const thicknessNum = Number(addThickness);
    if (!Number.isFinite(thicknessNum) || thicknessNum <= 0) {
      setAddError('Default thickness must be a positive number');
      return;
    }
    try {
      await bus.execute(new AddMaterialCommand({ name, defaultThickness: thicknessNum, color: addColor }));
      resetAdd();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('DUPLICATE_NAME')) {
        setAddError(`A material named "${name}" already exists`);
      } else {
        setAddError(msg);
      }
    }
  };

  const onEditSubmit = async () => {
    if (rowState.mode !== 'edit') return;
    const name = rowState.name.trim();
    if (!name) {
      setRowState({ ...rowState, error: 'Name is required' });
      return;
    }
    const thicknessNum = Number(rowState.defaultThickness);
    if (!Number.isFinite(thicknessNum) || thicknessNum <= 0) {
      setRowState({ ...rowState, error: 'Default thickness must be a positive number' });
      return;
    }
    const sheetErr = validateSheetStock(rowState.sheetLengthMm, rowState.sheetWidthMm);
    if (sheetErr) {
      setRowState({ ...rowState, error: sheetErr });
      return;
    }
    const hatchErr = validateHatchPattern(rowState.hatchAngleDeg, rowState.hatchSpacingMm);
    if (hatchErr) {
      setRowState({ ...rowState, error: hatchErr });
      return;
    }
    const lEmpty = rowState.sheetLengthMm.trim() === '';
    const wEmpty = rowState.sheetWidthMm.trim() === '';
    const hAEmpty = rowState.hatchAngleDeg.trim() === '';
    const hSEmpty = rowState.hatchSpacingMm.trim() === '';

    const sheetPart: Partial<EditMaterialPatch> = (!lEmpty && !wEmpty)
      ? { sheetLengthMm: Number(rowState.sheetLengthMm), sheetWidthMm: Number(rowState.sheetWidthMm) }
      : { clearSheetStock: true };
    const hatchPart: Partial<EditMaterialPatch> = (!hAEmpty && !hSEmpty)
      ? { hatchAngleDeg: Number(rowState.hatchAngleDeg), hatchSpacingMm: Number(rowState.hatchSpacingMm) }
      : { clearHatch: true };

    const patch: EditMaterialPatch = {
      name,
      defaultThickness: thicknessNum,
      color: rowState.color,
      ...sheetPart,
      ...hatchPart,
    };
    try {
      await bus.execute(new EditMaterialCommand(rowState.id, patch));
      setRowState({ mode: 'idle' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('DUPLICATE_NAME')) {
        setRowState({ ...rowState, error: `A material named "${name}" already exists` });
      } else {
        setRowState({ ...rowState, error: msg });
      }
    }
  };

  const onDeleteConfirm = async () => {
    if (rowState.mode !== 'confirmDelete') return;
    try {
      await bus.execute(new DeleteMaterialCommand(rowState.id));
      setRowState({ mode: 'idle' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRowState({ ...rowState, error: msg });
    }
  };

  return (
    <div data-testid="material-registry-editor">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Name</th>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Default Thickness (mm)</th>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Color</th>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Sheet L (mm)</th>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Sheet W (mm)</th>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Hatch angle (°)</th>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Hatch spacing (mm)</th>
            <th style={{ ...cellStyle, width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => {
            const isEditing = rowState.mode === 'edit' && rowState.id === m.id;
            const isConfirmingDelete = rowState.mode === 'confirmDelete' && rowState.id === m.id;
            const showActions = hoveredId === m.id && rowState.mode === 'idle';

            if (isEditing && rowState.mode === 'edit') {
              return (
                <tr key={m.id} data-testid={`material-row-${m.id}`}>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit name"
                      type="text"
                      value={rowState.name}
                      onChange={(e) => setRowState({ ...rowState, name: e.target.value, error: null })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit default thickness"
                      type="text"
                      value={rowState.defaultThickness}
                      onChange={(e) => setRowState({ ...rowState, defaultThickness: e.target.value, error: null })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit color"
                      type="color"
                      value={rowState.color}
                      onChange={(e) => setRowState({ ...rowState, color: e.target.value })}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit sheet length"
                      type="text"
                      inputMode="numeric"
                      value={rowState.sheetLengthMm}
                      onChange={(e) => setRowState({
                        ...rowState, sheetLengthMm: e.target.value,
                        error: validateSheetStock(e.target.value, rowState.sheetWidthMm)
                            ?? validateHatchPattern(rowState.hatchAngleDeg, rowState.hatchSpacingMm),
                      })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit sheet width"
                      type="text"
                      inputMode="numeric"
                      value={rowState.sheetWidthMm}
                      onChange={(e) => setRowState({
                        ...rowState, sheetWidthMm: e.target.value,
                        error: validateSheetStock(rowState.sheetLengthMm, e.target.value)
                            ?? validateHatchPattern(rowState.hatchAngleDeg, rowState.hatchSpacingMm),
                      })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit hatch angle"
                      type="text"
                      inputMode="numeric"
                      value={rowState.hatchAngleDeg}
                      onChange={(e) => setRowState({
                        ...rowState, hatchAngleDeg: e.target.value,
                        error: validateSheetStock(rowState.sheetLengthMm, rowState.sheetWidthMm)
                            ?? validateHatchPattern(e.target.value, rowState.hatchSpacingMm),
                      })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit hatch spacing"
                      type="text"
                      inputMode="numeric"
                      value={rowState.hatchSpacingMm}
                      onChange={(e) => setRowState({
                        ...rowState, hatchSpacingMm: e.target.value,
                        error: validateSheetStock(rowState.sheetLengthMm, rowState.sheetWidthMm)
                            ?? validateHatchPattern(rowState.hatchAngleDeg, e.target.value),
                      })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" style={okBtnStyle} onClick={onEditSubmit} disabled={rowState.error !== null}>Save</button>
                      <button type="button" style={btnStyle} onClick={() => setRowState({ mode: 'idle' })}>Cancel</button>
                    </div>
                    {rowState.error && <div role="alert" style={errorStyle}>{rowState.error}</div>}
                  </td>
                </tr>
              );
            }

            if (isConfirmingDelete && rowState.mode === 'confirmDelete') {
              return (
                <tr key={m.id} data-testid={`material-row-${m.id}`}>
                  <td colSpan={8} style={cellStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>Delete "{m.name}"?</span>
                      <button type="button" style={dangerBtnStyle} onClick={onDeleteConfirm}>Confirm delete</button>
                      <button type="button" style={btnStyle} onClick={() => setRowState({ mode: 'idle' })}>Cancel</button>
                    </div>
                    {rowState.error && (
                      <div role="alert" style={errorStyle}>
                        {rowState.error}
                      </div>
                    )}
                  </td>
                </tr>
              );
            }

            return (
              <tr
                key={m.id}
                data-testid={`material-row-${m.id}`}
                onMouseEnter={() => setHoveredId(m.id)}
                onMouseLeave={() => setHoveredId((cur) => (cur === m.id ? null : cur))}
              >
                <td style={cellStyle}>{m.name}</td>
                <td style={cellStyle}>{m.defaultThickness}</td>
                <td style={cellStyle}>
                  <span
                    aria-label={`Color ${m.color}`}
                    style={{
                      display: 'inline-block',
                      width: 16,
                      height: 16,
                      background: m.color,
                      border: '1px solid #555',
                      verticalAlign: 'middle',
                    }}
                  />
                  <span style={{ marginLeft: 6, fontFamily: 'monospace' }}>{m.color}</span>
                </td>
                <td style={cellStyle}>{m.sheetLengthMm ?? ''}</td>
                <td style={cellStyle}>{m.sheetWidthMm ?? ''}</td>
                <td style={cellStyle}>{m.hatchAngleDeg ?? ''}</td>
                <td style={cellStyle}>{m.hatchSpacingMm ?? ''}</td>
                <td style={cellStyle}>
                  {(showActions || hoveredId === m.id) && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        style={btnStyle}
                        aria-label={`Edit ${m.name}`}
                        onClick={() => setRowState({
                          mode: 'edit',
                          id: m.id,
                          name: m.name,
                          defaultThickness: String(m.defaultThickness),
                          color: m.color,
                          sheetLengthMm: m.sheetLengthMm !== undefined ? String(m.sheetLengthMm) : '',
                          sheetWidthMm: m.sheetWidthMm !== undefined ? String(m.sheetWidthMm) : '',
                          hatchAngleDeg: m.hatchAngleDeg !== undefined ? String(m.hatchAngleDeg) : '',
                          hatchSpacingMm: m.hatchSpacingMm !== undefined ? String(m.hatchSpacingMm) : '',
                          error: null,
                        })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        style={dangerBtnStyle}
                        aria-label={`Delete ${m.name}`}
                        onClick={() => setRowState({ mode: 'confirmDelete', id: m.id, error: null })}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {materials.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...cellStyle, color: '#888', fontStyle: 'italic' }}>
                No materials defined.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 8 }}>
        {!addOpen ? (
          <button type="button" style={btnStyle} onClick={() => setAddOpen(true)}>
            + Add
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 4, padding: 6, border: '1px solid #333', borderRadius: 4 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 80, fontSize: 11 }}>Name</span>
              <input
                aria-label="New material name"
                type="text"
                value={addName}
                onChange={(e) => { setAddName(e.target.value); setAddError(null); }}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 80, fontSize: 11 }}>Thickness</span>
              <input
                aria-label="New material default thickness"
                type="text"
                value={addThickness}
                onChange={(e) => { setAddThickness(e.target.value); setAddError(null); }}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 80, fontSize: 11 }}>Color</span>
              <input
                aria-label="New material color"
                type="color"
                value={addColor}
                onChange={(e) => setAddColor(e.target.value)}
              />
            </div>
            {addError && <div role="alert" style={errorStyle}>{addError}</div>}
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" style={btnStyle} onClick={resetAdd}>Cancel</button>
              <button type="button" style={okBtnStyle} onClick={onAddSubmit}>Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
