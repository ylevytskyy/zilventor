import type { BoringAggregateResult, BoringPanelGroup } from '../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

// Copied verbatim from buildCutListCsv.ts (csvCell is local there, not exported).
function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function depthLabel(d: number | 'throughAll'): string {
  return d === 'throughAll' ? 'THROUGH' : String(d);
}

function dimCell(v: number | null): string {
  return v === null ? '' : String(v);
}

function boreLine(panel: BoringPanelGroup, b: BoreOp): string {
  return [
    csvCell(panel.partName),
    dimCell(panel.length),
    dimCell(panel.width),
    dimCell(panel.thickness),
    csvCell(b.id),
    b.face.role,   // b.face is FaceName (object); emit the role string ('Top'/'Front'/etc.)
    String(b.u),
    String(b.v),
    String(b.diameter),
    depthLabel(b.depth),
    b.connectorKind,
  ].join(',');
}

export function buildBoringCsv(result: BoringAggregateResult): string {
  const out: string[] = [];
  out.push('Panel,Length,Width,Thickness,Tag,Face,X,Y,Ø,Depth,Type');
  for (const panel of result.panels as BoringPanelGroup[]) {
    for (const b of panel.bores) out.push(boreLine(panel, b));
  }
  return out.join('\n') + '\n';
}
