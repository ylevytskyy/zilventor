export async function writeToHandle(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
  const w = await handle.createWritable();
  await w.write(data as unknown as FileSystemWriteChunkType);
  await w.close();
}

export async function readFromHandle(handle: FileSystemFileHandle): Promise<Uint8Array> {
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}
