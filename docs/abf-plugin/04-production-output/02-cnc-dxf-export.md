# CNC/DXF Export Format and Options

This document specifies exactly what ABF's CNC export contains today, based on the vendor's current site (getabf.net, fetched 2026-07-01) and the official SketchUp Community forum thread where the developer account "baoca" answers export questions directly. It is the concrete target format for ZilInventor's own CNC/DXF export. Where a claim is unverified or only plausible, it is marked as such — do not implement against it as if it were confirmed.

See [Nesting](01-nesting.md) for the step that must run before export, and [Machining Primitives](../03-machining/01-machining-primitives.md) for how points/paths/intersections feed hardware positions into machining output.

## DXF-only today; no MPR/WoodWOP/XNC/GIB/BXX/F4G native formats, despite common CNC-industry expectation

ABF exports **DXF only**. There is no evidence — in the vendor site, vendor forum posts, tutorial-video captions, or third-party writeups — that ABF currently emits any native CNC machine-program format: no MPR/WoodWOP, XNC, GIB, BXX (Biesse), or F4G. This may surprise anyone used to furniture-CNC ecosystems where MPR/WoodWOP-style native export is standard; ABF does not currently do it.

The vendor's own roadmap ("Các tính năng đang được xây dựng" — "features currently being built") lists a **"DXF/XML Tổ Hợp"** ("Combined DXF/XML") item whose description mentions exporting "DXF, XML, or other machine manufacturers' input standards" — but no specific non-DXF format is named, and the item is explicitly not yet shipped (see the last section below). Two unrelated tools surfaced during research — "OneClick" (a different SketchUp extension exporting .NC/.MPR/.CIX directly) and mebel-pro.one (a separate furniture-nesting product with documented WoodWOP/ViyarPRO exporters) — are **not ABF** and must not be attributed to it.

**Requirement for ZilInventor:** don't assume ABF parity implies native machine-code export. Matching ABF's current capability means shipping a solid DXF exporter; native-format export (WoodWOP/MPR/XNC/etc.) is a ZilInventor-only ambition beyond anything ABF has shipped, not a parity requirement.

## Export always operates on the nested layout (nest-before-export gate)

DXF export is not available directly off the raw model. It operates on the **result of the nesting step** ("Quick - Nesting" — see [Nesting](01-nesting.md)). The vendor's own feature description states this as a hard gate:

> "Hiện tại ABF chỉ xuất kết DXF cho kết quả nesting..." — "Currently ABF only exports DXF for the nesting result..."

In other words: model panels → mark them (ABF_Label) → nest onto sheets → export DXF from the nested sheets. There is no path that skips nesting.

**Requirement for ZilInventor:** the CNC/DXF export command should be gated on (or driven by) an existing nested sheet layout, not a standalone "export all panels" action. This mirrors ZilInventor's existing M2.2 nesting/sheet-layout DXF feature (one DXF per NestSheet), which already follows this pattern.

## Two organization modes: per-material subfolders vs single combined file (user choice, no ZIP)

The vendor states export has exactly two organization modes, user-selectable, no third option:

| Mode | Behavior |
|---|---|
| Per-material folders | DXF output is split into separate folders, one per material |
| Combined file | All nested output is exported together into a single DXF file |

Verbatim vendor text (Vietnamese): "...phân tách theo từng thư mục vật liệu hoặc xuất chung thành 1 file" ("...split by material folder, or exported combined into 1 file").

