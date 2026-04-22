export type KernelApi = {
  ping(input: string): Promise<{ reply: 'pong'; echo: string }>;
  // more methods added in later tasks — keep this type as the single source of truth.
};

export function createKernelApi(): KernelApi {
  return {
    async ping(input: string) {
      return { reply: 'pong', echo: input };
    }
  };
}
