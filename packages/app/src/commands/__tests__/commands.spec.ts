import { describe, it, expect, vi } from 'vitest';
import { CreatePartCommand } from '../CreatePartCommand';
import { AddSketchCommand } from '../AddSketchCommand';
import { AddExtrusionCommand } from '../AddExtrusionCommand';
import { EditParameterCommand } from '../EditParameterCommand';
import type { PartDocument } from '@zilventor/shared';
import type { KernelClient } from '../../kernel-client/KernelClient';

// Partial KernelClient used by each command under test. Methods the command
// doesn't touch are omitted; the cast through `unknown` is the escape hatch.
const asKernel = (mock: Partial<KernelClient>): KernelClient => mock as unknown as KernelClient;

const makePart = (): PartDocument => ({ id: 'part-1', name: 'Part1', units: 'mm', parameters: {}, featureTree: [] });

describe('CreatePartCommand', () => {
  it('creates a part on apply; sets activePart to null on revert', async () => {
    const part = makePart();
    const createPart = vi.fn().mockResolvedValue(part.id);
    const getPart = vi.fn().mockResolvedValue(part);
    const kernel = asKernel({ createPart, getPart });
    const setActivePart = vi.fn();
    const cmd = new CreatePartCommand({ kernel, store: { setActivePart }, name: 'Part1' });
    await cmd.apply();
    expect(createPart).toHaveBeenCalledWith('Part1');
    expect(setActivePart).toHaveBeenCalledWith(part);
    await cmd.revert();
    expect(setActivePart).toHaveBeenLastCalledWith(null);
  });
});

describe('AddSketchCommand', () => {
  it('adds a sketch feature and reverts to the prior part', async () => {
    const prior = makePart();
    const next = { ...prior, featureTree: [{ kind: 'sketch' as const, id: 's1', plane: 'XY' as const, primitives: [] }] };
    const addFeature = vi.fn().mockResolvedValue(undefined);
    const getPart = vi.fn().mockResolvedValue(next);
    const kernel = asKernel({ addFeature, getPart });
    const setActivePart = vi.fn();
    const store = { activePart: prior, setActivePart };
    const cmd = new AddSketchCommand({ kernel, store, feature: { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] } });
    await cmd.apply();
    expect(addFeature).toHaveBeenCalledWith(prior.id, expect.objectContaining({ kind: 'sketch', id: 's1' }));
    expect(setActivePart).toHaveBeenCalledWith(next);
    await cmd.revert();
    expect(setActivePart).toHaveBeenLastCalledWith(prior);
  });

  it('throws if no active part', async () => {
    const kernel = asKernel({});
    const store = { activePart: null, setActivePart: vi.fn() };
    const cmd = new AddSketchCommand({ kernel, store, feature: { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] } });
    await expect(cmd.apply()).rejects.toThrow(/no active part/);
  });
});

