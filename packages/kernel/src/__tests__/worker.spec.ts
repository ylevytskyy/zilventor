import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';

describe('KernelApi (in-process)', () => {
  it('ping returns pong with an echoed payload', async () => {
    const api = createKernelApi();
    const res = await api.ping('hello');
    expect(res).toEqual({ reply: 'pong', echo: 'hello' });
  });
});
