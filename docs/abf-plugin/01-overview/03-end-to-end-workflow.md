# End-to-End ABF Production Workflow

This page is the single-page mental model of the full ABF pipeline, from a raw SketchUp model to shop-floor parts. Read this before the per-stage docs — it tells you the order things happen in, which steps are hard gates you cannot skip, where configuration lives, and what is still roadmap (not shipped). Every claim here traces back to vendor site text (getabf.net), the plugin author's own forum posts, or tutorial-video transcripts; see the per-stage docs for full sourcing and verbatim quotes.

## Pipeline in Prose

At a glance, the eight stages and the ABF tool(s) that drive each one:

| # | Stage | Primary ABF tool(s) |
|---|-------|----------------------|
| 1 | Model | native SketchUp Groups, Push/Pull, naming |
| 2 | Convert components | "Convert Component to Group", "Face to Group" |
| 3 | Mark hardware/joints/grooves | hinge marking, perpendicular-connector marking (Manual/Quick), "Mark Intersection" (đánh dấu tiết diện giao nhau), edge-band assignment |
| 4 | Name/tag panels | "Đặt/Đổi tên tấm" (rename), "Đánh dấu tấm" (Mark/Label panel) |
| 5 | Nest | "Quick - Nesting" |
| 6 | Export DXF | "Xuất DXF" (Export DXF) |
| 7 | Print labels/BOM | "In tem nhãn" (Print labels), "Thống Kê" (Statistics) |
| 8 | Exploded view | "Explode View" |

### 1. Model — panels as Groups

Every panel starts life as a native SketchUp Group (right-click → Create Group), Push/Pulled to thickness, and named directly in the Outliner. It must be a true "Solid" (closed manifold volume) — a flat rectangle, not a hand-cut notch or cutout. See [The Solid-Group Input Contract](../02-model-setup/01-solid-group-contract.md) and [Practical Panel-Modeling Habits](../02-model-setup/02-panel-modeling-practice.md).

### 2. Convert components

ABF only reads Groups, never Components — the vendor states this explicitly ("ABF sẽ explode toàn bộ component chỉ giữ lại trạng thái 1 cấp Group"). Any model built with SketchUp Components (imported libraries, dynamic components, copied fixtures) must first go through "Convert Component to Group" (or the sibling "Face to Group" converter for a bare face). Conversion preserves parent/child grouping — a top-level module can stay a group with panel sub-groups inside it; it is each *panel* that must resolve to a single Group, not the whole model that must be flat.

### 3. Mark hardware, joints, and grooves

With clean Groups in place, the user marks machining geometry directly on the 3D model: hinge cup + mounting-plate bores, perpendicular connectors (confirmat, cam/eccentric, Minifix, Rafix, Cabineo, Lockdowel, dowels, shelf pins, branded slide systems), and groove/joinery geometry via the general-purpose "Mark Intersection" tool (double-click the male tenon panel after selecting an intersection type on the mating panel). Edge-banding assignment (manual or scenario-based) also happens here. See [Machining Primitives](../03-machining/01-machining-primitives.md) and [Hardware Boring and Groove Joinery](../03-machining/02-hardware-boring-and-joinery.md).

### 4. Name and tag panels

"Đặt/Đổi tên tấm" (rename) sets each panel's production name — sequence numbers, prefix/suffix clusters, material codes, saved name presets. "Đánh dấu tấm" (Mark/Label panel) then deletes and recreates the "ABF_Label" layer and adds an "ABF_label" sub-group to every qualifying panel, encoding the machining face and grain direction. In practice, renaming is often done early and can be revisited any time; label-tagging is the step that gates everything downstream (see Hard Gates below). Label placement doubles as an implicit geometry check: if it silently fails to attach, the panel face is deformed or front/back-asymmetric.

### 5. Nest

"Quick - Nesting" arranges tagged panels onto a standard/selectable board size. The vendor is explicit that this shows only the result of the *first* calculation pass — "nhanh nhất, dùng để tham khảo đặt vật tư" (fastest, for material-ordering reference only) — it is not an iterating/optimizing algorithm. A paid "PRO" tier with real optimization is stated to be in development, not shipped. Results are manually adjustable afterward with "FIND" (name-pattern select) plus "MORO – Move+Rotate" (move/rotate/flip, auto-snap, two-sided-sheet support); there is no re-run/re-optimize button. See [Nesting: Quick-Nesting vs. the Paused Cutting-Diagram Tool](../04-production-output/01-nesting.md).