describe('AddExtrusionCommand', () => {
  it('sets parameter, adds extrude feature, and reverts to prior part', async () => {
    const prior = makePart();
    const next = { ...prior, parameters: { d1: { name: 'd1', expression: '18', value: 18, unit: 'mm' as const } }, featureTree: [{ kind: 'extrude' as const, id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' as const }] };
    const setParameter = vi.fn().mockResolvedValue(undefined);
    const addFeature = vi.fn().mockResolvedValue(undefined);
    const getPart = vi.fn().mockResolvedValue(next);
    const deleteParameter = vi.fn().mockResolvedValue(undefined);
    const kernel = asKernel({ setParameter, addFeature, getPart, deleteParameter });
    const setActivePart = vi.fn();
    const cmd = new AddExtrusionCommand({
      kernel,
      store: { activePart: prior, setActivePart },
      parameter: { name: 'd1', expression: '18', value: 18, unit: 'mm' },
      feature: { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' }
    });
    await cmd.apply();
    expect(setParameter).toHaveBeenCalledWith(prior.id, expect.objectContaining({ name: 'd1', value: 18 }));
    expect(addFeature).toHaveBeenCalled();
    expect(setActivePart).toHaveBeenCalledWith(next);
    await cmd.revert();
    expect(setActivePart).toHaveBeenLastCalledWith(prior);
  });

  it('revert calls deleteParameter when the parameter was freshly created', async () => {
    const prior = makePart();
    const next = { ...prior, parameters: { d1: { name: 'd1', expression: '18', value: 18, unit: 'mm' as const } }, featureTree: [{ kind: 'extrude' as const, id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' as const }] };
    const deleteParameter = vi.fn().mockResolvedValue(undefined);
    const setParameter = vi.fn().mockResolvedValue(undefined);
    const addFeature = vi.fn().mockResolvedValue(undefined);
    const getPart = vi.fn().mockResolvedValue(next);
    const kernel = asKernel({ setParameter, addFeature, getPart, deleteParameter });
    const setActivePart = vi.fn();
    const cmd = new AddExtrusionCommand({
      kernel,
      store: { activePart: prior, setActivePart },
      parameter: { name: 'd1', expression: '18', value: 18, unit: 'mm' },
      feature: { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' }
    });
    await cmd.apply();
    await cmd.revert();
    expect(deleteParameter).toHaveBeenCalledWith(prior.id, 'd1');
  });

  it('revert restores the prior parameter when one existed before apply', async () => {
    const priorParam = { name: 'd1', expression: '10', value: 10, unit: 'mm' as const };
    const prior: PartDocument = { id: 'part-1', name: 'Part1', units: 'mm', parameters: { d1: priorParam }, featureTree: [] };
    const next = { ...prior, parameters: { d1: { name: 'd1', expression: '18', value: 18, unit: 'mm' as const } }, featureTree: [{ kind: 'extrude' as const, id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' as const }] };
    const deleteParameter = vi.fn().mockResolvedValue(undefined);
    const setParameter = vi.fn().mockResolvedValue(undefined);
    const addFeature = vi.fn().mockResolvedValue(undefined);
    const getPart = vi.fn().mockResolvedValue(next);
    const kernel = asKernel({ setParameter, addFeature, getPart, deleteParameter });
    const setActivePart = vi.fn();
    const cmd = new AddExtrusionCommand({
      kernel,
      store: { activePart: prior, setActivePart },
      parameter: { name: 'd1', expression: '18', value: 18, unit: 'mm' },
      feature: { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' }
    });
    await cmd.apply();
    await cmd.revert();
    expect(deleteParameter).not.toHaveBeenCalled();
    expect(setParameter).toHaveBeenLastCalledWith(prior.id, priorParam);
  });
});

describe('EditParameterCommand', () => {
  it('updates a parameter and restores the prior value on revert', async () => {
    const prior: PartDocument = {
      id: 'p1', name: 'P', units: 'mm',
      parameters: { d1: { name: 'd1', expression: '18', value: 18, unit: 'mm' } },
      featureTree: []
    };
    const afterApply: PartDocument = { ...prior, parameters: { d1: { name: 'd1', expression: '36', value: 36, unit: 'mm' } } };
    const setParameter = vi.fn().mockResolvedValue(undefined);
    const getPart = vi.fn()
      .mockResolvedValueOnce(afterApply) // apply returns new part
      .mockResolvedValueOnce(prior);     // revert returns old part
    const kernel = asKernel({ setParameter, getPart });
    const setActivePart = vi.fn();
    const cmd = new EditParameterCommand({
      kernel,
      store: { activePart: prior, setActivePart },
      parameter: { name: 'd1', expression: '36', value: 36, unit: 'mm' }
    });
    await cmd.apply();
    expect(setParameter).toHaveBeenCalledWith(prior.id, expect.objectContaining({ value: 36 }));
    expect(setActivePart).toHaveBeenCalledWith(afterApply);
    await cmd.revert();
    expect(setParameter).toHaveBeenLastCalledWith(prior.id, expect.objectContaining({ value: 18 }));
    expect(setActivePart).toHaveBeenLastCalledWith(prior);
  });
});
