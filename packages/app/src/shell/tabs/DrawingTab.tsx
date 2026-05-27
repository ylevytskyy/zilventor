import React from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../../drawing/toolMode';
import { AddSheetCommand } from '../../commands/AddSheetCommand';
import { ExportDrawingPdfCommand } from '../../commands/ExportDrawingPdfCommand';
import { ExportDrawingSvgCommand } from '../../commands/ExportDrawingSvgCommand';
import { ExportDrawingPngCommand } from '../../commands/ExportDrawingPngCommand';
import { ExportDrawingDxfCommand } from '../../commands/ExportDrawingDxfCommand';
import { ExportDrawing1to1DxfCommand } from '../../commands/ExportDrawing1to1DxfCommand';
import { ExportAllSheetsDxfCommand } from '../../commands/ExportAllSheetsDxfCommand';
import { ExportAllSheets1to1DxfCommand } from '../../commands/ExportAllSheets1to1DxfCommand';
import { StubTab } from './_stub';

export default function DrawingTab(): JSX.Element {
  const activeDocument = useAppStore((s) => s.activeDocument);
  const bus = useAppStore((s) => s.bus);
  const source = useAppStore((s) => s.activePart ?? s.activeAssembly ?? s.activeDrawingSourceDocument);

  if (activeDocument?.kind !== 'drawing') {
    return <StubTab subProject={6} what="Drawing generation" />;
  }

  const drawing = activeDocument.document;
  const isAssembly = drawing.source?.sourceKind === 'assembly';
  const setMode = useToolModeStore.getState().setMode;
  const activeSheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId) ?? drawing.sheets[0];
  const hasProjectedView = activeSheet?.views.some((v) => v.projection != null) ?? false;
  const isMultiSheet = drawing.sheets.length > 1;
  const anySheetHasProjectedView = drawing.sheets.some((s) => s.views.some((v) => v.projection != null));
  const hasDetailView = activeSheet?.views.some((v) => v.kind === 'detail') ?? false;
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
          onClick={() => {
            useToolModeStore.getState().setSectionMode('full');
            useToolModeStore.getState().enterSectionMode();
          }}
        >
          Section
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Half Section"
          onClick={() => {
            useToolModeStore.getState().setSectionMode('half');
            useToolModeStore.getState().enterSectionMode();
          }}
        >
          Half Section
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Stepped Section"
          onClick={() => useToolModeStore.getState().enterSteppedSectionMode()}
        >
          Stepped Section
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
          aria-label="Detail (Rect)"
          disabled={!hasProjectedView}
          title={!hasProjectedView ? 'Add a base view with a projection first' : undefined}
          onClick={() => useToolModeStore.getState().enterDetailRectMode()}
        >
          Detail (Rect)
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Edit Detail Region"
          disabled={!hasDetailView}
          title={!hasDetailView ? 'Add a detail view first' : undefined}
          onClick={() => useToolModeStore.getState().enterEditDetailRegionMode()}
        >
          Edit Detail Region
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
        {/* Auto-Dim: Drawing F4 — place parametric dims from base sketch */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Auto-Dim"
          title="Place parametric dimensions from base sketch parameters — click a view after enabling"
          onClick={() => setMode('autoDim')}
        >
          Auto-Dim
        </button>
        {/* Baseline: Drawing F5 — baseline group from datum + stacked members */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Baseline"
          title="Place a baseline dimension group — click datum, then click features"
          onClick={() => setMode('baseline')}
        >
          Baseline
        </button>
        {/* Ordinate: Drawing F5 — ordinate group from origin + L-leader members */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Ordinate"
          title="Place an ordinate dimension group — click origin, then click features"
          onClick={() => setMode('ordinate')}
        >
          Ordinate
        </button>
        {/* Angular: Drawing F5 — angular dim from two edges or arc edge */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label="Angular"
          title="Place an angular dimension — click two edges (or one arc edge)"
          onClick={() => setMode('angular')}
        >
          Angular
        </button>
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
        {/* Hole Table: Drawing F6 */}
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Hole Table"
          disabled={!hasProjectedView}
          title={!hasProjectedView ? 'Add a base view with a projection first' : undefined}
          onClick={() => useToolModeStore.getState().enterHoleTableMode()}
        >
          Hole Table
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
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export DXF"
          disabled={!source}
          title={source ? 'Export to DXF' : 'Source document not loaded'}
          onClick={() => {
            if (!source) return;
            void bus.execute(new ExportDrawingDxfCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          Export DXF
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Export DXF (1:1)"
          disabled={!hasProjectedView}
          title={hasProjectedView ? 'Export geometry at 1:1 (machining size)' : 'No projected views to export'}
          onClick={() => {
            void bus.execute(new ExportDrawing1to1DxfCommand({
              drawing,
              sheetId: drawing.activeSheetId,
            }));
          }}
        >
          Export DXF (1:1)
        </button>
        {isMultiSheet && (
          <>
            <button
              type="button"
              className="text-xs hover:text-white disabled:text-neutral-500"
              aria-label="Export All Sheets (DXF)"
              disabled={!source}
              title={source ? 'Export every sheet as a DXF (zip)' : 'Source document not loaded'}
              onClick={() => {
                if (!source) return;
                void bus.execute(new ExportAllSheetsDxfCommand({ drawing, source }));
              }}
            >
              Export All Sheets (DXF)
            </button>
            <button
              type="button"
              className="text-xs hover:text-white disabled:text-neutral-500"
              aria-label="Export All Sheets (1:1)"
              disabled={!anySheetHasProjectedView}
              title={anySheetHasProjectedView ? 'Export every sheet at 1:1 (zip)' : 'No projected views to export'}
              onClick={() => {
                void bus.execute(new ExportAllSheets1to1DxfCommand({ drawing }));
              }}
            >
              Export All Sheets (1:1)
            </button>
          </>
        )}
      </RibbonPanel>
    </div>
  );
}
