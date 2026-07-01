# Panel Labels, Print Output, and BOM/Statistics

ABF's label and reporting system is built around a named-tag workflow, not a
freeform annotation tool. A panel becomes label-eligible by being wrapped in
an **"ABF_label"** sub-group that encodes which face is the primary
machining face and which way the wood grain runs; that data, plus the
panel's own name, is what gets printed. Reporting is a separate function,
**"Thống Kê"** (Statistics), that rolls the whole model up into hardware
counts, edge-band consumption, and cut-length lists, exported as an Excel
file. This doc covers both, plus the label-printing pipeline and the
downstream QR tools that consume the exported Excel.

This assumes the [Solid-Group input contract](../02-model-setup/01-solid-group-contract.md)
and the machining vocabulary from [03-machining/01-machining-primitives.md](../03-machining/01-machining-primitives.md)
(face assignment, named layers). It follows on from
[01-nesting.md](01-nesting.md) and [02-cnc-dxf-export.md](02-cnc-dxf-export.md):
label printing is explicitly gated on nesting having already run.

## ABF_Label layer/group: primary machining face + grain direction, editable via Flip/Rotate Label

**"Đánh dấu tấm"** (Mark/tag panels) deletes and recreates an **"ABF_Label"**
SketchUp layer, then wraps each qualifying panel Group in an **"ABF_label"**
sub-group. That sub-group encodes two pieces of machining metadata per
panel, independent of the point/path primitives already on it:

| Attribute | Meaning | Edited via |
|---|---|---|
| Primary machining face | Which face of the panel is the reference/label face | "Edit — Rotate: Label" |
| Grain direction | The wood-grain angle for that panel, relative to the label | "Edit — Flip: Label" |

"Edit — Rotate: Label" redefines which face carries the label (i.e.
reassigns the primary machining face). "Edit — Flip: Label" corrects the
grain-direction angle; corrected angles can be saved as reusable **angle
presets** so a common grain rotation doesn't need re-entry per panel.

