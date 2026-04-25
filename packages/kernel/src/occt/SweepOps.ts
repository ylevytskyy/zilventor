type Vec3 = { x: number; y: number; z: number };

function sketchPlaneFrame(plane: 'XY' | 'XZ' | 'YZ'): { u: Vec3; v: Vec3; n: Vec3 } {
  if (plane === 'XY') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } };
  if (plane === 'XZ') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 0, y: 1, z: 0 } };
  return { u: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 1, y: 0, z: 0 } };
}

function to3D(plane: 'XY' | 'XZ' | 'YZ', x: number, y: number): Vec3 {
  const f = sketchPlaneFrame(plane);
  return {
    x: f.u.x * x + f.v.x * y,
    y: f.u.y * x + f.v.y * y,
    z: f.u.z * x + f.v.z * y,
  };
}

export function buildWireFromSketch(oc: any, sketch: any): any {
  const plane = sketch.plane as 'XY' | 'XZ' | 'YZ';
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

  for (const prim of sketch.primitives) {
    if (prim.kind === 'line') {
      const p1 = to3D(plane, prim.x1, prim.y1);
      const p2 = to3D(plane, prim.x2, prim.y2);
      const gp1 = new oc.gp_Pnt_3(p1.x, p1.y, p1.z);
      const gp2 = new oc.gp_Pnt_3(p2.x, p2.y, p2.z);
      const edge = new oc.BRepBuilderAPI_MakeEdge_3(gp1, gp2).Edge();
      wireBuilder.Add_1(edge);
    } else if (prim.kind === 'circle') {
      const c = to3D(plane, prim.cx, prim.cy);
      const f = sketchPlaneFrame(plane);
      const center = new oc.gp_Pnt_3(c.x, c.y, c.z);
      const axis = new oc.gp_Dir_4(f.n.x, f.n.y, f.n.z);
      const ax2 = new oc.gp_Ax2_3(center, axis);
      const circ = new oc.gp_Circ_2(ax2, prim.r);
      const edge = new oc.BRepBuilderAPI_MakeEdge_8(circ).Edge();
      wireBuilder.Add_1(edge);
    } else if (prim.kind === 'arc') {
      const c = to3D(plane, prim.cx, prim.cy);
      const f = sketchPlaneFrame(plane);
      const center = new oc.gp_Pnt_3(c.x, c.y, c.z);
      const axis = new oc.gp_Dir_4(f.n.x, f.n.y, f.n.z);
      const ax2 = new oc.gp_Ax2_3(center, axis);
      const circ = new oc.gp_Circ_2(ax2, prim.r);
      // BRepBuilderAPI_MakeEdge_9: constructor(L: gp_Circ, p1: Standard_Real, p2: Standard_Real)
      const edge = new oc.BRepBuilderAPI_MakeEdge_9(circ, prim.startAngle, prim.endAngle).Edge();
      wireBuilder.Add_1(edge);
    } else {
      throw new Error(`SweepOps: unsupported primitive kind '${prim.kind}'`);
    }
  }

  if (!wireBuilder.IsDone()) throw new Error('SweepOps: wire builder did not complete (disconnected primitives?)');
  const wire = wireBuilder.Wire();
  // Expose Closed() as an alias for Closed_1() so callers can use the standard OCCT name.
  wire.Closed = () => wire.Closed_1();
  return wire;
}
