# Hardware Boring (Присадка) and Groove Joinery

This doc lists every hardware type ABF marks/bores holes for, how that boring data is expressed as machining metadata, and how ABF's groove-based joinery mechanism ("Mark Intersection") works. It builds on the primitives defined in [01-machining-primitives.md](01-machining-primitives.md) (point/path/intersection operations) and feeds directly into the [CNC/DXF export](../04-production-output/02-cnc-dxf-export.md) and [gap analysis](../05-parity/02-gap-analysis.md) docs.

Присадка (RU/UK, literally "fitting/attachment") is the umbrella term used across Slavic-language ABF tutorials for hardware-position marking and drilling. It covers every point-operation hole ABF places for cabinet hardware.

## Hardware catalog

ABF marks and bores positions for the following hardware types (source: plugin author's own forum reply in SketchUp Community thread 127578, plus multiple vendor tutorial titles):

| Hardware type | Description | Notes |
|---|---|---|
| Confirmat | One-piece cabinet screw (chipboard confirmat) | Common carcass-joint fastener |
| Cam/eccentric fastener ("эксцентрик") | Two-part cam-lock + dowel fastener | Standard RTA-furniture fastener |
| U-plastic connector | Plastic corner/panel connector | Named explicitly in vendor material |
| Minifix | Branded cam-lock connector (Häfele family) | Named explicitly |
| Rafix | Branded cam-lock connector (Häfele family) | Named explicitly |
| Cabineo | Blind, tool-free cam connector (Häfele) | Named explicitly |
| Lockdowel | Branded tool-free clip/tab joinery system | Has a dedicated official tutorial ("[ABF] Marking Lockdowel and create CNC Profile toolpath") pairing hole marking with a Profile Toolpath |
| Dowels ("шкант" / "chốt gỗ") | Plain wood dowel pins | Generic joinery dowel |
| Hinge cups | Concealed European hinge boring | Cup bore + arm-mount holes (exact diameters/depths not confirmed as ABF defaults — see Known gaps) |
| Shelf pins | Standard shelf-support pin holes | Includes named **K-LINE** shelf-support-bracket hardware, confirming ABF references real commercial brands/SKUs |
| Blum undermount slides | Branded drawer-slide boring | Positions generated via the intersection-marking mechanism against a proxy slide object (see below) |
| Häfele Matrix Box | Branded drawer-system boring | Named explicitly in vendor tutorials |

All entries above are **(unverified)** in the sense that exact default hole diameters/depths/setbacks were not found in any ABF-official source — see "Known gaps" at the end. The list of hardware *types* themselves is well corroborated (forum + vendor tutorials).

Per the plugin author, replying directly in the forum thread: "You can change the parameters, and the layer name in the settings" — hole parameters and the target DXF layer are user-configurable per hardware type, not hardcoded.

**Requirement for ZilInventor:** the hardware catalog must be modeled as a first-class, per-type configuration entity (name, hole geometry parameters, target output layer), not a fixed enum with hardcoded geometry. See ZilInventor's existing hardware catalog work (M1b.5, per auto-memory) as the closest existing analog — it should be checked against this list for coverage gaps (Cabineo, Lockdowel, K-LINE, Häfele Matrix Box are candidates to verify are present).

## Toolpath metadata per hardware type

Each ABF-defined cutting tool ("dao cụ") carries machining metadata that is exported alongside the hole/toolpath geometry:

| Field | Meaning | Source |
|---|---|---|
| `toolNumber` | Tool-holder slot identifier on the physical CNC's tool magazine | Vendor tutorial "[ABF] Marking Lockdowel and create CNC Profile toolpath" |
| Machining speed | Feed/spindle speed assigned to the tool | Same source |
| Machining depth | Cut depth for a **Profile Toolpath**; must be set so it matches the physical router bit actually loaded in that `toolNumber`'s slot on the real machine | Same source |

The `toolNumber` exists specifically to keep the DXF/CAM tool order in sync with the physical machine's tool magazine — if the exported tool order doesn't match what's physically loaded, the wrong bit cuts at the wrong depth. This is a **(plausible)**, single-source claim (one vendor video), not contradicted elsewhere.

Two named toolpath types recur across vendor material:

- **Profile Toolpath** — contour/edge-following cut (e.g., a Lockdowel slot).
- **Pocket Toolpath** — recessed material removal (e.g., grooves, 3D relief carving). A vendor bug-report video references a "vector overlap error when performing Pocket Toolpath," confirming this is a real, named operation mode in the plugin, not just marketing language.

**Requirement for ZilInventor:** every generated hole/groove/profile operation must carry `toolNumber` + speed + depth as exportable metadata, and depth must be validated against the tool actually assigned to that slot (or at minimum, flagged if unset) before DXF export — this is the mechanism that prevents a CNC operator from cutting a Lockdowel slot too shallow/deep with the wrong bit.

## Groove/joinery mechanism: Mark Intersection

ABF's core joinery primitive is called **"Mark Intersection"** in the English UI (quoted verbatim by a forum user) — "đánh dấu tiết diện giao nhau" ("mark intersecting cross-section") in the vendor's Vietnamese tutorials. It is a general-purpose, geometry-intersection-driven marker: given two solids that physically intersect, it marks a machining pocket on one solid based on where the other solid's geometry passes through it.

### Terminology

| Term | Meaning |
|---|---|
| Mộng | Tenon/mortise or housed joint (generic joinery term) |
| Mộng Dương | Male ("positive") joint member — the piece that plugs in |
| Mộng Âm | Female ("negative") joint member — the piece that gets the pocket cut into it |
| khéo giãn X | "X-stretch/expansion" tolerance on an intersection-marking type |
| hèm | Groove/rabbet (e.g. "bào hèm cho đáy lùa" = rout the groove for a sliding drawer bottom) |

### Workflow (per official tutorial, video `mM7Ly5DlIhQ`)

1. Open ABF settings, create a new intersection-marking type.
2. Name its target machining (DXF) layer.
3. Set the **X-expansion/stretch tolerance ("khéo giãn X")** to a value ≥ the router bit radius — this is kerf/bit-radius compensation for the pocket that gets cut.
4. Name and activate the cross-section type.
5. Select the "Mark Intersection" tool, choose that type, then **double-click the Mộng Dương (male/tenon) panel**.
6. ABF automatically marks the corresponding pocket/machining area on the mating **Mộng Âm (female/mortise) panel**.

This same intersection mechanism is reused (per vendor video `uB2kbsM-EYI`) to mark **Blum undermount drawer-slide routing positions**, by intersecting a proxy/virtual slide object ("mượn đối tượng ảo") against the cabinet side panel — i.e. hardware-slide marking and tenon/mortise joinery marking are the *same underlying tool*, just applied to different geometry pairs. This is corroborated by a second independent tutorial and treated as **(plausible)**, not contradicted.

### Dedicated groove tooling

Separate from Mark Intersection, a dedicated groove tool handles back-panel dado/rabbet cutting (vendor template video `iLGVAYPO2uc`):

- "bào hèm cho đáy lùa" — rout the rabbet/groove for a sliding/captured bottom panel.
- "bào mộng" — cut the tenon/mortise groove itself.

Each is assigned to its own named machining layer. Additional named milling operations confirmed in vendor material:

- **Keyhole slot** creation — wall-hanger keyhole slot routing ("tạo đường chạy rãnh lỗ móc gài Keyhole").
- **Tenon/mortise joints for CNC production** — an explicit, dedicated tutorial ("[ABF DC] creating tenon joints for the production of cabinets panel with CNC on SketchUp") confirms full mortise/tenon joint support.

**Correction to an earlier limitation report:** a 2021 SketchUp Community forum post claimed ABF "only will do boxes" — no mortise or cutout export for back panels. This was an **early plugin limitation, not a current one**. Current vendor tutorials clearly demonstrate groove, pocket, keyhole, and tenon/mortise machining. Do not treat the 2021 report as current behavior.

### Toolpath type used for grooves

Grooves/pockets are cut as **Pocket Toolpath** operations (recessed material removal), distinct from the **Profile Toolpath** (contour-following, e.g. Lockdowel slots) used for edge-following cuts. See the toolpath metadata table above — both types carry `toolNumber` + speed + depth.

**Requirement for ZilInventor:** joinery marking must be modeled as a general intersection-based operation (given two intersecting solids, compute the pocket on one from the penetration of the other), not as hardcoded per-joint-type logic — this lets the same mechanism serve tenon/mortise joints, drawer-bottom grooves, and hardware-slide routing without three separate code paths. The kerf/bit-radius compensation ("X-stretch") must be a configurable tolerance on the operation, not baked into geometry at authoring time. Cross-reference against ZilInventor's existing dado/groove cut feature (M1a.3) (regenerable `GrooveFeature`, per auto-memory) — that feature is a plausible existing analog for the "Pocket Toolpath"-style groove, but was not built against ABF's Mark Intersection semantics and may need generalization to also drive hardware-slide-routing and tenon/mortise marking from the same code path.

### Face assignment (TOP/BOT)

ABF terminology distinguishes **mặt TOP** / **mặt BOT** (top face / bottom face) per panel. For two-sided machining, the ABF MORO nesting-editing module generates a colored **flip-fence reference axis line** ("đường trục cắt ke lật mặt") so the CNC operator can correctly re-register the panel on the machine table after flipping it to cut the BOT face. A separate, explicit "flip face for the connector" operation ("ĐẢO MẶT CHO LIÊN KẾT KHI MÔ PHỎNG HOẶC SAU KHI ĐÁNH DẤU") lets a user reassign which face a given hardware bore machines on **after** initial placement, not only at creation time. Both are **(plausible)**, single-source claims from vendor tutorial titles.

**Requirement for ZilInventor:** every bore/groove operation needs a face assignment (top/bottom of the panel's machining stock) that is editable post-placement, and two-sided nested parts need a reference-alignment marking exported to DXF so a shop operator can physically re-register the panel after flipping.

## Presets and per-project parameter overrides

Hole parameters (diameter, depth, offsets, etc.) and the destination DXF layer name are **configurable per hardware type** in ABF's settings, not hardcoded per-install defaults. These configurations can be saved as reusable **"Preset"** sets and reused across projects.

What is confirmed:
- Parameters and layer names are user-editable per hardware type (direct quote from the plugin author).
- Configurations are savable/reusable as presets.

What is **not** established (see Known gaps below):
- The exact default numeric values ABF ships with per hardware type.
- The exact dialog/field layout for editing these parameters.
- Whether preset scope is global, per-project, or both.

**Requirement for ZilInventor:** hardware boring parameters must live in an editable, savable preset structure (name → {hole geometry, target layer, tool metadata}), reusable across cabinet projects, with the ability to override at the per-project or per-instance level. This should reuse or extend ZilInventor's existing hardware-catalog infrastructure rather than introducing a second parallel config system — flag this for reconciliation in the [gap analysis](../05-parity/02-gap-analysis.md).

## Known gaps

The following could not be established from available sources (would require installing ABF and opening its dialogs, or a paid ABF DC account):

- Exact default numeric values (hole diameters, depths, edge setbacks) per hardware type. A third-party site (3dshouse.com) cites specific hinge-cup numbers (35mm forstner bit, 9.5mm depth, 22.5mm setback), but these read as generic European-hinge-industry defaults, not confirmed ABF-specific values — **do not treat as ABF fact**.
- Exact dialog/panel layout and field names in ABF's SketchUp UI for hardware parameters.
- The precise algorithm for how mating-panel drilling is generated for asymmetric hardware pairs (which panel gets which hole, how offset is computed).
- Whether groove width/depth is auto-derived from panel thickness/material assignment, or always manually specified. (A superficially similar technique — "select panel, set material to HDF, click groove button, contour appears" — was observed in an unrelated plugin, **kotpanel**, not ABF, and must not be attributed to ABF.)
- Full semantics of "khử dao" (tool-elimination/relief mode toggle) — title-only evidence, no walkthrough found.
- Whether "FIND" is the actual mechanism computing intersection-based hardware marking, or a separate part-search/QA utility reused loosely in one template video.

No canonical written parameter-reference manual from ABF was found; all detail above was reconstructed from vendor YouTube tutorial titles/descriptions and forum Q&A (see [02-video-walkthrough-summary.md](../01-overview/02-video-walkthrough-summary.md) for the primary tutorial this doc set is grounded in, and [01-what-is-abf.md](../01-overview/01-what-is-abf.md) for source reliability notes).
