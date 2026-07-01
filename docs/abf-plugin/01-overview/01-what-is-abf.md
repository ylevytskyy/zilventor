# What ABF Is and Who Makes It

ABF ("ABF Extension," self-branded on-site as "ABF 2025") is a free SketchUp Ruby extension (`.rbz`) for CNC-driven panel-furniture production. This doc covers where it comes from, who makes it, what it runs on, and how the vendor makes money, so the rest of this doc set can be read as "the product we are replicating" rather than an abstract spec.

## Vendor and origin story

ABF is built by **Công ty TNHH ABF EXTENSION**, a Vietnamese company (tax ID / MST `0317199056`). The live site footer gives the registered address as "7 Đường 14, Phường Tân Thuận, TP Hồ Chí Minh, Việt Nam." See [Confidence notes](#confidence-notes-known-uncertainties) below for a discrepancy in this address.

The founder's own account, published in first person on getabf.net, is that he ran a small panel-furniture workshop and struggled with dependency on skilled carpenters. He tore down and rebuilt his workshop's process around CNC + a designer-driven model, built the tooling to make that possible, and open-sourced it for free once he saw other workshop owners hitting the same wall. This is the vendor's own origin narrative, not third-party marketing copy — treat it as self-reported (**unverified** against any independent source), but it is the story that explains ABF's product shape: every feature exists to remove a carpenter from the loop.

A contact handle, Telegram `t.me/dangphibao`, suggests the founder's given name is "Dang Phi Bao." This is consistent with (not contradicted by) an earlier third-party attribution of the same name, so treat the name as **plausible**, not confirmed.

There is also a genuine regional partner: **Builttech**, described on getabf.net as "the official representative of ABF" in Thailand, running monthly in-country training that covers ABF usage, CNC export via Aspire, and production-model visits. This training-partner relationship is the most likely explanation for any prior report describing ABF as "Thailand-based" — the vendor itself is Vietnamese; Thailand is a market/training territory, not the origin.

## Platform support

| Aspect | Value |
|---|---|
| Host application | SketchUp (Ruby extension, `.rbz`) |
| Supported SketchUp versions | 2018–2025 (site body copy) / 2018–2026 (Facebook bio — these two figures disagree by one year) |
| Operating system | Windows only |
| Mac support | None — no Mac build exists |
| Install path | Window → Extension Manager → Install Extension → select downloaded `.rbz` → confirm "install from untrusted source" |

Windows-only, no Mac build, is a hard constraint worth stating up front: any ZilInventor comparison or feature-parity claim should not assume ABF runs cross-platform.

## Mission statement: designer-driven CNC production

ABF's stated mission is to let a designer drive CNC-based panel-furniture manufacturing directly from a SketchUp model, removing the workshop's dependency on traditional skilled carpenters. The vendor's own framing (translated): *the designer specifies production via a synchronized, fully-informed deployment dossier, then parts are machined by CNC (Router or Nesting machine) and assembled by general labor.*

The pipeline this implies:

SketchUp model (panels as single-level Solid Groups, named + material-coded) → ABF marks labels, hardware, edge-banding, and joinery on those groups → Quick Nesting arranges panels onto standard sheet sizes → DXF export (per-material-folder or single combined file) → CNC machining (Router or Nesting machine, e.g. via Aspire) → per-panel label printing (PDF/direct print, QR) for shop-floor reconciliation → edge-banding + general-labor assembly using CNC-pre-drilled hardware positions.

Two points that matter for ZilInventor:

- ABF does **not** generate G-code itself. It exports 2D DXF, consumed by third-party CAM software (e.g. Aspire) downstream. Full detail: [`04-production-output/02-cnc-dxf-export.md`](../04-production-output/02-cnc-dxf-export.md).
- ABF's data model has a hard prerequisite — every panel must be a single-level SketchUp "Solid Group" (ABF explodes Components down to flat Groups), named with a full material code before any tool runs. This is the foundational input contract for the rest of the doc set. Full detail: [`02-model-setup/01-solid-group-contract.md`](../02-model-setup/01-solid-group-contract.md).

Stated target users: small/medium workshops, manufacturers, interior designers, architects.

## Pricing model

All ABF features are currently free: *"Hiện tại toàn bộ các tính năng của ABF đều miễn phí."* The vendor does not monetize the plugin itself. Instead, the team is funded by paid consulting — "QUY TRÌNH TINH GỌN" (lean-process knowledge transfer) — a separate service sold on top of the free tool, not a license fee for the software.

One paid tier is explicitly announced as forthcoming, not yet shipped: a feature card for the current **Quick – Nesting** tool states it is fast/approximate and reference-only for material ordering, and that *"bản PRO đang phát triển"* — a PRO version is in development. This is the first confirmed evidence of a future paid nesting tier. Pricing, release date, and exact PRO/free differentiation are **not stated anywhere in the source material** — do not invent specifics.

Three other roadmap items are explicitly flagged, distinct from the current-feature set:

| Item | Status |
|---|---|
| Saw-cutting (beam saw) layout tool | Paused — low demand |
| "Connect to manufacturer" outsourcing network | Paused — security concerns |
| Combined DXF/XML export with edge-drill positions | Actively in development (no pause flag) |

That last item implies today's shipped DXF export is more basic than the eventual target: the vendor's own feature-card text says *"ABF currently only exports DXF for nesting results, split by material folder or as one combined file."* See [`04-production-output/02-cnc-dxf-export.md`](../04-production-output/02-cnc-dxf-export.md) for the full current export spec, and [`04-production-output/01-nesting.md`](../04-production-output/01-nesting.md) for how Quick-Nesting relates to the paused/in-progress cutting-diagram tool.

## Confidence notes (known uncertainties)

- **Registered-address discrepancy**: the live site footer gives "7 Đường 14, Phường Tân Thuận, TP Hồ Chí Minh, Việt Nam." An earlier source attributed the company to "Thủ Đức District." These likely refer to the same administrative area under different ward-naming conventions (Vietnam has undergone ward-boundary reorganizations), but this was not independently confirmed — treat the exact registered address as **plausible, not verified**.
- **Version support range**: site body copy says SketchUp 2018–2025; the vendor's own Facebook bio says 2018–2026. No changelog page exists to resolve which is current; the site's own "© 2025" footer suggests site copy may lag actual releases.
- **Origin story**: the founder's first-person narrative is self-reported on the vendor's own site — plausible and internally consistent with the product's design, but not corroborated by an independent source.
- **Download path**: the working install is a Google Drive link; a previously-referenced `cdn.abf-services.com/static-files/ABF-solutions.rbz` path is still embedded on the live site as a `href` but does not resolve (NXDOMAIN) — dead, not just historical.
- **Competitor comparisons**: no primary ABF source compares it to Polyboard, Woodwork for Inventor, or bCAD Мебель. A secondary content-marketing source (3dshouse) compares ABF to OpenCutList, but its other specific claims (DXF "R2010" format, a 22.5 mm hinge-setback default) could not be corroborated against getabf.net and should not be treated as fact.
- **PRO nesting tier**: existence is confirmed by the vendor; price, release date, and exact scope are not — do not treat any figure for this as known.

Next: [`01-overview/02-video-walkthrough-summary.md`](02-video-walkthrough-summary.md) for the demonstrated end-to-end workflow, or [`01-overview/03-end-to-end-workflow.md`](03-end-to-end-workflow.md) for the single-page pipeline model.
