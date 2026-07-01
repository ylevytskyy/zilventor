# Nesting: Quick-Nesting vs. the Paused Cutting-Diagram Tool

ABF has two separately-named, separately-shipped nesting-adjacent features. They are easy to conflate because both arrange panels onto sheet stock, but they solve different problems and have different maturity levels. This doc keeps them apart so ZilInventor's own nesting work (`docs/superpowers/plans/2026-06-23-m2.2-nesting-dxf.md`, shipped as M2.2 — see [Notes for ZilInventor](#notes-for-zilinventor-what-our-app-must-not-copy-blindly)) is scoped against what ABF actually ships, not what its marketing implies.

| Feature | Vendor name | Status | Target machine |
|---|---|---|---|
| Quick-Nesting | "Quick - Nesting" | Shipped, free | CNC router / nesting machine |
| Cutting diagram | "Sơ đồ cắt ván" (panel cutting diagram) | **Paused, not shipped** | Panel saw / beam saw |

## Quick-Nesting: single-pass, first-calculation-only, reference-only

ABF's only currently-shipped nesting tool is called **"Quick - Nesting."** The vendor's own description (translated from Vietnamese):

> "Arranges panels onto a standard board size, displays the result of the first calculation pass, the fastest [method], used as a reference for ordering materials — a PRO version is under development."

Three things follow directly from that sentence, and all three are vendor-stated, not inferred:

1. **First-pass only.** The algorithm runs once and shows that result. There is no re-run/re-optimize button in the free tier.
2. **Explicitly reference-only.** The vendor frames the output as "tham khảo đặt vật tư" — a reference for material ordering — not as a production-ready cutting plan. Treat Quick-Nesting's sheet count and utilization as an estimate for procurement, not a guaranteed final layout.
3. **Free today.** All current ABF features, including Quick-Nesting, are free — see [`01-overview/01-what-is-abf.md`](../01-overview/01-what-is-abf.md#pricing-model).

Because the pass is single-shot, ABF supplies manual correction tools instead of a re-optimize loop (see [Manual correction after the first pass](#manual-correction-after-the-first-pass-no-re-optimize-button) below).

During a nesting run, ABF validates each part against the configured sheet dimensions and warns when a part falls outside them ("có chi tiết nằm ngoài kích thước cài đặt" — "there is a part outside the configured [sheet] dimensions"); when a part is rejected from a sheet, the tool automatically renumbers the remaining cut sequence around it (observed numbering jump: `1 2 3 4 5 6 7 8 8 1 9 10 11`). *(unverified — sourced from a single tutorial-video transcript, no vendor-site corroboration.)*

## PRO nesting tier: in development, not yet shipped

The same feature card that describes Quick-Nesting states a PRO version ("bản PRO đang phát triển") is under development. This is the vendor's own confirmation that:

- No optimizing/iterating nesting engine exists in the free tier today. What ships is the first-pass, reference-only tool described above.
- The scope, pricing, and release date of the PRO tier are **not stated anywhere in the source material.** Do not invent numbers for it. See [`01-overview/01-what-is-abf.md`](../01-overview/01-what-is-abf.md#confidence-notes-known-uncertainties) for the same caveat in context.

**Implication for ZilInventor:** don't treat "ABF has nesting" as evidence that ABF has *optimized* nesting. As of this research, it doesn't — the free tier is a single deterministic pass plus hand-editing tools, and the optimizing version is roadmap-only.

## Sơ đồ cắt ván (panel-saw cutting diagram): fully specified but paused

A second, distinct feature targets panel saws (guillotine/beam-saw cutting) rather than CNC routers. The vendor's own roadmap section ("Các tính năng đang được xây dựng" — features currently being built) lists it as:

> "Function for optimal arrangement of parts on a selectable board stock, displaying dimensions and a cut-sequence diagram, grain-direction option, exports necessary information."

Status label on the same tile: **"Dành cho máy cưa"** (for saw machines) / **"! Tạm dừng do nhu cầu thấp"** (paused due to low demand).

This is the ABF analogue of a traditional карта розкрою (cutting map) for guillotine panel saws — straight-line rip/crosscut sequencing, as opposed to free-form CNC-router nesting. Key distinctions from Quick-Nesting:

| Aspect | Quick-Nesting | Sơ đồ cắt ván (cutting diagram) |
|---|---|---|
| Status | Shipped, live | **Paused / not available** |
| Target machine | CNC router / nesting machine | Panel saw / beam saw |
| Output | Sheet layout only | Sheet layout **+ cut-sequence diagram** |
| Grain option | Not a dialog option (see below) | Would have been a dialog option, per the spec |
| Optimization | First-pass only | Described as "optimal arrangement" — never shipped to confirm |

Despite being fully specified in the roadmap copy (optimal placement, dimensions, cut-order diagram, grain-direction option, export), it is explicitly not currently active. **Do not build ZilInventor's guillotine/beam-saw cutting-map feature assuming ABF already has a working reference implementation to match against — it doesn't.** ZilInventor's own DXF/nesting work should be judged against Quick-Nesting's actual shipped behavior, not the aspirational cutting-diagram spec.

## Grain direction: a panel Label object, not a nesting-dialog option

Grain direction ("chiều vân gỗ") is **not** a checkbox or field inside either nesting dialog. It is defined per panel via a separate labeling object:

- **"Đánh dấu tấm" (Mark/Label panel)** — deletes and recreates an `ABF_Label` layer, then adds/groups an `ABF_Label` object onto each compliant panel Group. This object encodes both the machined face and the grain direction for that panel.
- **"Edit - Flip: Label"** — redefines grain direction by rotating the `ABF_Label` object's angle. Supports savable angle presets, so a shop can standardize grain-rotation conventions across jobs.

Consequence: grain constraint is a **per-panel attribute attached before nesting runs**, not a parameter you set when you invoke Quick-Nesting. If ZilInventor wants nesting to respect grain direction, the grain flag needs to live on the panel/part record itself (analogous to `ABF_Label`), and the nesting algorithm needs to read it from there — not from a nesting-run options dialog. The roadmap-only cutting-diagram tool is the one place ABF's own spec proposes a grain option live *inside* a nesting dialog, and that tool is paused.

## Board-size input ("khổ ván chuẩn") and standard-sheet assumptions

Both tiles reference sheet stock by the same phrasing pattern:

- Quick-Nesting: "khổ ván chuẩn" — a **standard** board/sheet size.
- Cutting diagram (paused): "khổ ván tùy chọn" — a **selectable** board stock.

Neither vendor source states an actual numeric sheet size, unit, or default (e.g. no confirmed "2440×1220 mm" or similar). A third-party SEO blog (3dshouse.com) claims specific numbers — sheet size 2440×1220mm, a kerf-width field (3–4mm panel saws / 6–8mm routers), DXF format "R2010," a utilization-percentage preview, and an "off-cuts as usable stock" toggle — but none of these are corroborated by getabf.net, the developer's forum posts, or the tutorial transcripts, and that page's generic SEO-article structure and unconfirmed authorship attribution make it low-trust. **Treat all of these specific numbers as unverified and possibly fabricated; do not use them as authoritative spec input.**

What is confirmed:

- Sheet size is a configurable input, not hardcoded (the tutorial's "part outside the configured dimensions" warning implies a per-job configured sheet size exists).
- No confirmed kerf/blade-width parameter exists in either tool — whether ABF's nesting UI even has a numeric kerf input is unconfirmed by any primary source.
- No confirmed remnant/offcut stock-inventory system exists across jobs. A related tool, **"MORO - Last cut,"** draws a trim line separating the used region of a sheet from the leftover ("ván thừa") portion after production parts are cut, and generates a label for that remnant — but this looks like per-job remnant labeling, not persistent cross-job stock tracking.

**Implication for ZilInventor:** if a numeric default sheet size or kerf value is needed, get it from a hands-on plugin run or ask the user, not from the 3dshouse figures.

## Manual correction after the first pass (no re-optimize button)

Because Quick-Nesting runs once, ABF's own Tips guide ("[Tips] Hiệu chỉnh kết quả nesting" — adjusting nesting results) instructs users to hand-correct the layout using two tools together:

- **FIND** — select objects by name-pattern.
- **MORO - Move+Rotate** — move, rotate, or separate parts, with auto-snap/alignment support and "2-mặt" (two-face) sheet arrangement.

A related tool, **"MORO - Move to Layer,"** assigns nested panels to different SketchUp Layers per scenario (optionally auto-splitting by sequence number), used to express cutting order/sequence — since SketchUp has no native cut-sequence concept, ABF piggybacks it onto Layer assignment. The roadmap DXF/XML item ("DXF/XML Tổ Hợp") intends to eventually surface this as native per-operation DXF layers, but that item is itself unshipped.

A companion feature, **"Nesting đối tượng ABF_,"** extends nesting to internal 2D profile/cutout groups embedded inside a panel (objects named with an `ABF_` prefix) — used for complex internal cut paths (e.g. decorative patterns) on panels with too many edges to nest as a plain rectangle.

## Real-world usage caveat: some shops bypass ABF nesting entirely

A Ukrainian production-workflow tutorial (YARWOOD channel) states plainly that its presenter's shop community does not use ABF's built-in nesting or its "DXF export for nesting" feature at all:

> "ми нестінгом не користуємося... ми експортуємо dxf розкладки... за допомогою експорта dxf окремим плагіном" — "we don't use nesting... we export DXF layouts using a SEPARATE DXF-export plugin."

Their stated reason: their shops run straight-line "формат" (panel/beam-saw format-cut) machines from ВіЯр (Viyar), and Viyar's own downstream platform performs sheet-layout optimization after import — bypassing CNC-router nesting entirely. *(unverified — single tutorial source, but internally consistent and directly relevant: it means a meaningful share of ABF's real Ukrainian user base treats Quick-Nesting as skippable, exporting panel data to a separate optimization platform instead.)*

**Implication for ZilInventor:** don't assume every user wants in-app nesting optimization. A DXF/panel-data export path that a downstream ERP or cutting-optimizer can consume directly is a legitimate parallel workflow, not a fallback for a missing feature. ZilInventor's DXF export is covered in [`04-production-output/02-cnc-dxf-export.md`](02-cnc-dxf-export.md).

## Notes for ZilInventor (what our app must not copy blindly)

- Do not model ABF's nesting as a mature, optimizing engine. It is a free, single-pass, reference-only tool today; the optimizing tier is unshipped roadmap.
- Do not put grain direction inside a nesting-run dialog. Model it as a per-panel attribute (ZilInventor's own M2.2 nesting/DXF work — see auto-memory `project_m2_2_nesting_dxf_feature` — should confirm whether grain is already tracked per-panel or per-material and align with this pattern if not).
- Do not adopt the 3dshouse.com numeric defaults (2440×1220mm sheet, 3–8mm kerf, DXF "R2010," off-cuts-as-stock toggle) as spec. If ZilInventor needs these values, source them independently.
- Cut-sequence and remnant tracking in ABF are both shallow (Layer-assignment hack; per-job remnant label, no persistent stock inventory). ZilInventor is free to do better without needing to match an ABF baseline here — there isn't one to match.

## Known gaps

No hands-on run of the actual ABF `.rbz` plugin (Windows-only) was possible in this research; no on-screen dialog screenshot of the Nesting tab was obtained. Kerf-width UI, exact default sheet dimensions, exact DXF version string, and any edge-banding offset compensation inside the nesting/cutting output remain unconfirmed by any primary source. Given the "Quick"/first-pass-only framing and the paused status of the dedicated cutting-diagram tool, the working assumption is that ABF's nesting capability is considerably thinner than marketing-blog descriptions suggest — treat this as the default until independently verified.

Next: [`04-production-output/02-cnc-dxf-export.md`](02-cnc-dxf-export.md) for exactly what ABF's DXF export contains, including the nesting-DXF split-by-material behavior referenced above.