### 6. Export DXF

"Xuất DXF" exports the nesting result, split into one folder per material or combined into a single file — the vendor states this is *currently* the only export scope ("ABF chỉ xuất kết DXF cho kết quả nesting"). DXF layer names are user-configurable per hardware/groove type; arcs use true circular interpolation per the plugin author. Whether hole/hardware positions are embedded as native DXF entities today, versus only riding along as separate "ABF_"-prefixed marker sub-groups, is an open tension in the source material — see [CNC/DXF Export Format and Options](../04-production-output/02-cnc-dxf-export.md) for the detail.

### 7. Print labels and BOM

"In tem nhãn" (Print labels) produces the physical/PDF shop tag per panel — panel ID, name, grain arrow, optional QR code (template 3) — and is explicitly gated on nesting having already run. "Thống Kê" (Statistics), reached once the model is exploded to the production stage, reports hardware counts, connectors, edge-band tape usage, and per-piece linear-material lengths, with optional unit pricing rolled into a quote and an Excel export. Two vendor-hosted web apps then consume that Excel downstream: "Qr Checker" reconciles produced parts by scanning each panel's QR code, and "QR Đóng gói" builds a packing/delivery slip. See [Panel Labels, Print Output, and BOM/Statistics](../04-production-output/03-labels-and-reports.md).

### 8. Exploded view

"Explode View" fans selected groups apart along calculated directions, with drag-adjustable spacing, camera rotation, auto leader-lines, and (per a later vendor update) an anti-overlap algorithm for label text — aimed at reducing confusion for assembly workers reading the diagram. Output goes through SketchUp's own "Export 2D Graphic" command (PDF demonstrated); ABF has no dedicated drawing-export dialog of its own. See [Working Drawings and Exploded Views](../04-production-output/04-drawings-and-exploded-views.md) for the mutation caveat below.

## Hard Gates

Some steps are optional or repeatable; a few are strict prerequisites the vendor states directly, or that the tooling silently depends on. Treat these as requirements our own pipeline must also enforce if we want ABF-equivalent behavior:

