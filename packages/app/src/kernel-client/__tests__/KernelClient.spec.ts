import { describe, it, expect, vi } from 'vitest';
import { createKernelClient } from '../KernelClient';

describe('KernelClient', () => {
  it('forwards ping via the Comlink proxy', async () => {
    const fakeProxy = { ping: vi.fn().mockResolvedValue({ reply: 'pong' as const, echo: 'x' }) };
    const client = createKernelClient(fakeProxy as never);
    await expect(client.ping('x')).resolves.toEqual({ reply: 'pong', echo: 'x' });
  });

  it('forwards createPart and addFeature', async () => {
    const fakeProxy = {
      createPart: vi.fn().mockResolvedValue('part-1'),
      addFeature: vi.fn().mockResolvedValue(undefined)
    };
    const client = createKernelClient(fakeProxy as never);
    expect(await client.createPart('Part1')).toBe('part-1');
    await client.addFeature('part-1', { kind: 'sketch', id: 's1', plane: 'XY', primitives: [], constraints: [] });
    expect(fakeProxy.addFeature).toHaveBeenCalledWith('part-1', expect.objectContaining({ kind: 'sketch' }));
  });
});
