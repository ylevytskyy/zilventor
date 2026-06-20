import { describe, it, expect, vi } from 'vitest';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { activateConfiguration } from '../activateConfiguration';
import type { Configuration } from '@zilventor/shared';

function makeRegistry(): ParameterRegistry {
  const r = new ParameterRegistry();
  r.setParameter({ name: 'width', expression: '500', unit: 'mm' });
  r.setParameter({ name: 'height', expression: '700', unit: 'mm' });
  return r;
}

const CONFIGS: Configuration[] = [
  { name: 'Large', values: { width: '900', height: '1200' } },
  { name: 'Small', values: { width: '300', height: '400' } },
];

describe('activateConfiguration', () => {
  it('bulk-sets all parameter values of the named configuration', () => {
    const reg = makeRegistry();
    const ok = activateConfiguration(reg, CONFIGS, 'Large');
    expect(ok).toBe(true);
    expect(reg.getValue('width')).toBe(900);
    expect(reg.getValue('height')).toBe(1200);
  });

  it('fires exactly one subscriber notification for the whole configuration', () => {
    const reg = makeRegistry();
    const spy = vi.fn();
    reg.subscribe(spy);
    activateConfiguration(reg, CONFIGS, 'Large');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns false and changes nothing when the configuration name is unknown', () => {
    const reg = makeRegistry();
    const spy = vi.fn();
    reg.subscribe(spy);
    const ok = activateConfiguration(reg, CONFIGS, 'Nonexistent');
    expect(ok).toBe(false);
    expect(reg.getValue('width')).toBe(500);
    expect(spy).not.toHaveBeenCalled();
  });

  it('inherits the existing parameter unit when re-setting', () => {
    const reg = makeRegistry();
    activateConfiguration(reg, CONFIGS, 'Small');
    const width = reg.getAll().find((p) => p.name === 'width');
    expect(width?.unit).toBe('mm');
  });
});