| Gate | Enforced by | What breaks if skipped |
|------|-------------|--------------------------|
| Component → Group conversion before any ABF tool | ABF reads Groups only | Unconverted Components are invisible to ABF — marking, naming, nesting, export all silently ignore them |
| Panel must be a Solid (closed manifold) | Label placement + reported export behavior | Label placement fails silently on deformed/asymmetric geometry; non-flat/notched groups export only their bounding-box outline (a known, developer-unaddressed limitation) |
| Label-tag ("Đánh dấu tấm" / ABF_Label) before breakdown/nesting/export | Vendor-confirmed: only labeled panels flow into breakdown/nesting/export | Untagged panels are excluded from the cut-list, nesting, and DXF pipeline entirely |
| Nesting before printing labels | Vendor text: "sau khi các bạn đã nesting rồi" (only after you've nested) | "In tem nhãn" is not usable pre-nest |
| Nesting before DXF export | Vendor text: DXF export always operates on "kết quả nesting" (the nesting result) | There is no non-nested DXF export path |
| Run Exploded View on a copy, not the live model | Not a tool-enforced gate — a strong vendor/tutorial caution | Exploded View creates a new detached Group and breaks the panel's live link back to the parametric model; running it on the production file corrupts that file for further edits |

Note the last row is a workflow *caution*, not a software-enforced gate — ABF will let you run Exploded View on the production model, it just detaches the exploded parts from live parametric editing when you do.

## Configuration vs. Per-Run Choices

ABF splits "set once" configuration from "choose every time" run parameters. Getting this split right matters for our own settings/preset design.

**Lives in settings/presets (configured once, reused across runs):**
- Hardware bore parameters (diameter, depth, article/SKU) and their target DXF layer name, per hardware type — user-configurable, savable as presets.
- Groove/intersection-marking type definitions: target machining layer, X-expansion/kerf tolerance, name — set up once per type.
- Grain-direction angle presets (used by "Edit - Flip: Label").
- Name presets for the rename tool (prefix/suffix clusters, name codes).
- Print-label header text presets (two free-text lines, savable/filterable/deletable).
- Optional company name shown on labels.
- Cutting-tool definitions (toolNumber, machining speed) and the DXF-layer-to-CAM-toolpath mapping — a one-time setup reused on every subsequent export.
- Hardware presets and unit prices, synced per user account via cloud login ("Export/Import Cloud Data"), with manual export/import for backup.

**Chosen per run (fresh each time):**
- Which board/sheet size to nest onto ("khổ ván tùy chọn" — selectable, not fixed).
- DXF export organization mode: per-material folders vs. one combined file.
- Manual nesting adjustments — FIND + MORO move/rotate/flip corrections to the auto-placed layout.
- Which material/thickness a given panel is assigned (this itself drives automatic panel-group separation at breakdown time).
- Per-panel machining-face and grain-direction overrides via "Edit - Rotate/Flip: Label" (applies a preset value, but the choice of *which* panel gets it is per-panel).
- Exploded-view spacing and camera angle for a given diagram.

## Roadmap Items Explicitly NOT Shipped Yet

The vendor's own site lists a "Các tính năng đang được xây dựng" (features currently being built) section, separate from the live feature list. Treat everything below as **not available today**, regardless of what a tutorial or third-party article might imply:

| Item | Status (vendor's own words) | What it would add |
|------|-------------------------------|---------------------|
| Combined DXF/XML export ("DXF/XML Tổ Hợp") | In active development, no pause flag | Edge-drilling positions embedded alongside per-part labels in the DXF/XML, plus support for unspecified "other machine manufacturers' input standards" |
| Panel-saw cutting diagram ("Sơ đồ cắt ván") | "Tạm dừng do nhu cầu thấp" — paused, low demand | Optimized part layout for beam/panel saws, with dimensions, cut-sequence diagram, and a grain-direction option — the classic guillotine cutting-map concept, distinct from CNC-router nesting |
| Manufacturer-outsourcing network ("Liên Kết Gia Công" / "Kết nối Nhà sản xuất") | "Tạm dừng bảo mật" — paused, security concerns | Direct connection from ABF to an outside manufacturing network |
| PRO nesting tier | "Bản PRO đang phát triển" — in development | Real iterative/optimizing nesting, beyond the current first-pass-only "Quick - Nesting" |
| Library management ("Quản lý Thư Viện") | Listed under the same "being built" section, no pause flag | Upload/download of shared parametric-module library content, updated daily |

Two implications for scoping our own work: (1) do not copy "combined DXF/XML with edge-drill positions" as if it were ABF's current baseline — it is aspirational; (2) ABF's live nesting is explicitly weaker than a general reader might assume from marketing copy (first-pass-only, reference-grade) — do not over-engineer parity against a PRO tier that has not shipped. See [Gap Analysis: ABF vs. ZilInventor by Aspect](../05-parity/02-gap-analysis.md) and [Processing Parity Requirements](../05-parity/03-processing-parity-requirements.md) for how these roadmap gaps translate into (or explicitly do not translate into) requirements for us.

## Related Docs

- [What ABF Is and Who Makes It](01-what-is-abf.md)
- [Video Walkthrough Summary (YARWOOD Tutorial)](02-video-walkthrough-summary.md)
- [The Solid-Group Input Contract](../02-model-setup/01-solid-group-contract.md)
- [Machining Primitives: Points, Paths, Intersections](../03-machining/01-machining-primitives.md)
- [Nesting: Quick-Nesting vs. the Paused Cutting-Diagram Tool](../04-production-output/01-nesting.md)
- [CNC/DXF Export Format and Options](../04-production-output/02-cnc-dxf-export.md)
- [Panel Labels, Print Output, and BOM/Statistics](../04-production-output/03-labels-and-reports.md)
- [Working Drawings and Exploded Views](../04-production-output/04-drawings-and-exploded-views.md)
- [ZilInventor's Existing Manufacturing-Processing Capabilities](../05-parity/01-zilinventor-capability-inventory.md)
