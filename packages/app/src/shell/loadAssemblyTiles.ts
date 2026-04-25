export type AssemblyTile = {
  partPath: string;
  name: string;       // filename without extension
  thumbnail: string;  // data URL
};

export type LoadAssemblyTilesOpfs = {
  listAll(): Promise<string[]>;
  read(path: string): Promise<Uint8Array>;
};

export type UnpackProjectFn = (
  archive: Uint8Array
) => Promise<{ thumbnail?: Uint8Array }>;

function uint8ToDataUrl(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return `data:image/png;base64,${btoa(bin)}`;
}

export async function loadAssemblyTiles(
  opfs: LoadAssemblyTilesOpfs,
  unpackProject: UnpackProjectFn,
): Promise<AssemblyTile[]> {
  const all = await opfs.listAll();
  const ziptPaths = all.filter((p) => p.endsWith('.zipt'));
  const tiles: AssemblyTile[] = [];
  for (const path of ziptPaths) {
    try {
      const bytes = await opfs.read(path);
      const part = await unpackProject(bytes);
      if (!part.thumbnail) continue;
      const filename = path.split('/').pop()!.replace(/\.zipt$/, '');
      tiles.push({
        partPath: path,
        name: filename,
        thumbnail: uint8ToDataUrl(part.thumbnail),
      });
    } catch (e) {
      console.warn(`loadAssemblyTiles: skipping ${path}: ${(e as Error).message}`);
    }
  }
  return tiles;
}
