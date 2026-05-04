type SaveOpts = {
  suggestedName: string;
  mimeType: string;
  extension: string;          // e.g. 'pdf' or 'png' (no leading dot)
  description: string;        // human label for the file picker
};

export async function triggerDownload(blob: Blob, opts: SaveOpts): Promise<void> {
  const w = globalThis as unknown as { showSaveFilePicker?: (o: unknown) => Promise<unknown> };
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = (await w.showSaveFilePicker({
        suggestedName: opts.suggestedName,
        types: [{ description: opts.description, accept: { [opts.mimeType]: [`.${opts.extension}`] } }],
      })) as { createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> };
      const stream = await handle.createWritable();
      await stream.write(blob);
      await stream.close();
      return;
    } catch (err: unknown) {
      // User cancelled → AbortError; fall through to a-tag fallback.
      if ((err as { name?: string }).name === 'AbortError') return;
      // Other errors fall through to fallback too.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
