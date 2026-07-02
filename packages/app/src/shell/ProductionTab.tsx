import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseQrPayload, producedPanelKey } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { useCutListResult } from './useCutListResult';
import { buildPanelLabels } from '../drawing/buildPanelLabels';
import { buildPackingSlipRows } from '../production/buildPackingSlipRows';
import { ExportPackingSlipPdfCommand } from '../commands/ExportPackingSlipPdfCommand';
import { SetProducedCommand } from '../commands/SetProducedCommand';
import { QrScanButton } from '../production/QrScanButton';

export function ProductionTab() {
  const { t } = useTranslation();
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const bus = useAppStore((s) => s.bus);
  const cutListResult = useCutListResult();
  const [manualCode, setManualCode] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const producedPanels = activeAssembly?.producedPanels;
  const labels = buildPanelLabels(cutListResult, activeAssembly?.nest);

  const producedCount = labels.filter(
    (l) => producedPanels?.[producedPanelKey(l.itemNumber, l.copyIndex)] === true,
  ).length;

  const handleToggle = (key: string, current: boolean) => {
    void bus.execute(new SetProducedCommand({ key, produced: !current }));
  };

  const handleScan = (raw: string) => {
    const parsed = parseQrPayload(raw);
    if (!parsed) {
      setFeedback(t('panel.production.invalidCode'));
      return;
    }
    const match = labels.find(
      (l) => l.itemNumber === parsed.itemNumber && l.copyIndex === parsed.copyIndex,
    );
    if (!match) {
      setFeedback(t('panel.production.notFoundInDocument'));
      return;
    }
    if (raw !== match.qrPayload) {
      setFeedback(t('panel.production.codeMismatch'));
      return;
    }
    const key = producedPanelKey(match.itemNumber, match.copyIndex);
    const alreadyProduced = producedPanels?.[key] === true;
    void bus.execute(new SetProducedCommand({ key, produced: true }));
    setFeedback(alreadyProduced ? t('panel.production.alreadyProduced') : t('panel.production.markedProduced'));
  };

  const handleManualSubmit = () => {
    if (!manualCode.trim()) return;
    handleScan(manualCode.trim());
    setManualCode('');
  };

  const handleExportPackingSlip = () => {
    const rows = buildPackingSlipRows(cutListResult, producedPanels);
    void new ExportPackingSlipPdfCommand({
      rows,
      suggestedName: `${activeAssembly?.name ?? 'assembly'}-packing-slip.pdf`,
    }).apply();
  };

  if (cutListResult.rows.length === 0) {
    return <div className="p-4 text-xs text-neutral-400">{t('panel.production.noPanels')}</div>;
  }

  return (
    <div data-production-tab>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <input
          type="text"
          className="text-xs bg-shell-panel border border-shell-border rounded px-1 w-56"
          aria-label={t('panel.production.manualEntryLabel')}
          placeholder={t('panel.production.manualEntryLabel')}
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
        />
        <button type="button" onClick={handleManualSubmit}>
          {t('panel.production.manualEntrySubmit')}
        </button>
        <QrScanButton onScan={handleScan} label={t('panel.production.scan')} />
        <button type="button" onClick={handleExportPackingSlip}>
          {t('panel.production.exportPackingSlip')}
        </button>
      </div>
      {feedback && (
        <div role="status" data-testid="production-feedback" className="mb-2 text-xs">
          {feedback}
        </div>
      )}
      <div className="mb-2 text-xs" data-testid="production-progress">
        {t('panel.production.progress', { produced: producedCount, total: labels.length })}
      </div>
      <table className="text-xs w-full">
        <tbody>
          {labels.map((label) => {
            const key = producedPanelKey(label.itemNumber, label.copyIndex);
            const produced = producedPanels?.[key] === true;
            return (
              <tr key={key} data-testid={`production-panel-row-${key}`}>
                <td>{label.itemNumber}</td>
                <td>{label.copyIndex}/{label.copyCount}</td>
                <td>{label.partName}</td>
                <td>{label.materialName}</td>
                <td data-testid={`production-status-${key}`}>
                  {produced ? t('panel.production.produced') : t('panel.production.notProduced')}
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={produced ? t('panel.production.markNotProduced') : t('panel.production.markProduced')}
                    onClick={() => handleToggle(key, produced)}
                  >
                    {produced ? t('panel.production.markNotProduced') : t('panel.production.markProduced')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
