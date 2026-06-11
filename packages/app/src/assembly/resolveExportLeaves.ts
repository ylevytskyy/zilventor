import type { ComponentColor } from '@zilventor/shared';

/**
 * Resolve a (pre-resolved) ComponentColor union to a 0–1 RGB triple, mirroring
 * the renderer's palette/hex resolution (App.tsx:3915-3919). A palette name not
 * present in `colors`, or an absent color, yields undefined (= unmaterialized;
 * the export omits a color label for that leaf).
 *
 * Self-contained hex parser — does NOT import the kernel test helper hexToRgb01
 * (that is inaccessible to app code). Inline parse mirrors App.tsx:3916-3918.
 */
export function effectiveColorToRgb(
  color: ComponentColor | undefined,
  colors: Record<string, string>,
): readonly [number, number, number] | undefined {
  let hexStr: string | undefined;
  if (!color) return undefined;
  if (color.kind === 'hex') hexStr = color.hex;
  else if (color.kind === 'palette') hexStr = colors[color.name];
  if (!hexStr) return undefined;
  const h = hexStr.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
