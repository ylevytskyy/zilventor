// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createOneComponentPicker } from './createOneComponentPicker';
import type { ComponentPath } from '@zilventor/shared';

// Pure state machine: feed it ONE ComponentPath pick; it resolves to a partPath
// via the supplied resolver and fires onPick(partPath, path) immediately.
describe('createOneComponentPicker', () => {
  const resolve = (p: ComponentPath): string => `${p[p.length - 1]}.zipt`;

  it('fires onPick with the resolved partPath and the raw path on the first pick', () => {
    const calls: Array<[string, ComponentPath]> = [];
    const picker = createOneComponentPicker(
      resolve,
      (partPath, path) => calls.push([partPath, path]),
    );
    picker.pick(['TOP1', 'C1']);
    expect(calls).toEqual([['C1.zipt', ['TOP1', 'C1']]]);
  });

  it('fires once per pick (each call is independent — one-shot semantics)', () => {
    const calls: Array<string> = [];
    const picker = createOneComponentPicker(
      resolve,
      (partPath) => calls.push(partPath),
    );
    picker.pick(['C1']);
    picker.pick(['C2']);
    expect(calls).toEqual(['C1.zipt', 'C2.zipt']);
  });

  it('reset() does not throw and the next pick still fires', () => {
    const calls: Array<string> = [];
    const picker = createOneComponentPicker(
      resolve,
      (partPath) => calls.push(partPath),
    );
    picker.reset();
    picker.pick(['C3']);
    expect(calls).toEqual(['C3.zipt']);
  });
});
