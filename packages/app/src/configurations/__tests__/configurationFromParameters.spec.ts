import { describe, it, expect } from 'vitest';
import { configurationFromParameters } from '../configurationFromParameters';
import type { SketchParameter } from '@zilventor/shared';

const params: SketchParameter[] = [
  { name: 'width', expression: '500', value: 500, unit: 'mm' },
  { name: 'height', expression: 'width + 200', value: 700, unit: 'mm' },
];

describe('configurationFromParameters', () => {
  it('clones the current parameter expressions into a named configuration', () => {
    const cfg = configurationFromParameters('Snapshot', params);
    expect(cfg).toEqual({
      name: 'Snapshot',
      values: { width: '500', height: 'width + 200' },
    });
  });

  it('produces an empty values map when there are no parameters', () => {
    expect(configurationFromParameters('Empty', [])).toEqual({ name: 'Empty', values: {} });
  });
});
