import React from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../../drawing/toolMode';
import { AddSheetCommand } from '../../commands/AddSheetCommand';
import { ExportDrawingPdfCommand } from '../../commands/ExportDrawingPdfCommand';
import { ExportDrawingSvgCommand } from '../../commands/ExportDrawingSvgCommand';
import { ExportDrawingPngCommand } from '../../commands/ExportDrawingPngCommand';
import { StubTab } from './_stub';

export default function DrawingTab(): JSX.Element {
  const activeDocument = useAppStore((s) => s.activeDocument);
  const bus = useAppStore((s) => s.bus);
  const source = useAppStore((s) => s.activePart ?? s.activeAssembly);

  if (activeDocument?.kind !== 'drawing') {
    return <StubTab subProject={6} what="Drawing generation" />;
  }

  const drawing = activeDocument.document;
  const isAssembly = drawing.source?.sourceKind === 'assembly';
  const setMode = useToolModeStore.getState().setMode;
  const activeSheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId) ?? drawing.sheets[0];
  const hasProjectedView = activeSheet?.views.some((v) => v.projection != null) ?? false;
  const hasBreakableProjection =
    activeSheet?.views.some(
      (v) =>
        (v.kind === 'base' || v.kind === 'projected' || v.kind === 'iso') &&
        v.projection != null,
    ) ?? false;

  return (
    <div className="flex gap-2 px-3 py-2">
      {/* Sheet panel */}
      <RibbonPanel title="Sheet">
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="New Sheet"
          onClick={() => { void bus.execute(new AddSheetCommand({})); }}
        >
          New Sheet
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Sheet…"
          disabled
          title="Coming in follow-up F1"
        >
          Sheet…
        </button>
      </RibbonPanel>

      {/* Place Views panel */}
      <RibbonPanel title="Place Views">
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Base View"
          onClick={() => {
            setMode('placeBase');
            useAppStore.getState().setAddViewDialogOpen({ kind: 'base' });
          }}
        >
          Base View
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Projected View"
          onClick={() => {
            setMode('placeProjected');
            useAppStore.getState().setAddViewDialogOpen({ kind: 'projected' });
          }}
        >
          Projected View
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Iso View"
          onClick={() => {
            setMode('placeIso');
            useAppStore.getState().setAddViewDialogOpen({ kind: 'iso' });
          }}
        >
          Iso View
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Section"
          onClick={() => useToolModeStore.getState().enterSectionMode()}
        >
          Section
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Detail"
          disabled={!hasProjectedView}
          title={!hasProjectedView ? 'Add a base view with a projection first' : undefined}
          onClick={() => useToolModeStore.getState().enterDetailMode()}
        >
          Detail
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Add Break"
          disabled={!hasBreakableProjection}
          title={
            !hasBreakableProjection
              ? 'Add a base, projected, or iso view with a projection first'
              : undefined
          }
          onClick={() => useToolModeStore.getState().enterBreakMode()}
        >
          Add Break
        </button>
      </RibbonPanel>

      {/* Dimension panel */}
      <RibbonPanel title="Dimension">
        <button type="button" className="text-xs hover:text-white" aria-label="Linear (H)"
          onClick={() => setMode('addLinearH')}>Linear (H)</button>
        <button type="button" className="text-xs hover:text-white" aria-label="Linear (V)"
          onClick={() => setMode('addLinearV')}>Linear (V)</button>
        <button type="button" className="text-xs hover:text-white" aria-label="Aligned"
          onClick={() => setMode('addAligned')}>Aligned</button>
        <button type="button" className="text-xs hover:text-white" aria-label="Radial"
          onClick={() => setMode('addRadial')}>Radial</button>
        <button type="button" className="text-xs hover:text-white" aria-label="Diametric"
          onClick={() => setMode('addDiametric')}>Diametric</button>
      </RibbonPanel>

      {/* Annotate panel */}
      <RibbonPanel title="Annotate">
        <button type="button" className="text-xs hover:text-white" aria-label="Centerline"
          onClick={() => setMode('addCenterline')}>Centerline</button>
        <button type="button" className="text-xs hover:text-white" aria-label="Center Mark"
          onClick={() => setMode('addCenterMark')}>Center Mark</button>
        <button type="button" className="text-xs hover:text-white" aria-label="Leader Text"
          onClick={() => setMode('addLeader')}>Leader Text</button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Balloon"
          disabled={!isAssembly}
          aria-disabled={!isAssembly}
          title={!isAssembly ? 'Balloon annotations require an assembly drawing' : undefined}
          onClick={() => setMode('addBalloon')}
        >
          Balloon
        </button>
      </RibbonPanel>

      {/* Export panel */}
      <RibbonPanel title="Export">
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export PDF"
          disabled={!source}
          title={source ? 'Export to PDF' : 'Source document not loaded'}
          onClick={() => {
            if (!source) return;
            void bus.execute(new ExportDrawingPdfCommand({ drawing, source }));
          }}
        >
          Export PDF
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export SVG"
          disabled={!source}
          title={source ? 'Export to SVG' : 'Source document not loaded'}
          onClick={() => {
            if (!source) return;
            void bus.execute(new ExportDrawingSvgCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          Export SVG
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export PNG"
          disabled={!source}
          title={source ? 'Export to PNG' : 'Source document not loaded'}
          onClick={() => {
            if (!source) return;
            void bus.execute(new ExportDrawingPngCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          Export PNG
        </button>
      </RibbonPanel>
    </div>
  );
}
