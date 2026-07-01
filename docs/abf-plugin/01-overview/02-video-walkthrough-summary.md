# Video Walkthrough Summary (YARWOOD Tutorial)

This doc summarizes the primary ABF tutorial video used as source material for this doc set. It exists so a reader can see ABF's tools used **in the order a real user would use them** — install, model, mark, export — rather than only as an isolated feature list. Feature-level detail extracted from this video is spread across the other docs in this tree; this page is the map of where each part came from and in what sequence it appeared.

> Provenance note: this summary is derived from auto-generated Ukrainian captions (audio/caption-only extraction, no visual frame inspection). Proper nouns, exact UI wording, and numeric defaults should be treated as narrated, not directly observed. See "Caveats" below for what is and isn't confirmed.

## Source metadata

| Field | Value |
|---|---|
| Title | "ABF – робота з плагіном" ("ABF – Working with the Plugin") |
| Channel | YARWOOD |
| Video ID | `uMuSPHSUDf4` |
| Upload date | 2024-02-06 |
| Duration | 1:04:42 (3,882 s) |
| Views / Likes | 14,396 / 378 |
| Host CAD | SketchUp (ABF is installed as a SketchUp extension) |
| Destination platform | "Viyar" / "VR Pro" (brand name inferred from caption variants "vru"/"vrp"/"vrpro" plus the `#ViyarPro` hashtag — **unverified spelling**) |

No YouTube chapter markers exist for this video. All timestamps below are approximate, derived from first-mention keyword positions in the caption stream, not verified scene-cut boundaries.

The video does not link directly to the ABF plugin or its download page; distribution is via a Google Drive link shown on screen only (URL not captured as text).

## Chronological workflow outline

The host walks through ABF roughly in the order its toolbar exposes the tools. This is the sequence a new user would follow end to end:

