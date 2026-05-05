import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { CreateDrawingCommand } from '../commands/CreateDrawingCommand';
import type { SheetSize } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 400, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 };
const labelStyle: React.CSSProperties = { width: 100, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type SizeOption = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'custom';

export function NewDrawingDialog(): JSX.Element | null {
  const open = useAppStore((s) => (s as any).newDrawingDialogOpen as boolean);
  const sourcePath = useAppStore((s) => (s as any).newDrawingSourcePath as string | null);
  const sourceKind = useAppStore((s) => (s as any).newDrawingSourceKind as 'part' | 'assembly' | null);
  const bus = useAppStore((s) => s.bus);
  const setState = useAppStore.setState;

  const [sizeOption, setSizeOption] = React.useState<SizeOption>('A3');
  const [orientation, setOrientation] = React.useState<'landscape' | 'portrait'>('landscape');
  const [widthStr, setWidthStr] = React.useState('420');
  const [heightStr, setHeightStr] = React.useState('297');

  if (!open) return null;

  const close = () => setState({ newDrawingDialogOpen: false } as any);

  const buildSheetSize = (): SheetSize => {
    if (sizeOption === 'custom') {
      return { kind: 'custom', widthMm: Number(widthStr), heightMm: Number(heightStr) };
    }
    return { kind: 'iso', size: sizeOption };
  };

  // canOk is derived from reactive selectors — always up-to-date at render time
  const canOk = !!sourcePath && !!sourceKind;

  const handleOk = async (): Promise<void> => {
    // Re-read from store at click time to capture any updates injected after render
    const s = useAppStore.getState();
    const currentPath = s.newDrawingSourcePath;
    const currentKind = s.newDrawingSourceKind;
    if (!currentPath || !currentKind) return;
    await bus.execute(new CreateDrawingCommand({
      sourcePath: currentPath,
      sourceKind: currentKind,
      sheetSize: buildSheetSize(),
      orientation,
    }));
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
        aria-label="New Drawing"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 12 }}>New Drawing</div>

        {/* Source (OPFS picker — disabled in jsdom; path injected via store slot) */}
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nd-source">Source file</label>
          <span style={{ ...inputStyle, color: sourcePath ? '#eee' : '#888', flex: 1 }}>
            {sourcePath ?? '(none selected)'}
          </span>
          <button
            style={btnStyle}
            onClick={async () => {
              // OPFS showOpenFilePicker — only available in real browser context
              if (typeof (window as any).showOpenFilePicker !== 'function') return;
              try {
                const [handle] = await (window as any).showOpenFilePicker({
                  types: [{ description: 'ZilInventor files', accept: { 'application/octet-stream': ['.zipt', '.ziasm'] } }],
                  multiple: false,
                });
                const kind = (handle.name as string).endsWith('.ziasm') ? 'assembly' : 'part';
                setState({ newDrawingSourcePath: handle.name, newDrawingSourceKind: kind } as any);
              } catch {
                // user cancelled picker
              }
            }}
          >
            Browse…
          </button>
        </div>

        {/* Sheet size */}
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="nd-size">Sheet size</label>
          <select
            id="nd-size"
            aria-label="Sheet size"
            style={inputStyle}
            value={sizeOption}
            onChange={(e) => setSizeOption(e.target.value as SizeOption)}
          >
            <option value="A0">A0</option>
            <option value="A1">A1</option>
            <option value="A2">A2</option>
            <option value="A3">A3</option>
            <option value="A4">A4</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {sizeOption === 'custom' && (
          <>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="nd-width">Width (mm)</label>
              <input
                id="nd-width"
                aria-label="Width (mm)"
                type="number"
                style={inputStyle}
                value={widthStr}
                onChange={(e) => setWidthStr(e.target.value)}
              />
            </div>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor="nd-height">Height (mm)</label>
              <input
                id="nd-height"
                aria-label="Height (mm)"
                type="number"
                style={inputStyle}
                value={heightStr}
                onChange={(e) => setHeightStr(e.target.value)}
              />
            </div>
          </>
        )}

        {/* Orientation */}
        <div style={{ ...fieldRow, gap: 12 }}>
          <span style={labelStyle}>Orientation</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="radio"
              name="nd-orient"
              value="landscape"
              checked={orientation === 'landscape'}
              onChange={() => setOrientation('landscape')}
            />
            Landscape
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="radio"
              name="nd-orient"
              value="portrait"
              checked={orientation === 'portrait'}
              onChange={() => setOrientation('portrait')}
            />
            Portrait
          </label>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button
            style={okBtnStyle}
            disabled={!canOk}
            aria-disabled={!canOk}
            onClick={() => { void handleOk(); }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
