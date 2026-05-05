import { describe, it, expect, vi } from 'vitest';
import { createKernelClient } from '../KernelClient';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { ProjectorInput } from '@zilventor/shared';

const MOCK_INPUT: ProjectorInput = {
  triangles: [],
  edges: [],
  bbox: [0, 0, 0, 10, 10, 10],
};

describe('KernelClient.getProjectorInput routing', () => {
  it('routes getProjectorInput call through the proxy', async () => {
    const mockProxy = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_INPUT),
    } as unknown as KernelApi;

    const client = createKernelClient(mockProxy);
    const result = await client.getProjectorInput('part-123');

    expect(mockProxy.getProjectorInput).toHaveBeenCalledWith('part-123');
    expect(result).toEqual(MOCK_INPUT);
  });

  it('propagates null when proxy returns null (cold cache)', async () => {
    const mockProxy = {
      getProjectorInput: vi.fn().mockResolvedValue(null),
    } as unknown as KernelApi;

    const client = createKernelClient(mockProxy);
    const result = await client.getProjectorInput('part-cold');
    expect(result).toBeNull();
  });
});
