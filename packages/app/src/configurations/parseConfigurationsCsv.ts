import type { Configuration } from '@zilventor/shared';

/**
 * Parses a design-table CSV into `Configuration[]`. The header row's first cell is
 * the configuration-name column label (ignored); the remaining header cells are
 * parameter names. Each subsequent row's first cell is the configuration name and
 * the rest are the parameter expressions, aligned by column. Blank lines are
 * skipped and every cell is trimmed. Returns [] when there are no data rows.
 */
export function parseConfigurationsCsv(csv: string): Configuration[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = lines[0]!.split(',').map((c) => c.trim());
  const paramNames = header.slice(1);

  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const values: Record<string, string> = {};
    paramNames.forEach((name, i) => {
      values[name] = cells[i + 1] ?? '';
    });
    return { name: cells[0] ?? '', values };
  });
}
