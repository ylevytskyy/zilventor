import type { EdgeName, FilletSelectionMode, TessellatedEdge, Vec3 } from '@zilventor/shared';

export type { TessellatedEdge, Vec3 };

export class EdgePickController {
  private candidates: TessellatedEdge[] = [];
  private mode: FilletSelectionMode = 'edge';
  private tolerance = 2;  // world units
  private loopTangencyThresholdDeg = 5;

  setCandidates(edges: TessellatedEdge[]): void {
    this.candidates = edges;
  }

  setMode(m: FilletSelectionMode): void {
    this.mode = m;
  }

  setTolerance(t: number): void {
    this.tolerance = t;
  }

  pick(point: Vec3): EdgeName[] | null {
    const hit = this.nearestEdge(point);
    if (!hit) return null;

    if (this.mode === 'edge') {
      return [hit.edgeName];
    }
    if (this.mode === 'loop') {
      const visited = new Set<string>();
      const queue: TessellatedEdge[] = [hit];
      const result: EdgeName[] = [];
      while (queue.length > 0) {
        const e = queue.shift()!;
        const key = edgeNameKey(e.edgeName);
        if (visited.has(key)) continue;
        visited.add(key);
        result.push(e.edgeName);
        for (const other of this.candidates) {
          if (visited.has(edgeNameKey(other.edgeName))) continue;
          if (shareEndpointWithSmallTangentChange(e, other, this.loopTangencyThresholdDeg)) {
            queue.push(other);
          }
        }
      }
      return result;
    }
    if (this.mode === 'feature') {
      const fid = hit.faceNames[0].featureId;
      return this.candidates
        .filter((e) => e.faceNames[0].featureId === fid && e.faceNames[1].featureId === fid)
        .map((e) => e.edgeName);
    }
    if (this.mode === 'all-fillets') {
      return this.candidates
        .filter((e) => (e.dihedralAngle ?? 180) > 180)
        .map((e) => e.edgeName);
    }
    if (this.mode === 'all-rounds') {
      return this.candidates
        .filter((e) => (e.dihedralAngle ?? 180) < 180)
        .map((e) => e.edgeName);
    }
    return null;
  }

  highlight(point: Vec3): EdgeName[] | null {
    return this.pick(point);
  }

  private nearestEdge(p: Vec3): TessellatedEdge | null {
    let best: { edge: TessellatedEdge; d: number } | null = null;
    for (const e of this.candidates) {
      for (const [a, b] of e.segments) {
        const d = distPointToSegment(p, a, b);
        if (d <= this.tolerance && (!best || d < best.d)) {
          best = { edge: e, d };
        }
      }
    }
    return best?.edge ?? null;
  }
}

function edgeNameKey(n: EdgeName): string {
  const fa = `${n.faceA.featureId}/${n.faceA.role}/${n.faceA.instance ?? 0}`;
  const fb = `${n.faceB.featureId}/${n.faceB.role}/${n.faceB.instance ?? 0}`;
  return `${fa}|${fb}`;
}

function distPointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = p.x - a.x, wy = p.y - a.y, wz = p.z - a.z;
  const c1 = vx * wx + vy * wy + vz * wz;
  if (c1 <= 0) return Math.hypot(wx, wy, wz);
  const c2 = vx * vx + vy * vy + vz * vz;
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy), p.z - (a.z + t * vz));
}

function shareEndpointWithSmallTangentChange(
  a: TessellatedEdge,
  b: TessellatedEdge,
  thresholdDeg: number
): boolean {
  // Two edges share an endpoint if any endpoint of `a`'s segment-chain matches any endpoint of `b`'s.
  // For MVP, just check the endpoints of the first/last segment in each.
  const aFirst = a.segments[0]!;
  const aLast = a.segments[a.segments.length - 1]!;
  const bFirst = b.segments[0]!;
  const bLast = b.segments[b.segments.length - 1]!;

  const aStart = aFirst[0];
  const aEnd = aLast[1];
  const bStart = bFirst[0];
  const bEnd = bLast[1];

  const aTangentStart = dir3(aStart, aFirst[1]);
  const aTangentEnd = dir3(aLast[0], aEnd);
  const bTangentStart = dir3(bStart, bFirst[1]);
  const bTangentEnd = dir3(bLast[0], bEnd);

  const eps = 0.01;
  const pts: Array<{ aPt: Vec3; bPt: Vec3; aTangent: Vec3; bTangent: Vec3 }> = [
    { aPt: aStart, bPt: bStart, aTangent: aTangentStart, bTangent: bTangentStart },
    { aPt: aStart, bPt: bEnd, aTangent: aTangentStart, bTangent: bTangentEnd },
    { aPt: aEnd, bPt: bStart, aTangent: aTangentEnd, bTangent: bTangentStart },
    { aPt: aEnd, bPt: bEnd, aTangent: aTangentEnd, bTangent: bTangentEnd }
  ];
  for (const { aPt, bPt, aTangent, bTangent } of pts) {
    if (Math.hypot(aPt.x - bPt.x, aPt.y - bPt.y, aPt.z - bPt.z) < eps) {
      // Endpoint matches. Check tangent alignment.
      const dot = aTangent.x * bTangent.x + aTangent.y * bTangent.y + aTangent.z * bTangent.z;
      const angle = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot))));
      const angleDeg = (angle * 180) / Math.PI;
      if (angleDeg <= thresholdDeg) return true;
    }
  }
  return false;
}

function dir3(a: Vec3, b: Vec3): Vec3 {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const mag = Math.hypot(vx, vy, vz);
  return mag > 0 ? { x: vx / mag, y: vy / mag, z: vz / mag } : { x: 0, y: 0, z: 0 };
}
