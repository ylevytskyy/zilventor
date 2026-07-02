import { boreToFlat, grooveRect, type PanelManufacturingInput } from './renderPanelManufacturingDxf';
import { MANUFACTURING_LAYERS as L } from './manufacturingLayers';

// Copied verbatim from buildBoringCsv.ts/buildBomCsv.ts (csvCell is local in each, not
// shared) — RFC 4180 quote/escape, never strip: keeps Unicode part names legible.
function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Matches buildBoringCsv.ts's depthLabel convention for the 'throughAll' sentinel.
function depthLabel(d: number | 'throughAll'): string {
  return d === 'throughAll' ? 'THROUGH' : String(d);
}

function numCell(n: number | undefined): string {
  return n === undefined ? '' : String(n);
}

/**
 * W7 (D2/S1): one CSV row per machining operation — every bore and every groove of every
 * panel — for the sidecar `machining.csv` shipped in the per-material-folders ZIP export
 * only (combined single-DXF mode has no CSV). Reuses boreToFlat/grooveRect from
 * renderPanelManufacturingDxf.ts so a row is skipped exactly when its DXF entity would be
 * (unmapped bore face role / non-Top-Bottom groove face), and the "layer" column always
 * matches what actually landed in the DXF.
 */
export function buildManufacturingCsv(inputs: PanelManufacturingInput[]): string {
  const out: string[] = ['partName,opType,diameter,depth,layer,toolNumber,speed'];
  for (const input of inputs) {
    const len = input.spec.length;
    const wid = input.spec.width;
    for (const b of input.bores) {
      const f = boreToFlat(b, len, wid);
      if (!f) continue;
      out.push([
        csvCell(input.partName),
        b.role,
        String(b.diameter),
        depthLabel(b.depth),
        csvCell(b.presetLayerName ?? f.layer),
        numCell(b.toolNumber),
        numCell(b.speed),
      ].join(','));
    }
    for (const g of input.grooves) {
      if (!grooveRect(g, len, wid)) continue;
      out.push([
        csvCell(input.partName),
        'groove',
        '',
        String(g.depth),
        csvCell(g.presetLayerName ?? L.grooves),
        numCell(g.toolNumber),
        numCell(g.speed),
      ].join(','));
    }
  }
  return out.join('\n') + '\n';
}