| Stage | Timestamp | What happens |
|---|---|---|
| 1. Find and install | 00:42–02:11 | Search "ABF Solution" / "ABF extension" / "ABF cnc" (narrator says developer based in Thailand — **(unverified)**, and likely wrong: [What ABF Is and Who Makes It](01-what-is-abf.md#vendor-and-origin-story) confirms the vendor is Vietnamese, with Thailand only a training-partner territory). Download via Google Drive link, install through SketchUp's Extension Manager, restart SketchUp — a new toolbar appears. |
| 2. Register/login | 02:11–03:00 | First use requires login (email/password with confirmation code, or Facebook OAuth). |
| 3. Model with Groups + rename | 03:00–06:21 | Panels must already exist as SketchUp **Groups** (see [Solid-Group Input Contract](../02-model-setup/01-solid-group-contract.md)). Batch/quick rename of parts, materials, and cabinet names; free-text comments per part (visible only in exported reports); prefix/suffix batch naming. |
| 4. Label ("Розмітка") | 06:21–07:41 | Stamps each panel with ID, name, company name (if configured), and a texture-direction arrow. Only labeled parts flow to layout/export. Label failure is used as a geometry sanity check. |
| 5. Edit labels: flip/rotate, hinges, fasteners | 07:41–17:18 | Flip face/back (hotkey `~`), rotate grain direction, place hinges from a settings-driven dropdown, place fasteners (Confirmat, Minifix/e-fix) with modifier-key combos for symmetric/multi-panel placement. |
| 6. Grooves/dados | 17:18–26:31 | Auto-detects panel overlap and generates a groove at a chosen depth; grooves and fasteners live as nested sub-groups inside the parent panel group so they travel with it into export. |
| 7. Layout/breakdown check ("Розкладення") | 26:31–30:17 | The QA pass and the actual transfer trigger to Viyar/VR Pro: verifies part count, fastener transfer, texture arrows, edge-banding, thickness, material code; auto-separates panels into groups by thickness/material. |
| 8. Settings (largest section) | 30:17–55:03 | User/language, import/export of a settings profile, exploded-view defaults, nesting config (skipped), edge-banding templates, label field config, groove/hinge/fastener templates, report/BOM with Excel export. |
| 9. Non-destructive resize ("Промінь"/Beam) | 44:54–54:05 | Stretches a module without deforming embedded hardware, grooves, edge-banding, or panel thickness. |
| 10. Edit edge-banding | 54:05–55:03 | Transparency/X-ray toggle to select occluded edges; per-edge or per-material band assignment; three auto-modes (semi-automatic, strip-all, band-all). |
| 11. Nesting / DXF export (skipped by host) | 55:03–55:27 | Premium-only, Thailand-CNC-oriented (**unverified** — single-source narrator claim; see the Thailand-origin caveat above); host uses a separate, unnamed DXF plugin instead. |
| 12. Print labels | 55:27–56:12 | Thermal-printer (Zebra) label template editor; host doesn't use it, preferring Viyar's own labels. |
| 13. Exploded view export | 56:12–58:12 | Generates a 2D PDF with callout arrows for assemblers; **detaches/ungroups the model** (see caveat below). |
| 14. Data conversion | 58:12–1:00:34 | Converts native SketchUp Components into Groups (preserving hierarchy) and single faces into Groups — needed because ABF only operates on groups. |
| 15. Component database (Premium) | 1:00:34–1:03:xx | Third-party parametric module marketplace; host doesn't use it (not adapted for his market). |

Full per-feature detail for stages 3–4 lives in [02-model-setup](../02-model-setup/), stages 4–6 in [03-machining](../03-machining/), and stages 7, 8/11, 13 in [04-production-output](../04-production-output/).

## Key on-screen caveats called out by the narrator

These are constraints the narrator explicitly flags as gotchas, not just feature descriptions — treat them as hard requirements if ZilInventor is to match this workflow:

- **Groups only, not Components.** ABF operates exclusively on SketchUp Groups. Native Components must be converted first (stage 14) or ABF forces an auto-explode-into-groups on label, which the host calls out as disruptive enough that the converter is his most-used tool.
- **Label failure = geometry defect signal.** If a panel fails to label, its face/polygon is not symmetric front-to-back (deformed geometry) — the host uses labeling as an implicit QA gate, not just a cosmetic stamp.
- **Grooves and fasteners must stay nested inside the parent panel group.** They are implemented as sub-groups (internal name "ABF Intersect" for grooves). Pulling them out of the panel group breaks their association with that panel and they won't travel to export correctly.
- **A fastener sub-group instance exists on both interacting panels.** Deleting a fastener requires deleting it on both sides, not once.
- **Exploded view is destructive.** Generating an exploded view breaks the module into a separate, ungrouped set. The host recommends running it on a copy or in a separate SketchUp window, never on the working model — see [Working Drawings and Exploded Views](../04-production-output/04-drawings-and-exploded-views.md) for how ZilInventor should scope around this.
- **Groove auto-generation sometimes falls short of the panel edge** and needs manual scale/position correction — it is not always geometrically exact.
- **Only three label fields are mandatory** for Viyar to read the data (ID, name, texture orientation); company name is optional. Over-customizing groove templates beyond depth risks grooves rendering incorrectly (out of panel bounds) on the Viyar site.
- **Default (non-Viyar) hinge/fastener/edge-band templates should be disabled**; only templates imported from the Viyar/VR export section are reliable — a community-maintained settings profile ("Andrii's" profile) is imported rather than built from scratch.
- **Camera orientation affects fastener placement** for some hardware (e.g., e-fix/mini-fix cams): the direction the camera faces when you click determines which face the fitting attaches to. Confirmat is exempt (fully internal, direction-agnostic).

## What the video does NOT cover

Gaps versus what the vendor's own site describes as ABF's full feature set (per [What ABF Is and Who Makes It](01-what-is-abf.md)):

- **Nesting** — Premium-gated; the host doesn't have access and doesn't demo it. See [Nesting: Quick-Nesting vs. the Paused Cutting-Diagram Tool](../04-production-output/01-nesting.md) for what can be reconstructed about this feature from other sources.
- **DXF nesting export** — mentioned only to say the host doesn't use it, preferring an unnamed third-party DXF plugin. ABF's own DXF export format/options are therefore **not directly observed** in this video; see [CNC/DXF Export Format and Options](../04-production-output/02-cnc-dxf-export.md) for what is documented elsewhere.
- **Component database (Premium)** — shown briefly and dismissed as not useful for the host's market; parametric controls (resize, angle, add/remove fittings) are described but not demonstrated in depth.
- **Full hinge settings walkthrough** — the host explicitly defers this to "a future video"; only cup diameter/depth example numbers are given (35mm/13mm), not a complete settings tour.
- **Exact UI layout** — icon positions, precise dialog field order/wording, and dropdown contents are narrated, not visually confirmed (audio/caption-only extraction).
- **Pricing/tiers of ABF's own Premium subscription** — a paywall screen appears but isn't read aloud in detail.
- **The plugin's own product page and canonical name** — "ABF Solution" is only one of several search terms the host suggests; not confirmed as the literal product name or URL.

## How this maps to the other docs in this tree

| This video's stage | Detail doc |
|---|---|
| Group requirement, rename | [The Solid-Group Input Contract](../02-model-setup/01-solid-group-contract.md), [Practical Panel-Modeling Habits](../02-model-setup/02-panel-modeling-practice.md) |
| Label points/paths, hinges, fasteners, grooves | [Machining Primitives: Points, Paths, Intersections](../03-machining/01-machining-primitives.md), [Hardware Boring (Присадка) and Groove Joinery](../03-machining/02-hardware-boring-and-joinery.md) |
| Layout/breakdown, nesting, settings | [Nesting: Quick-Nesting vs. the Paused Cutting-Diagram Tool](../04-production-output/01-nesting.md) |
| DXF export (not demoed) | [CNC/DXF Export Format and Options](../04-production-output/02-cnc-dxf-export.md) |
| Print labels, report/BOM | [Panel Labels, Print Output, and BOM/Statistics](../04-production-output/03-labels-and-reports.md) |
| Exploded view | [Working Drawings and Exploded Views](../04-production-output/04-drawings-and-exploded-views.md) |
| What ZilInventor already covers vs. this workflow | [ZilInventor's Existing Manufacturing-Processing Capabilities](../05-parity/01-zilinventor-capability-inventory.md), [Gap Analysis: ABF vs. ZilInventor by Aspect](../05-parity/02-gap-analysis.md) |

For the single-page mental model of the full pipeline (not tied to this one video), see [End-to-End ABF Production Workflow](03-end-to-end-workflow.md).
