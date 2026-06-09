import { describe, it, expect } from 'vitest';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { UpdateParameterExpressionCommand } from '../UpdateParameterExpressionCommand';

describe('UpdateParameterExpressionCommand', () => {
  it('apply() changes the parameter expression in the registry', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '120', registry);

    await cmd.apply();

    const after = registry.getAll().find((p) => p.name === 'width')!;
    expect(after.expression).toBe('120');
    expect(after.value).toBe(120);
  });

  it('revert() restores the original expression', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '120', registry);

    await cmd.apply();
    await cmd.revert();

    const reverted = registry.getAll().find((p) => p.name === 'width')!;
    // NOT hand-authored — must read back from the registry after revert.
    expect(reverted.expression).toBe(before.expression);
    expect(reverted.value).toBe(before.value);
  });

  it('apply() cascades to dependents', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });
    registry.setParameter({ name: 'half', expression: 'width/2', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '200', registry);
    await cmd.apply();

    expect(registry.getValue('half')).toBe(100);
  });

  it('revert() cascades back to dependents', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'width', expression: '100', unit: 'mm' });
    registry.setParameter({ name: 'half', expression: 'width/2', unit: 'mm' });

    const before = registry.getAll().find((p) => p.name === 'width')!;
    const cmd = new UpdateParameterExpressionCommand(before, '200', registry);
    await cmd.apply();
    await cmd.revert();

    expect(registry.getValue('half')).toBe(50);
  });

  it('apply() throws if the registry rejects (cycle)', async () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'a', expression: '10', unit: 'mm' });
    registry.setParameter({ name: 'b', expression: 'a', unit: 'mm' });

    // Make a depend on b → cycle.
    const before = registry.getAll().find((p) => p.name === 'a')!;
    const cmd = new UpdateParameterExpressionCommand(before, 'b + 1', registry);
    await expect(cmd.apply()).rejects.toThrow();
  });
});
