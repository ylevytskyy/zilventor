import { useAppStore } from '../store/useAppStore';
import { buildStatisticsXlsxBuffer } from './buildStatisticsXlsx';
import type { StatisticsReport } from './buildStatisticsReport';
import i18n from '../i18n';

function totalLineCount(report: StatisticsReport): number {
  return report.sections.reduce((sum, s) => sum + s.lines.length, 0);
}

export class ExportStatisticsXlsxCommand {
  constructor(private opts: { report: StatisticsReport; suggestedName: string }) {}

  async apply(): Promise<void> {
    const { report, suggestedName } = this.opts;
    const bytes = await buildStatisticsXlsxBuffer(report);
    const count = totalLineCount(report);

    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__zilventorStatisticsXlsxBytes = () => bytes;
    }

    const picker = (typeof window !== 'undefined' ? window : globalThis) as unknown as {
      showSaveFilePicker?: (opts: any) => Promise<any>;
    };
    const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (typeof picker.showSaveFilePicker === 'function') {
      try {
        const handle = await picker.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Excel Workbook', accept: { [xlsxMime]: ['.xlsx'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        useAppStore
          .getState()
          .setStatus(count === 0 ? i18n.t('status.exportStatistics.empty') : i18n.t('status.exportStatistics.lines', { count }));
      } catch {
        // User cancelled or write failed — silent no-op.
      }
      return;
    }
    if (typeof document === 'undefined') return;
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: xlsxMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    useAppStore
      .getState()
      .setStatus(count === 0 ? i18n.t('status.exportStatistics.empty') : i18n.t('status.exportStatistics.lines', { count }));
  }
}
