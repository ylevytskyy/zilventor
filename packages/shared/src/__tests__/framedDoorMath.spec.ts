import { describe, it, expect } from 'vitest';
import { computeShakerParts, type ShakerPart } from '../framedDoorMath';

// Convention (mirrors doorMath's DoorPanel): dims.length = the part's vertical
// (height) extent, dims.width = horizontal extent. Stiles run full door height;
// rails span horizontally between the two stiles; the center panel fills the
// inner opening.

function byRole(parts: ShakerPart[], role: ShakerPart['role']): ShakerPart[] {
  return parts.filter((p) => p.role === role);
}

describe('computeShakerParts', () => {
  it('600×900 outer with 70mm frame → center panel 460×760', () => {
    const { parts } = computeShakerParts({ doorW: 600, doorH: 900, thickness: 18, frameWidth: 70 });
    const panels = byRole(parts, 'doorCenterPanel');
    expect(panels).toHaveLength(1);
    // 460 wide (600 − 2×70), 760 tall (900 − 2×70)
    expect(panels[0]!.dims.width).toBe(460);
    expect(panels[0]!.dims.length).toBe(760);
  });

  it('produces 5 members: 2 stiles + 2 rails + 1 center panel', () => {
    const { parts } = computeShakerParts({ doorW: 600, doorH: 900, thickness: 18, frameWidth: 70 });
    expect(parts).toHaveLength(5);
    expect(byRole(parts, 'doorStile')).toHaveLength(2);
    expect(byRole(parts, 'doorRail')).toHaveLength(2);
    expect(byRole(parts, 'doorCenterPanel')).toHaveLength(1);
  });

  it('stiles run full door height (900×70); rails span between stiles (460×70)', () => {
    const { parts } = computeShakerParts({ doorW: 600, doorH: 900, thickness: 18, frameWidth: 70 });
    for (const s of byRole(parts, 'doorStile')) {
      expect(s.dims.length).toBe(900); // full height
      expect(s.dims.width).toBe(70);
    }
    for (const r of byRole(parts, 'doorRail')) {
      expect(r.dims.length).toBe(70); // rail height = frame width
      expect(r.dims.width).toBe(460); // horizontal span between stiles
    }
  });

  it('all frame members carry the door thickness; center panel defaults to it too', () => {
    const { parts } = computeShakerParts({ doorW: 600, doorH: 900, thickness: 18, frameWidth: 70 });
    for (const p of parts) expect(p.dims.thickness).toBe(18);
  });

  it('center panel thickness override is honored', () => {
    const { parts } = computeShakerParts({
      doorW: 600,
      doorH: 900,
      thickness: 18,
      frameWidth: 70,
      panelThickness: 6,
    });
    expect(byRole(parts, 'doorCenterPanel')[0]!.dims.thickness).toBe(6);
  });

  // -------------------------------------------------------------------------
  // Poses are in the DOOR'S part-local frame (identical to the slab door's part
  // frame, so the nested .ziasm can be placed at the very same pose a slab door
  // panel gets — see AddDoorCommand). Frame: origin = door center on the back
  // face; part-X = vertical (height), part-Y = horizontal (width), part-Z =
  // thickness (0..Td). Each member panel is built [-L/2,-W/2,0]..[L/2,W/2,T];
  // its part centroid = (0,0,T/2). Because every member's dims convention
  // (length=vertical, width=horizontal) matches the door-part axes, every
  // member's quaternion is IDENTITY and only the translation differs.
  //   pose.translation = memberCentroid − (0,0,T/2)
  // -------------------------------------------------------------------------
  const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];

  it('every member carries an identity quaternion (door-part frame)', () => {
    const { parts } = computeShakerParts({ doorW: 600, doorH: 900, thickness: 18, frameWidth: 70 });
    for (const p of parts) expect(p.pose.quaternion).toEqual(IDENTITY);
  });

  it('stiles sit at the left/right edges; rails at top/bottom; panel centered', () => {
    const { parts } = computeShakerParts({ doorW: 600, doorH: 900, thickness: 18, frameWidth: 70 });
    const f = 70, doorW = 600, doorH = 900;
    const left = byRole(parts, 'doorStile').find((p) => p.isLeft)!;
    const right = byRole(parts, 'doorStile').find((p) => !p.isLeft)!;
    const bottom = byRole(parts, 'doorRail').find((p) => !p.isTop)!;
    const top = byRole(parts, 'doorRail').find((p) => p.isTop)!;
    const panel = byRole(parts, 'doorCenterPanel')[0]!;

    // Stiles: vertical-centered (X=0), at horizontal ±(doorW−f)/2, mid-thickness (Z=0 since Tm=Td)
    expect(left.pose.translation).toEqual({ x: 0, y: -(doorW - f) / 2, z: 0 });
    expect(right.pose.translation).toEqual({ x: 0, y: (doorW - f) / 2, z: 0 });
    // Rails: horizontal-centered (Y=0), at vertical ±(doorH−f)/2
    expect(bottom.pose.translation).toEqual({ x: -(doorH - f) / 2, y: 0, z: 0 });
    expect(top.pose.translation).toEqual({ x: (doorH - f) / 2, y: 0, z: 0 });
    // Center panel: dead center, mid-thickness
    expect(panel.pose.translation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a thinner center panel is recessed to the door mid-plane (z offset)', () => {
    const { parts } = computeShakerParts({
      doorW: 600,
      doorH: 900,
      thickness: 18,
      frameWidth: 70,
      panelThickness: 6,
    });
    // centroid Z = Td/2 = 9; offset (0,0,panelTd/2)=(0,0,3) → translation z = 9 − 3 = 6
    expect(byRole(parts, 'doorCenterPanel')[0]!.pose.translation.z).toBe(6);
  });
});
