import { describe, it, expect, vi } from 'vitest';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { RuleEngine, RuleCycleError, detectRuleCycle } from '../RuleEngine';
import type { Rule } from '@zilventor/shared';

function makeRegistry(): ParameterRegistry {
  const r = new ParameterRegistry();
  r.setParameter({ name: 'width', expression: '500', unit: 'mm' });
  r.setParameter({ name: 'shelfCount', expression: '1', unit: 'mm' });
  return r;
}

describe('RuleEngine — firing on trigger change', () => {
  it('applies thenSet when a trigger changes and the condition is true', () => {
    const reg = makeRegistry();
    const engine = new RuleEngine(reg);
    engine.load([
      { id: 'r1', trigger: ['width'], condition: 'width > 600', thenSet: [{ target: 'shelfCount', expression: '3' }] },
    ]);
    engine.start();

    const spy = vi.spyOn(reg, 'setParameter');
    reg.setParameter({ name: 'width', expression: '700', unit: 'mm' });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'shelfCount', expression: '3' }));
    expect(reg.getValue('shelfCount')).toBe(3);
  });

  it('does not apply thenSet when the condition is false', () => {
    const reg = makeRegistry();
    const engine = new RuleEngine(reg);
    engine.load([
      { id: 'r1', trigger: ['width'], condition: 'width > 600', thenSet: [{ target: 'shelfCount', expression: '3' }] },
    ]);
    engine.start();

    reg.setParameter({ name: 'width', expression: '550', unit: 'mm' }); // still < 600
    expect(reg.getValue('shelfCount')).toBe(1);
  });

  it('does not fire for a parameter that is not a trigger', () => {
    const reg = makeRegistry();
    reg.setParameter({ name: 'depth', expression: '300', unit: 'mm' });
    const engine = new RuleEngine(reg);
    engine.load([
      { id: 'r1', trigger: ['width'], condition: 'width > 600', thenSet: [{ target: 'shelfCount', expression: '3' }] },
    ]);
    engine.start();

    reg.setParameter({ name: 'depth', expression: '350', unit: 'mm' });
    expect(reg.getValue('shelfCount')).toBe(1);
  });

  it('applies each matching rule exactly once per change (no re-entrant loop)', () => {
    const reg = makeRegistry();
    const engine = new RuleEngine(reg);
    engine.load([
      { id: 'r1', trigger: ['width'], condition: 'width > 600', thenSet: [{ target: 'shelfCount', expression: '3' }] },
    ]);
    engine.start();

    const spy = vi.spyOn(reg, 'setParameter');
    reg.setParameter({ name: 'width', expression: '700', unit: 'mm' });

    const shelfCalls = spy.mock.calls.filter((c) => (c[0] as { name: string }).name === 'shelfCount');
    expect(shelfCalls).toHaveLength(1);
  });

  it('stop() detaches the listener', () => {
    const reg = makeRegistry();
    const engine = new RuleEngine(reg);
    engine.load([
      { id: 'r1', trigger: ['width'], condition: 'width > 600', thenSet: [{ target: 'shelfCount', expression: '3' }] },
    ]);
    engine.start();
    engine.stop();

    reg.setParameter({ name: 'width', expression: '700', unit: 'mm' });
    expect(reg.getValue('shelfCount')).toBe(1);
  });
});

describe('RuleEngine — cycle detection at load', () => {
  const cyclic: Rule[] = [
    { id: 'a', trigger: ['x'], condition: 'x > 0', thenSet: [{ target: 'y', expression: '1' }] },
    { id: 'b', trigger: ['y'], condition: 'y > 0', thenSet: [{ target: 'x', expression: '1' }] },
  ];

  it('detectRuleCycle returns a cycle path for cyclic rules', () => {
    expect(detectRuleCycle(cyclic)).not.toBeNull();
  });

  it('detectRuleCycle returns null for acyclic rules', () => {
    const acyclic: Rule[] = [
      { id: 'a', trigger: ['x'], condition: 'x > 0', thenSet: [{ target: 'y', expression: '1' }] },
      { id: 'b', trigger: ['y'], condition: 'y > 0', thenSet: [{ target: 'z', expression: '1' }] },
    ];
    expect(detectRuleCycle(acyclic)).toBeNull();
  });

  it('load throws RuleCycleError on cyclic rules', () => {
    const reg = new ParameterRegistry();
    const engine = new RuleEngine(reg);
    expect(() => engine.load(cyclic)).toThrow(RuleCycleError);
  });
});
