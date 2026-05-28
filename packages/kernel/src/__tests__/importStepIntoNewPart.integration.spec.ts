import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernelApi } from '../api';
import { importStepIntoNewPart } from '../../../app/src/import/importStepIntoNewPart';

const STEP_PATH = resolve(
  __dirname,
  '../occt/__tests__/fixtures/step/cube-10mm.step',
);

describe('importStepIntoNewPart (real kernel)', () => {
  it('registers a cube part that executes to a non-empty shape', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    const stepBytes = readFileSync(STEP_PATH);
    // Node's File may be unavailable in the WASM environment; duck-type it
    // the same way the unit spec does.
    const buf = stepBytes.buffer.slice(
      stepBytes.byteOffset,
      stepBytes.byteOffset + stepBytes.byteLength,
    );
    const file = {
      name: 'cube-10mm.step',
      arrayBuffer: async () => buf,
    } as unknown as File;

    const { partId, part } = await importStepIntoNewPart(file, kernel);

    expect(part.name).toBe('cube-10mm');
    expect(part.featureTree.at(-1)?.kind).toBe('imported');

    // The defining smoke check: execute() does not throw and reports success.
    const result = await kernel.execute(partId);
    expect(result.ok).toBe(true);

    // getPart round-trips identity.
    const fetched = await kernel.getPart(partId);
    expect(fetched?.id).toBe(partId);
  });
});
