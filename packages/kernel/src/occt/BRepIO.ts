import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';

/**
 * Serializes an OCCT shape to the OCCT-native BREP ASCII format via the
 * Emscripten MEMFS. We write the shape to a temporary file inside MEMFS,
 * read the bytes back out, and unlink the file.
 *
 * API adaptation notes (vs. the textbook OCCT walkthrough):
 *   - `BRepTools.Write_3` in the pinned opencascade.js build takes a third
 *     `Message_ProgressRange` argument; we construct a throwaway
 *     `Message_ProgressRange_1` and pass it in.
 *   - MEMFS `/tmp` is not guaranteed to exist in every Emscripten build, so
 *     we stage files at the MEMFS root (`/`) which always exists.
 */
export function writeBRep(oc: OcctInstance, shape: OcctShape): Uint8Array {
  const path = `/shape-${Math.random().toString(36).slice(2)}.brep`;
  const progress = new oc.Message_ProgressRange_1();
  try {
    oc.BRepTools.Write_3(shape.handle as never, path, progress);
    return oc.FS.readFile(path);
  } finally {
    progress.delete();
    try {
      oc.FS.unlink(path);
    } catch {
      // file may not exist if Write_3 errored — swallow to avoid masking
    }
  }
}

/**
 * Reads a shape back from BREP bytes by staging them into MEMFS and
 * invoking `BRepTools.Read_2`, which mutates a freshly-constructed
 * `TopoDS_Shape` in place.
 *
 * API adaptation notes:
 *   - `Read_2` takes a `Message_ProgressRange` as a fourth argument in this
 *     build.
 *   - On success, we do NOT delete the `TopoDS_Shape` — ownership of the
 *     `handle` passes to the returned `OcctShape` and is freed by
 *     `disposeShape`. If `Read_2` throws, we delete the shape ourselves
 *     since the caller never gets a reference to it.
 */
export function readBRep(oc: OcctInstance, bytes: Uint8Array): OcctShape {
  const path = `/shape-in-${Math.random().toString(36).slice(2)}.brep`;
  oc.FS.writeFile(path, bytes);

  const builder = new oc.BRep_Builder();
  const shape = new oc.TopoDS_Shape();
  const progress = new oc.Message_ProgressRange_1();
  let success = false;
  try {
    oc.BRepTools.Read_2(shape, path, builder, progress);
    // Read_2 does not throw on malformed input — it logs to stderr and
    // leaves `shape` null. Promote that to a real error so callers cannot
    // silently receive an empty shape.
    if ((shape as { IsNull?: () => boolean }).IsNull?.()) {
      throw new Error('readBRep: BRepTools.Read_2 produced a null shape (corrupt or unsupported BREP bytes)');
    }
    success = true;
    return { __brand: 'OcctShape', handle: shape };
  } finally {
    progress.delete();
    builder.delete();
    try {
      oc.FS.unlink(path);
    } catch {
      // best-effort cleanup
    }
    if (!success) {
      (shape as { delete?: () => void }).delete?.();
    }
  }
}
