import type { ComponentColor } from './types';

export function bomRowKey(partPath: string, color?: ComponentColor): string {
  if (!color) return `${partPath}::none`;
  if (color.kind === 'palette') return `${partPath}::palette:${color.name}`;
  return `${partPath}::hex:${color.hex.toLowerCase()}`;
}
