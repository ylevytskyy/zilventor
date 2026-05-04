import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { GenerateNestCommand } from '../commands/GenerateNestCommand';
import { useCutListResult } from './useCutListResult';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 360, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const labelStyle: React.CSSProperties = { width: 80, fontSize: 11 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const errStyle: React.CSSProperties = { color: '#ffb3b3', fontSize: 10, marginBottom: 4 };
const summaryStyle: React.CSSProperties = { fontSize: 11, color: '#aaa', marginBottom: 12 };
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function NestDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.nestDialog);
  const setDialog = useAppStore((s) => s.setNestDialog);
  const bus = useAppStore((s) => s.bus);
  const materials = useAppStore((s) => s.activeAssembly?.materials ?? []);
  const cutListResult = useCutListResult();
  const [kerfStr, setKerfStr] = React.useState('3');

  if (!dialog) return null;

  const kerf = Number(kerfStr);
  const validKerf = kerfStr.trim() !== '' && Number.isFinite(kerf) && kerf > 0;

  const panelCount = cutListResult.rows.reduce((sum, r) => sum + r.qty, 0);
  const materialIdsWithRows = new Set(cutListResult.rows.map((r) => r.materialId));
  const materialsWithStock = materials.filter(
    (m) => materialIdsWithRows.has(m.id) && m.sheetLengthMm !== undefined && m.sheetWidthMm !== undefined,
  );
  const summary = `${panelCount} panels across ${materialsWithStock.length} materials will be nested`;

  const handleOk = async (): Promise<void> => {
    if (!validKerf) return;
    await bus.execute(new GenerateNestCommand({ kerfMm: kerf, result: cutListResult, materials }));
    setDialog(null);
  };

  const handleCancel = (): void => {
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
        aria-label="Nest dialog"
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Generate Nest</div>

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nest-kerf">Kerf (mm)</label>
          <input
            id="nest-kerf"
            aria-label="Kerf"
            type="text"
            inputMode="numeric"
            style={inputStyle}
            value={kerfStr}
            onChange={(e) => setKerfStr(e.target.value)}
          />
        </div>
        {!validKerf && (
          <div role="alert" style={errStyle}>Kerf must be a positive number.</div>
        )}

        <p style={summaryStyle}>{summary}</p>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button style={btnStyle} onClick={handleCancel}>Cancel</button>
          <button
            style={okBtnStyle}
            onClick={() => { void handleOk(); }}
            disabled={!validKerf}
            aria-disabled={!validKerf}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
