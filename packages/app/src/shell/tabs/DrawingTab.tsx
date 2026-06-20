import React from 'react';
import { useTranslation } from 'react-i18next';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../../drawing/toolMode';
import { pickFile } from '../fsaFallback';
import { AddSheetCommand } from '../../commands/AddSheetCommand';
import { AutoBalloonCommand } from '../../commands/AutoBalloonCommand';
import { autoBalloonSheet } from '../../drawing/autoBalloonSheet';
import { ExportDrawingPdfCommand } from '../../commands/ExportDrawingPdfCommand';
import { ExportDrawingSvgCommand } from '../../commands/ExportDrawingSvgCommand';
import { ExportDrawingPngCommand } from '../../commands/ExportDrawingPngCommand';
import { ExportDrawingDxfCommand } from '../../commands/ExportDrawingDxfCommand';
import { ExportDrawing1to1DxfCommand } from '../../commands/ExportDrawing1to1DxfCommand';
import { ExportAllSheetsDxfCommand } from '../../commands/ExportAllSheetsDxfCommand';
import { ExportAllSheets1to1DxfCommand } from '../../commands/ExportAllSheets1to1DxfCommand';
import { StubTab } from './_stub';

export default function DrawingTab(): JSX.Element {
  const { t } = useTranslation();
  const activeDocument = useAppStore((s) => s.activeDocument);
  const bus = useAppStore((s) => s.bus);
  const autoRegen = useAppStore((s) => s.autoRegen);
  const setAutoRegen = useAppStore((s) => s.setAutoRegen);
  const source = useAppStore((s) => s.activePart ?? s.activeAssembly ?? s.activeDrawingSourceDocument);

  if (activeDocument?.kind !== 'drawing') {
    return <StubTab subProject={6} what="Drawing generation" />;
  }

  const drawing = activeDocument.document;
  const isAssembly = drawing.source?.sourceKind === 'assembly';
  const setMode = useToolModeStore.getState().setMode;
  const activeSheet = drawing.sheets.find((s) => s.id === drawing.activeSheetId) ?? drawing.sheets[0];
  const hasUnderlay = activeSheet?.underlay !== undefined;
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
      <RibbonPanel title={t('ribbon.drawing.sheet')}>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.newSheet')}
          onClick={() => { void bus.execute(new AddSheetCommand({})); }}
        >
          {t('ribbon.drawing.newSheet')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.sheetSettings')}
          disabled
          title="Coming in follow-up F1"
        >
          {t('ribbon.drawing.sheetSettings')}
        </button>
      </RibbonPanel>

      {/* Place Views panel */}
      <RibbonPanel title={t('ribbon.drawing.placeViews')}>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.baseView')}
          onClick={() => {
            setMode('placeBase');
            useAppStore.getState().setAddViewDialogOpen({ kind: 'base' });
          }}
        >
          {t('ribbon.drawing.baseView')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.projectedView')}
          onClick={() => {
            setMode('placeProjected');
            useAppStore.getState().setAddViewDialogOpen({ kind: 'projected' });
          }}
        >
          {t('ribbon.drawing.projectedView')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.isoView')}
          onClick={() => {
            setMode('placeIso');
            useAppStore.getState().setAddViewDialogOpen({ kind: 'iso' });
          }}
        >
          {t('ribbon.drawing.isoView')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.section')}
          onClick={() => {
            useToolModeStore.getState().setSectionMode('full');
            useToolModeStore.getState().enterSectionMode();
          }}
        >
          {t('ribbon.drawing.section')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.halfSection')}
          onClick={() => {
            useToolModeStore.getState().setSectionMode('half');
            useToolModeStore.getState().enterSectionMode();
          }}
        >
          {t('ribbon.drawing.halfSection')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.steppedSection')}
          onClick={() => useToolModeStore.getState().enterSteppedSectionMode()}
        >
          {t('ribbon.drawing.steppedSection')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.detail')}
          disabled={!hasProjectedView}
          title={!hasProjectedView ? t('ribbon.drawing.needBaseViewTip') : undefined}
          onClick={() => useToolModeStore.getState().enterDetailMode()}
        >
          {t('ribbon.drawing.detail')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.detailRect')}
          disabled={!hasProjectedView}
          title={!hasProjectedView ? t('ribbon.drawing.needBaseViewTip') : undefined}
          onClick={() => useToolModeStore.getState().enterDetailRectMode()}
        >
          {t('ribbon.drawing.detailRect')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.editDetailRegion')}
          disabled={!hasDetailView}
          title={!hasDetailView ? t('ribbon.drawing.needDetailViewTip') : undefined}
          onClick={() => useToolModeStore.getState().enterEditDetailRegionMode()}
        >
          {t('ribbon.drawing.editDetailRegion')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.addBreak')}
          disabled={!hasBreakableProjection}
          title={
            !hasBreakableProjection
              ? t('ribbon.drawing.needBreakableTip')
              : undefined
          }
          onClick={() => useToolModeStore.getState().enterBreakMode()}
        >
          {t('ribbon.drawing.addBreak')}
        </button>
      </RibbonPanel>

      {/* Dimension panel */}
      <RibbonPanel title={t('ribbon.drawing.dimension')}>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.linearH')}
          onClick={() => setMode('addLinearH')}>{t('ribbon.drawing.linearH')}</button>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.linearV')}
          onClick={() => setMode('addLinearV')}>{t('ribbon.drawing.linearV')}</button>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.aligned')}
          onClick={() => setMode('addAligned')}>{t('ribbon.drawing.aligned')}</button>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.radial')}
          onClick={() => setMode('addRadial')}>{t('ribbon.drawing.radial')}</button>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.diametric')}
          onClick={() => setMode('addDiametric')}>{t('ribbon.drawing.diametric')}</button>
        {/* Auto-Dim: Drawing F4 — place parametric dims from base sketch */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.autoDim')}
          title={t('ribbon.drawing.autoDimTip')}
          onClick={() => setMode('autoDim')}
        >
          {t('ribbon.drawing.autoDim')}
        </button>
        {/* Baseline: Drawing F5 — baseline group from datum + stacked members */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.baseline')}
          title={t('ribbon.drawing.baselineTip')}
          onClick={() => setMode('baseline')}
        >
          {t('ribbon.drawing.baseline')}
        </button>
        {/* Ordinate: Drawing F5 — ordinate group from origin + L-leader members */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.ordinate')}
          title={t('ribbon.drawing.ordinateTip')}
          onClick={() => setMode('ordinate')}
        >
          {t('ribbon.drawing.ordinate')}
        </button>
        {/* Angular: Drawing F5 — angular dim from two edges or arc edge */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.angular')}
          title={t('ribbon.drawing.angularTip')}
          onClick={() => setMode('angular')}
        >
          {t('ribbon.drawing.angular')}
        </button>
      </RibbonPanel>

      {/* Annotate panel */}
      <RibbonPanel title={t('ribbon.drawing.annotate')}>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.centerline')}
          onClick={() => setMode('addCenterline')}>{t('ribbon.drawing.centerline')}</button>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.centerMark')}
          onClick={() => setMode('addCenterMark')}>{t('ribbon.drawing.centerMark')}</button>
        <button type="button" className="text-xs hover:text-white" aria-label={t('ribbon.drawing.leaderText')}
          onClick={() => setMode('addLeader')}>{t('ribbon.drawing.leaderText')}</button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.balloon')}
          disabled={!isAssembly}
          aria-disabled={!isAssembly}
          title={!isAssembly ? t('ribbon.drawing.balloonTip') : undefined}
          onClick={() => setMode('addBalloon')}
        >
          {t('ribbon.drawing.balloon')}
        </button>
        {/* Auto-balloon: Task 8 — one balloon per BOM row, anchored to component bbox center */}
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.autoBalloon')}
          disabled={!isAssembly}
          aria-disabled={!isAssembly}
          title={!isAssembly ? t('ribbon.drawing.autoBalloonTip') : undefined}
          onClick={() => {
            const drw = useAppStore.getState().activeDrawing;
            const sheet = drw
              ? (drw.sheets.find((s) => s.id === drw.activeSheetId) ?? drw.sheets[0])
              : undefined;
            const srcDoc = useAppStore.getState().activeDrawingSourceDocument;
            const asm = (srcDoc && 'components' in srcDoc ? srcDoc : null)
              ?? useAppStore.getState().activeAssembly
              ?? undefined;
            if (!sheet || !asm) return;
            const subAsmDocs = useAppStore.getState().subAssemblyDocs;
            const cache = {
              get: (p: string) =>
                subAsmDocs[p]
                  ? { kind: 'ok' as const, doc: subAsmDocs[p]!, partPath: p }
                  : undefined,
            };
            // Empty partInfo/panelSpecs Maps are intentional: they only affect display
            // name/dimensions in the parts list, not balloon count or placement
            // (item numbers come from bomItemNumbers, anchoring from projected edges).
            const balloons = autoBalloonSheet({
              sheet,
              asm,
              cache,
              partInfo: new Map(),
              panelSpecs: new Map(),
            });
            if (balloons.length > 0) {
              void bus.execute(new AutoBalloonCommand({ sheetId: sheet.id, balloons }));
            }
          }}
        >
          {t('ribbon.drawing.autoBalloon')}
        </button>
        {/* Hole Table: Drawing F6 */}
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.holeTable')}
          disabled={!hasProjectedView}
          title={!hasProjectedView ? t('ribbon.drawing.needBaseViewTip') : undefined}
          onClick={() => useToolModeStore.getState().enterHoleTableMode()}
        >
          {t('ribbon.drawing.holeTable')}
        </button>
        {/* Parts List: BOM snapshot annotation */}
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.partsList')}
          title={t('ribbon.drawing.partsListTip')}
          onClick={() => useToolModeStore.getState().enterPartsListMode()}
        >
          {t('ribbon.drawing.partsList')}
        </button>
      </RibbonPanel>

      {/* Reference panel */}
      <RibbonPanel title={t('ribbon.drawing.reference')}>
        {/* Auto-update views toggle: M3.2 — auto-regen stale views when source changes */}
        <button
          type="button"
          aria-pressed={autoRegen}
          className={`text-xs hover:text-white${autoRegen ? ' text-white' : ''}`}
          aria-label={t('ribbon.drawing.autoUpdateViews')}
          title={t('ribbon.drawing.autoUpdateViewsTip')}
          onClick={() => setAutoRegen(!autoRegen)}
        >
          {t('ribbon.drawing.autoUpdateViews')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white"
          aria-label={t('ribbon.drawing.importDxf')}
          onClick={() => {
            const { bus } = useAppStore.getState();
            void (async () => {
              const file = await pickFile([
                { description: 'DXF file', accept: { 'image/vnd.dxf': ['.dxf'] } },
              ]);
              if (!file) return;
              const dxfText = await file.text();
              const { ImportDxfUnderlayCommand } = await import('../../commands/ImportDxfUnderlayCommand');
              await bus.execute(new ImportDxfUnderlayCommand({ dxfText, fileName: file.name }));
            })();
          }}
        >
          {t('ribbon.drawing.importDxf')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.removeUnderlay')}
          disabled={!hasUnderlay}
          title={hasUnderlay ? t('ribbon.drawing.removeUnderlayTip') : t('ribbon.drawing.noUnderlayTip')}
          onClick={() => {
            void (async () => {
              const { RemoveDxfUnderlayCommand } = await import('../../commands/RemoveDxfUnderlayCommand');
              await bus.execute(new RemoveDxfUnderlayCommand({}));
            })();
          }}
        >
          {t('ribbon.drawing.removeUnderlay')}
        </button>
      </RibbonPanel>

      {/* Export panel */}
      <RibbonPanel title={t('ribbon.drawing.export')}>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.exportPdf')}
          disabled={!anySheetHasProjectedView}
          title={anySheetHasProjectedView ? t('ribbon.drawing.exportPdfTip') : t('ribbon.drawing.noViewsTip')}
          onClick={() => {
            void bus.execute(new ExportDrawingPdfCommand({ drawing, source }));
          }}
        >
          {t('ribbon.drawing.exportPdf')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.exportSvg')}
          disabled={!hasProjectedView}
          title={hasProjectedView ? t('ribbon.drawing.exportSvgTip') : t('ribbon.drawing.noViewsTip')}
          onClick={() => {
            void bus.execute(new ExportDrawingSvgCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          {t('ribbon.drawing.exportSvg')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.exportPng')}
          disabled={!hasProjectedView}
          title={hasProjectedView ? t('ribbon.drawing.exportPngTip') : t('ribbon.drawing.noViewsTip')}
          onClick={() => {
            void bus.execute(new ExportDrawingPngCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          {t('ribbon.drawing.exportPng')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.exportDxf')}
          disabled={!hasProjectedView}
          title={hasProjectedView ? t('ribbon.drawing.exportDxfTip') : t('ribbon.drawing.noViewsTip')}
          onClick={() => {
            void bus.execute(new ExportDrawingDxfCommand({
              drawing,
              sheetId: drawing.activeSheetId,
              source,
            }));
          }}
        >
          {t('ribbon.drawing.exportDxf')}
        </button>
        <button
          type="button"
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.drawing.exportDxf11')}
          disabled={!hasProjectedView}
          title={hasProjectedView ? t('ribbon.drawing.exportDxf11Tip') : t('ribbon.drawing.noViewsTip')}
          onClick={() => {
            void bus.execute(new ExportDrawing1to1DxfCommand({
              drawing,
              sheetId: drawing.activeSheetId,
            }));
          }}
        >
          {t('ribbon.drawing.exportDxf11')}
        </button>
        {isMultiSheet && (
          <>
            <button
              type="button"
              className="text-xs hover:text-white disabled:text-neutral-500"
              aria-label={t('ribbon.drawing.exportAllDxf')}
              disabled={!anySheetHasProjectedView}
              title={anySheetHasProjectedView ? t('ribbon.drawing.exportAllDxfTip') : t('ribbon.drawing.noViewsTip')}
              onClick={() => {
                void bus.execute(new ExportAllSheetsDxfCommand({ drawing, source }));
              }}
            >
              {t('ribbon.drawing.exportAllDxf')}
            </button>
            <button
              type="button"
              className="text-xs hover:text-white disabled:text-neutral-500"
              aria-label={t('ribbon.drawing.exportAll11')}
              disabled={!anySheetHasProjectedView}
              title={anySheetHasProjectedView ? t('ribbon.drawing.exportAll11Tip') : t('ribbon.drawing.noViewsTip')}
              onClick={() => {
                void bus.execute(new ExportAllSheets1to1DxfCommand({ drawing }));
              }}
            >
              {t('ribbon.drawing.exportAll11')}
            </button>
          </>
        )}
      </RibbonPanel>
    </div>
  );
}
