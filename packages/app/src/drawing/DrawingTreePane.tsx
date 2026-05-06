// packages/app/src/drawing/DrawingTreePane.tsx
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { SetActiveSheetCommand } from '../commands/SetActiveSheetCommand';
import { RenameSheetCommand } from '../commands/RenameSheetCommand';
import { DeleteSheetCommand } from '../commands/DeleteSheetCommand';
import type { DrawingSheet, DetailView } from '@zilventor/shared';

function parentViewLabel(view: DrawingSheet['views'][number]): string {
  switch (view.kind) {
    case 'base':      return `Base — ${view.orientation}`;
    case 'projected': return `Projected — ${view.direction}`;
    case 'iso':       return `Iso — ${view.corner}`;
    case 'section':   return `Section — ${view.label}`;
    case 'detail':    return `Detail — ${view.label}`;
  }
}

type ContextMenu = {
  kind: 'sheet';
  sheetId: string;
  x: number;
  y: number;
} | null;

function SheetNode({
  sheet,
  isActive,
  onSelect,
  onContextMenu,
}: {
  sheet: DrawingSheet;
  isActive: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dimCount = sheet.dimensions.length;
  const annCount = sheet.annotations.length;

  return (
    <li>
      <div
        role="treeitem"
        aria-selected={isActive}
        style={{ fontWeight: isActive ? 'bold' : 'normal', cursor: 'pointer', paddingLeft: 16 }}
        onClick={onSelect}
        onContextMenu={onContextMenu}
      >
        <span onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
          {expanded ? '▾' : '▸'}
        </span>
        {' '}{sheet.name}
      </div>
      {expanded && (
        <ul style={{ paddingLeft: 24, listStyle: 'none', margin: 0 }}>
          <li>
            <div style={{ paddingLeft: 16 }}>Views</div>
            <ul style={{ paddingLeft: 24, listStyle: 'none', margin: 0 }}>
              {sheet.views.map((v) => {
                let label: string;
                if (v.kind === 'base') {
                  label = `Base — ${v.orientation}`;
                } else if (v.kind === 'projected') {
                  label = `Projected — ${v.direction}`;
                } else if (v.kind === 'section') {
                  label = `Section — ${v.label}`;
                } else if (v.kind === 'detail') {
                  const parent = sheet.views.find((pv) => pv.id === (v as DetailView).parentViewId);
                  const fromLabel = parent ? parentViewLabel(parent) : 'unknown';
                  label = `Detail ${(v as DetailView).label} (from ${fromLabel})`;
                } else {
                  label = `Iso — ${v.corner}`;
                }

                // Append break-count suffix for breakable view kinds
                const breakCount =
                  (v.kind === 'base' || v.kind === 'projected' || v.kind === 'iso')
                    ? (v.breaks?.length ?? 0)
                    : 0;
                if (breakCount > 0) {
                  label = `${label} · [${breakCount} ${breakCount === 1 ? 'break' : 'breaks'}]`;
                }

                return (
                  <li key={v.id} style={{ fontSize: '0.8em', color: '#555' }}>
                    {label} · {v.scale.numerator}:{v.scale.denominator}
                  </li>
                );
              })}
            </ul>
          </li>
          <li style={{ paddingLeft: 16, fontSize: '0.8em', color: '#555' }}>
            Dimensions ({dimCount})
          </li>
          <li style={{ paddingLeft: 16, fontSize: '0.8em', color: '#555' }}>
            Annotations ({annCount})
          </li>
          <li style={{ paddingLeft: 16, fontSize: '0.8em', color: '#555' }}>
            Title Block
          </li>
        </ul>
      )}
    </li>
  );
}

export function DrawingTreePane() {
  const drawing = useAppStore((s) => s.activeDrawing);
  const bus = useAppStore((s) => s.bus);
  const [sheetsExpanded, setSheetsExpanded] = useState(true);
  const [propsExpanded, setPropsExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);

  if (!drawing) {
    return <div style={{ padding: 8, color: '#888', fontSize: '0.85em' }}>No drawing open.</div>;
  }

  const handleSelectSheet = (sheetId: string) => {
    void bus.execute(new SetActiveSheetCommand({ sheetId }));
    setContextMenu(null);
  };

  const handleSheetContextMenu = (e: React.MouseEvent, sheetId: string) => {
    e.preventDefault();
    setContextMenu({ kind: 'sheet', sheetId, x: e.clientX, y: e.clientY });
  };

  const handleRenameSheet = (sheetId: string) => {
    const name = window.prompt('New sheet name:');
    if (name) void bus.execute(new RenameSheetCommand({ sheetId, name }));
    setContextMenu(null);
  };

  const handleDeleteSheet = (sheetId: string) => {
    void bus.execute(new DeleteSheetCommand({ sheetId }));
    setContextMenu(null);
  };

  return (
    <div
      role="tree"
      aria-label="Drawing tree"
      style={{ fontSize: '0.85em', userSelect: 'none', overflow: 'auto', height: '100%' }}
      onClick={() => setContextMenu(null)}
    >
      {/* Root */}
      <div style={{ fontWeight: 'bold', padding: '4px 8px' }}>
        Drawing: {drawing.name}
      </div>

      {/* Source */}
      <div style={{ paddingLeft: 16, color: '#888', fontSize: '0.9em' }}>
        Source: {drawing.source.partPath}
      </div>

      {/* Sheets */}
      <div style={{ paddingLeft: 8, marginTop: 4 }}>
        <span
          style={{ cursor: 'pointer', fontWeight: 500 }}
          onClick={() => setSheetsExpanded((v) => !v)}
        >
          {sheetsExpanded ? '▾' : '▸'} Sheets
        </span>
        {sheetsExpanded && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {drawing.sheets.map((sheet) => (
              <SheetNode
                key={sheet.id}
                sheet={sheet}
                isActive={sheet.id === drawing.activeSheetId}
                onSelect={() => handleSelectSheet(sheet.id)}
                onContextMenu={(e) => handleSheetContextMenu(e, sheet.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Properties */}
      <div style={{ paddingLeft: 8, marginTop: 4 }}>
        <span
          style={{ cursor: 'pointer', fontWeight: 500 }}
          onClick={() => setPropsExpanded((v) => !v)}
        >
          {propsExpanded ? '▾' : '▸'} Properties
        </span>
        {propsExpanded && (
          <ul style={{ listStyle: 'none', margin: '4px 0 0 16px', padding: 0, color: '#555' }}>
            {Object.entries(drawing.properties).map(([k, v]) => (
              <li key={k} style={{ fontSize: '0.85em' }}>{k}: {String(v)}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && contextMenu.kind === 'sheet' && (
        <div
          role="menu"
          aria-label="Sheet context menu"
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: 'white', border: '1px solid #ccc', borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)', zIndex: 1000, padding: 4,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div role="menuitem" style={{ padding: '4px 12px', cursor: 'pointer' }}
            onClick={() => handleRenameSheet(contextMenu.sheetId)}>Rename</div>
          <div role="menuitem" style={{ padding: '4px 12px', cursor: 'pointer' }}
            onClick={() => handleDeleteSheet(contextMenu.sheetId)}>Delete</div>
        </div>
      )}
    </div>
  );
}
