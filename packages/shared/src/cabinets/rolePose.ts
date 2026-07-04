export type Quat = [number, number, number, number];

/**
 * Local duplicate of kernel/src/assembly/quat.ts's quatFromEulerXYZ (intrinsic
 * XYZ Euler → quaternion, degrees). `packages/shared` cannot depend on
 * `@zilventor/kernel` (kernel depends on shared), so per-role pose
 * quaternions are computed from this private copy — mirrors the existing
 * fileFormat.ts eulerXYZToQuat duplicate (cabinet-pose-fix plan §2.5).
 */
export function localQuatFromEulerXYZ(rxDeg: number, ryDeg: number, rzDeg: number): Quat {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/**
 * Builds the additive `pose` field per cabinet-pose-fix plan §3.2: pose is
 * purely additive (stored `position`/`rotation` numbers never change).
 * `translation` is the caller-computed world translation (position + the
 * role's half-extent/thickness correction); `rotationDeg` is the Euler triple
 * whose quaternion compensates buildPanelBox's local box convention
 * (X∈[-L/2,L/2], Y∈[-W/2,W/2], Z∈[0,T]).
 */
export function rolePose(
  translation: { x: number; y: number; z: number },
  rotationDeg: { rx: number; ry: number; rz: number },
): { translation: { x: number; y: number; z: number }; quaternion: Quat } {
  return {
    translation,
    quaternion: localQuatFromEulerXYZ(rotationDeg.rx, rotationDeg.ry, rotationDeg.rz),
  };
}
