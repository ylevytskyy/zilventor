import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { UploadCustomTextureDialog } from '../UploadCustomTextureDialog';
import type { UploadCustomTextureDialogProps } from '../UploadCustomTextureDialog';

// jsdom doesn't implement URL.createObjectURL — stub for any internal usage.
beforeEach(() => {
  let counter = 0;
  (globalThis as any).URL.createObjectURL = vi.fn(() => `blob:fake-${counter++}`);
  (globalThis as any).URL.revokeObjectURL = vi.fn();
  // Stub crypto.randomUUID — crypto is a getter-only on globalThis in Node/jsdom,
  // so we stub the method directly on the existing crypto object.
  vi.spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValueOnce('uuid-blobid-1' as `${string}-${string}-${string}-${string}-${string}`)
    .mockReturnValueOnce('uuid-defid-1' as `${string}-${string}-${string}-${string}-${string}`)
    .mockReturnValue('uuid-fallback' as `${string}-${string}-${string}-${string}-${string}`);
});

describe('UploadCustomTextureDialog', () => {
  it('renders Name + required Albedo + optional Normal/Roughness inputs + mm fields with 1000 defaults', () => {
    render(<UploadCustomTextureDialog onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Texture name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Albedo/)).toBeRequired();
    expect(screen.getByLabelText(/Normal/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Roughness/)).toBeInTheDocument();
    expect((screen.getByLabelText('Physical width (mm)') as HTMLInputElement).value).toBe('1000');
    expect((screen.getByLabelText('Physical height (mm)') as HTMLInputElement).value).toBe('1000');
  });

  it('Add is disabled until a name + albedo file are provided', () => {
    render(<UploadCustomTextureDialog onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const addBtn = screen.getByRole('button', { name: 'Add texture' });
    expect(addBtn).toBeDisabled();

    // Name only — still disabled
    fireEvent.change(screen.getByLabelText('Texture name'), { target: { value: 'My Oak' } });
    expect(addBtn).toBeDisabled();
  });

  it('on submit, downscales each provided map and calls onSubmit with def + bytes', async () => {
    const onSubmit = vi.fn();
    const fakeAlbedoBytes = new Uint8Array([10, 20, 30]);
    const fakeNormalBytes = new Uint8Array([40, 50]);

    // Stub decodeImageFile + downscaleToJpeg to avoid real canvas raster encoding.
    const stubDecode = vi.fn().mockImplementation((file: File) => {
      // Return a fake DrawableSource with width/height matching file name convention.
      return Promise.resolve({ width: 512, height: 512 });
    });
    const stubDownscale = vi.fn()
      .mockResolvedValueOnce(fakeAlbedoBytes)   // albedo
      .mockResolvedValueOnce(fakeNormalBytes);  // normal

    const props: UploadCustomTextureDialogProps = {
      onSubmit,
      onCancel: vi.fn(),
      _decodeImageFile: stubDecode,
      _downscaleToJpeg: stubDownscale,
    };

    render(<UploadCustomTextureDialog {...props} />);

    // Fill in name
    fireEvent.change(screen.getByLabelText('Texture name'), { target: { value: 'My Oak' } });

    // Provide albedo file
    const albedoFile = new File([new Uint8Array([1, 2, 3])], 'albedo.jpg', { type: 'image/jpeg' });
    const normalFile = new File([new Uint8Array([4, 5])], 'normal.jpg', { type: 'image/jpeg' });

    fireEvent.change(screen.getByLabelText(/Albedo/), { target: { files: [albedoFile] } });
    fireEvent.change(screen.getByLabelText(/Normal/), { target: { files: [normalFile] } });

    const addBtn = screen.getByRole('button', { name: 'Add texture' });
    expect(addBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(addBtn);
      await Promise.resolve();
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const { def, bytes } = onSubmit.mock.calls[0]![0] as {
      def: { name: string; physicalWidthMm: number; physicalHeightMm: number; albedoBlobId: string; normalBlobId?: string };
      bytes: Record<string, Uint8Array>;
    };

    expect(def.name).toBe('My Oak');
    expect(def.physicalWidthMm).toBe(1000);
    expect(def.physicalHeightMm).toBe(1000);
    expect(typeof def.albedoBlobId).toBe('string');
    expect(def.albedoBlobId).toMatch(/^tex-/);
    expect(typeof def.normalBlobId).toBe('string');
    expect(def.normalBlobId).toMatch(/^tex-/);
    expect(bytes[def.albedoBlobId]).toEqual(fakeAlbedoBytes);
    expect(bytes[def.normalBlobId!]).toEqual(fakeNormalBytes);
    expect(stubDecode).toHaveBeenCalledTimes(2); // albedo + normal
    expect(stubDownscale).toHaveBeenCalledTimes(2);
  });
});