This is the same TOP/BOT face concept used by point and path machining
operations (see [03-machining/01-machining-primitives.md](../03-machining/01-machining-primitives.md#face-assignment-topbot-and-flip-fence-alignment)),
applied here to labeling rather than boring/routing. **(unverified)** — this
description is drawn from getabf.net's own feature copy; no screenshot of
the ABF_label sub-group's internal structure or dialog was available to
confirm exact field names.

**Requirement for our app:** panel identity data needs a first-class
machining-face and grain-direction attribute, independently editable after
the panel is created (not fixed at creation time), and both attributes must
be visible to and consumed by the label/print pipeline, not just by
CNC-facing operations.

## Panel naming/renaming tool: sequence numbers, prefix/suffix, name presets

The panel name/ID printed on the label comes directly from the panel's
SketchUp component/group name. ABF sets that name through a dedicated
**"Đặt/Đổi tên tấm"** (set/rename panel) tool, distinct from the labeling
tool above. It supports:

| Capability | Behavior |
|---|---|
| Auto sequence numbers | Panels get an incrementing number as part of their name |
| Prefix / suffix | Fixed text segments attached before/after the sequence number |
| "Name code" | A named code component, part of the assembled name |
| Savable name presets | A full naming scheme (prefix + suffix + code pattern) can be saved and reapplied |

A companion utility in the third-party Ukrainian AddFurnABF plugin (see
below) extends this with a module-prefix tool that can source the prefix
from the parent group's name, a typed value, or remove an existing prefix —
evidence that panel naming/renaming is treated as a recurring, configurable
step in real production use, not a one-off.

**Requirement for our app:** part naming must be a rule-driven, savable
scheme (sequence + prefix/suffix + code), not manual per-part renaming, and
whatever name a part carries must be the single source of truth for its
label/BOM identity — no separate "label text" field that can drift from the
part's actual name.

## Print Label function: PDF or direct-to-printer, multiple templates, QR code template

**"In tem nhãn"** (Print label) is the dedicated label-output function. It
is explicitly gated on nesting having already been run — the vendor's own
phrasing is "sau khi các bạn đã nesting rồi" ("after you have already run
nesting"). This means the label pipeline depends on nesting output (sheet
assignment, position) as an input, not just on the panel's own name/face/grain
data.

| Property | Value |
|---|---|
| Output targets | PDF file, or direct print to a physical printer |
| Templates | Multiple label templates available |
| Template #3 | Embeds a QR code on the label |
| Gate | Requires nesting to have run first |

**(unverified)** — whether the PDF output is one label per page or a sheet
layout of several labels per page, the physical label paper size, and
whether thermal label printers (e.g. Zebra) are specifically supported were
all **not confirmed** by any source checked for this doc set. A prior
identity brief mentioned thermal-printer support, but that claim could not
be traced to a primary or secondary source here and should not be treated
as fact.

**Requirement for our app:** label printing must not be reachable — or must
clearly warn — until nesting has produced sheet/position data for the part
being labeled, since the label's content (and the QR-coded record behind
it, see below) depends on that placement. Support at minimum a PDF export
path and a template with an embedded QR code; multi-label-per-page sheet
layout is a reasonable assumption for shop use but is unconfirmed against
ABF specifically.

## Two free-text header lines as savable Presets; edge/band cross-reference moved to a companion "Note" label

The print-label dialog's header area supports two free-text lines
("dòng số 1" / "dòng số 2" — line 1 / line 2), per an update the vendor
announced in a dedicated tutorial video. These are not just typed and
discarded: they can be **saved, edited, filtered, and deleted as named,
reusable Presets**, searched through a case-sensitive search box. This lets
a shop keep a library of recurring header text (project name, client name,
batch note) instead of retyping it per print run.

A separate, deliberate redesign moved edge/band cross-reference information
off the main label. Previously the main label listed every edge's assigned
band code directly (e.g. "edge #2 → code 388 AV" per edge), which the
vendor found too verbose. That cross-reference now lives on a **companion
"tem Note" (Note) label**, meant to be printed alongside the main label
rather than on it.

| Label | Content |
|---|---|
| Main label | Panel name/ID, dimensions, material, sheet reference, primary-face/grain marks, optional QR code, two free-text header lines |
| Note label (companion) | Per-edge band-code cross-reference (which edge got which banding code) |

**Requirement for our app:** treat the label header as reusable, named,
searchable text presets rather than a one-off free-text box, and keep the
main label's per-edge banding detail on a separate, optional companion
label rather than crowding it onto the primary label — this is a real
usability lesson from ABF's own iteration, not just a stylistic choice.

## Statistics (BOM) report: hardware counts, joints/connectors, edge-band tape consumption, linear-material cut lengths, general summary

**"Thống Kê"** (Statistics) is ABF's BOM/report function, reached once the
model has been exploded/moved into the production stage ("phá khối"). It
covers five categories:

| Category | Content |
|---|---|
| Hardware/fitting counts | Counts by hardware type across the model |
| Joints/connectors | Connector counts, separate from hardware fittings |
| Edge-band tape consumption | Total banding tape used |
| Linear-material cut lengths | Per-piece cut-length breakdown for linear ("погонаж"-style) stock, e.g. "3 rods — 1×958mm, 2×466mm" |
| General summary | Panel/sheet data overall |

Users can enter a unit price per item in the report; ABF then computes a
total cost and can generate a **"báo giá"** (price quote). The whole table
exports as an **Excel database file**. This combination — statistical
report, cost calculation, and Excel export — is independently confirmed by
the plugin author's own opening post on the SketchUp Community forum.

A companion tool, **"ABF DC — Thêm Thống Kê"** (Add Statistics), lets users
embed custom count-or-length statistical objects into reusable library
components, so non-standard parts (e.g. a closet hanging rod pulled from a
parts library, not a modeled panel) still roll up correctly into the
Statistics table. A worked tutorial example: 6 end caps + 3 rod segments
(1×958mm, 2×466mm) reporting correctly as line items. A related utility,
**"ABF DC — Liên Kết"**, lists/deletes each connector/fitting type for a
selected object group — a feeder into the report rather than its own report
view. **"ABF DC — Phân Loại Tấm"** (panel classification) groups panels by
material with thickness split and flags double-sided-machined panels,
described as feeding pre-production/cutlist management.

Pricing data (hardware presets, unit prices) is stored per user account and
cloud-synced on login ("Export/Import Cloud Data"), with manual export/import
for backup.

**Roadmap, not shipped:** getabf.net lists **"DXF/XML Tổ Hợp"** — a combined
DXF/XML export that would carry edge-drilling positions plus part labels in
one file — under "features being built." This is explicitly not yet
shipped as of the site snapshot used for this doc set (mid-2026); do not
treat combined DXF+label export as current ABF behavior.

**Requirement for our app:** the BOM/Statistics report needs the same five
categories (hardware, joints/connectors, edge-band consumption, linear-stock
cut-length breakdown, general summary), per-item unit pricing rolling up to
a total/quote, and Excel export. Non-standard/library parts (e.g. hanging
rods) must be able to declare their own count/length contribution so they
appear correctly in the rollup — don't assume every reportable item is a
modeled panel.

## Downstream QR tools and third-party BOM companion (context, not core scope)

Two points from the source material are relevant context but sit outside
ABF's core plugin:

- **Downstream web tools** (getabf.net, separate logins): **"Qr Checker"**
  (qrscan) lets a shop upload the Statistics Excel export, scan each panel's
  printed QR code (payload format `ID.text`, auto-parsed for the numeric
  ID), and mark rows as physically produced, then re-export. Per-part detail
  fields shown: ID, Code N.1/N.2/N.3, Label, material & thickness, and
  finished dimensions — implying these are the columns embedded in (or
  associated with) each panel's QR record. **"QR Đóng gói"** (qrtable)
  scans the same QR codes to build a packing list/delivery slip per batch,
  with a configurable company template and delivery-slip fields, also
  exporting to Excel.
- **Third-party companion plugin** ("AddFurnABF"/"AddABF_Tool", by a
  developer referred to as Kostya, hosted at addons-for-abf.pp.ua — **not**
  getabf.net) targets the Ukrainian Viyar hardware market specifically. It
  reads ABF's own labels/tags and produces a three-tab BOM
  ("Специфікація"): full hardware list with cost, a Viyar-only subset
  exportable to CSV for supplier ordering, and a linear-material list. Core
  ABF itself never mentions Viyar anywhere in its own site or reports — the
  Viyar CSV hand-off is exclusively a third-party companion feature, not a
  core-ABF one.

**Requirement for our app:** none directly — these are downstream/ecosystem
tools, not core ABF behavior. They are useful evidence that (a) a QR-coded
per-part record surviving from label print through production tracking is
a real shop-floor need, and (b) supplier-specific export (e.g. Viyar CSV) is
reasonably scoped as a plugin/extension point rather than core functionality.

## Confidence note on source material

Most claims above come from getabf.net's own feature copy, the vendor's
own tutorial videos (the label-preset update video and the "Thêm Thống Kê"
closet-rod demo), and the plugin author's opening SketchUp Community forum
post — direct vendor-sourced material. No screenshot or hands-on access to
the actual "In tem nhãn" or "Thống Kê" dialogs was available, so exact field
names beyond what's stated here, the precise Excel export schema (sheet
names, header row), physical label dimensions, and printer-hardware support
are **not confirmed** and are flagged inline above rather than stated as
fact. A third-party SEO blog (3dshouse.com) independently corroborates the
general shape of label printing (name, dimensions, material, banding
callout) and credits the same developer name found in the qrscan tool's
footer, which raises confidence in that source's factual core — but it
explicitly found no BOM/Statistics/Excel documentation at all, so it
contributes nothing to the Statistics section above.