No primary source mentions ZIP packaging in either mode. (A ZIP-per-material pattern does exist in the unrelated mebel-pro.one product's WoodWOP/ViyarPRO exporters — useful only as an ecosystem analogy, not evidence of ABF behavior.) Whether ABF produces one DXF file per sheet within each mode is **not stated** by any primary source; a third-party marketing article claims "one DXF file per sheet" but this is unverified (see the last section).

**Requirement for ZilInventor:** offer both organization modes as an explicit user choice at export time (per-material subfolders vs. single combined DXF). Do not assume ZIP packaging is required to match ABF — ZilInventor's own nesting DXF export already zips per-sheet files (M2.2), which is a legitimate design choice but goes beyond what's confirmed for ABF.

## User-configurable layer names in settings

The developer states directly, in the forum thread, that DXF layer names are **not fixed** — they are configured by the user in ABF's settings:

> "You can change the parameters, and the layer name in the settings."

No default/canonical layer-name list is documented anywhere in primary sources. A third-party article claims a fixed five-layer taxonomy ("panel outline, hinge bore circles, connector/screw holes, groove paths, fold lines") — this is **unverified** and possibly invented; treat it as unconfirmed, not as ABF's actual default schema.

Separately, panel-level marker metadata does use one confirmed, fixed name: the **"ABF_Label"** layer/tag, created and repopulated by the "Mark Panel" tool, holding a per-panel "ABF_label" marker sub-Group that defines the machining face and grain direction (see the machining-face note below). Hardware/marker geometry is modeled as separate flat 2D sub-Groups whose names start with the prefix **"ABF_"**, which the nesting/export step specifically recognizes.

**Requirement for ZilInventor:** DXF export should expose configurable layer names (a settings panel, not hardcoded strings), since ABF treats this as user-configurable rather than a spec ZilInventor can copy verbatim. Do not hardcode a fixed five-layer taxonomy against the unverified third-party claim.

## Circular/arc interpolation for curves (true ARC/CIRCLE entities, not tessellated polylines)

The developer states directly: "...DXF has been circularly interpolated." Read plausibly (not stated explicitly), this means curved geometry is exported as true DXF `ARC`/`CIRCLE` entities rather than as polyline-tessellated approximations of curves. This specific ARC/CIRCLE-entity interpretation is **inferred**, not a verbatim vendor claim — flag it as such if implementing strictly.

**Requirement for ZilInventor:** where the existing DXF exporters use ARC entities for curves (ZilInventor's DXF work already establishes ARC=DEGREES conventions per the M1 milestone), that already matches ABF's stated behavior. Do not regress to tessellated-polyline output for curved panel edges when targeting ABF parity.

### Known limitation: flat-outline-only export, not full 3D unfold

Independent of layer/curve behavior, forum users report a real, developer-unaddressed limitation: ABF's export only captures a panel Group's flat outline — its **largest planar face**, per a third-party workflow guide's description of the panel-detection algorithm — not embedded 3D cutout/mortise geometry. Quotes:

- selfsufficient: "It appears to only export completely flat surfaces... doesnt export groups that have details like cutouts for back panels to slide in."
- DaveR: "I expect it only exports the group bounding boxes."
- selfsufficient: "It only will do boxes... I usually manually rotate the parts and flatten the parts to export."

This is a confirmed ABF limitation, not a spec to copy. If ZilInventor's CNC export already handles panels with interior 3D-modeled cutouts/mortises correctly, that is an area where ZilInventor can exceed ABF rather than match it.

### Machining face and hardware geometry (context, not export format)

The "machining face" of a panel is explicitly and manually defined by a user-placed "ABF_label" marker object (created by "Mark Panel"), and can be redefined per-panel by an "Edit - Rotate: Label" tool; a separate "Edit - Flip: Label" tool sets grain direction from the same label's rotation. Two-sided-panel arranging is supported during nesting ("MORO - Move+Rotate"), and a tutorial video appears to show manual per-part face-flipping before export — this specific video-sourced detail is weak evidence (garbled auto-captions) and should be treated as plausible, not confirmed.

Hardware/marker positions (hinges, screws, etc.) are modeled as separate flat 2D sub-Groups named with an "ABF_" prefix, recognized by the nesting engine and carried into the export alongside the panel outline. Whether these currently reach the DXF as **native** entities (circles/points) in the shipped export, or only as separate flattened marker geometry, is **not resolved** by any source — this is the single biggest open uncertainty for spec-writing purposes (see next section: the vendor's own roadmap lists embedded hole-position export as not-yet-built, which is in tension with a third-party claim that it already exists).

No primary source states the DXF coordinate-origin convention (which sheet corner is 0,0, axis direction) — this remains an open gap.

## Roadmap-only "Combined DXF/XML" with edge/hole positions + labels — NOT shipped, do not assume it exists

The vendor's static roadmap block lists a feature named **"DXF/XML Tổ Hợp"** ("Combined DXF/XML") described as:

> "Xuất DXF, XML hoặc các tiêu chuẩn đầu vào của các nhà sản xuất máy móc khác... Vị trí khoan cạnh cùng tem nhãn chi tiết" — "Export DXF, XML, or other machine manufacturers' input standards... edge/hole drilling positions plus part labels."

This is listed under "features currently being built" — explicitly **not shipped**. It is distinct from, and more feature-rich than, the current "Export DXF" feature described in the sections above. Do not treat embedded hole-position/label export as an existing ABF capability; it is a stated future direction only, with no committed format or timeline.

Two other roadmap items confirm ABF is file-export-only today, with no live machine link:

| Roadmap item | Status (vendor's own words) |
|---|---|
| "Sơ đồ cắt ván" (sheet cutting diagram, for saw machines) | "Tạm dừng do nhu cầu thấp" — paused, low demand |
| "Liên Kết Gia Công" (direct machine/manufacturer connection) | "Tạm dừng bảo mật" — paused, security reasons |
| "DXF/XML Tổ Hợp" (combined DXF/XML with embedded hole positions + labels) | Not yet shipped |

**Requirement for ZilInventor:** if ZilInventor implements embedded hardware-position/label data directly in its DXF (which ZilInventor's own manufacturing DXF and per-panel shop-labels PDF work already partially does — see M2.1 and M2.3 in project memory), that is **ahead of ABF's current shipped state**, not parity. Frame it as a ZilInventor advantage, and don't cite ABF as prior art for it.

## Unverified third-party claims (do not implement against these)

A third-party marketing article (3dshouse.com/abf-plugin, not vendor-authored) makes specific technical claims that could not be corroborated by any vendor or forum source, and in one case conflicts with the vendor's own roadmap labeling:

| Claim | Status |
|---|---|
| DXF version "R2010" | Unverified |
| Fixed 5-layer taxonomy (outline, hinge bores, connector holes, groove paths, fold lines) | Unverified |
| Hinge-bore geometry baked into DXF at 35 mm forstner / 9.5 mm depth | Unverified — conflicts with vendor roadmap marking embedded hole-position export as not-yet-built |
| Groove/dado paths as polylines on their own layer | Unverified |
| One DXF file per sheet | Unverified |
| CAM compatibility tested with Aspire, Mastercam, AlphaCAM | Unverified |

The same article's claim of the developer's identity ("Dang Phi Bao") is credible — independently corroborated by getabf.net's own Telegram link (t.me/dangphibao) and the forum developer account handle "baoca" — but that corroboration does not extend to the DXF technical specifics above. Do not use this table as an implementation spec; use it only to recognize claims a hands-on test of ABF would need to confirm.

## Open gaps

Not established by any available source:

- Exact DXF coordinate-origin convention (sheet corner, axis direction).
- Canonical default DXF layer names (layer names are user-configurable in ABF's settings; no single default schema is documented).
- DXF version/flavor (only the unverified "R2010" third-party claim exists).
- Whether hardware-drilling geometry is embedded as native DXF entities in the current shipped export, or only exists as separate "ABF_"-prefixed flat marker sub-Groups nested alongside the panel.
- Whether ZIP packaging exists for the per-material-folder export mode.

## Related

- [Nesting: Quick-Nesting vs. the Paused Cutting-Diagram Tool](01-nesting.md) — the step DXF export depends on.
- [Panel Labels, Print Output, and BOM/Statistics](03-labels-and-reports.md) — downstream artifacts produced alongside export.
- [Machining Primitives](../03-machining/01-machining-primitives.md) — points/paths/intersections vocabulary referenced by hardware-marker geometry.
- [Hardware Boring and Groove Joinery](../03-machining/02-hardware-boring-and-joinery.md) — what the still-unshipped "hole drilling positions" export would need to carry.
- [Gap Analysis: ABF vs. ZilInventor by Aspect](../05-parity/02-gap-analysis.md) — where CNC/DXF export sits in the overall parity picture.
