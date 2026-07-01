# Machining Primitives: Points, Paths, Intersections

ABF describes every CNC operation — drilling, routing, grooving, plasma cutting — using three geometric primitives: a **point** (single bore/drill location), a **path** (a line or closed contour the tool follows or removes material inside of), and an **intersection marker** (a rule that derives machining geometry from where two solids overlap). This doc defines the vocabulary. [02-hardware-boring-and-joinery.md](02-hardware-boring-and-joinery.md) covers the specific hardware types and joint styles built on top of it; [04-production-output/02-cnc-dxf-export.md](../04-production-output/02-cnc-dxf-export.md) covers the exported file format.

Everything below assumes the [Solid-Group input contract](../02-model-setup/01-solid-group-contract.md): panels are true solids, grouped, named, and material-coded before any machining tool runs.

## Point operations: boring/drilling for hardware

A point operation places a single hole (or a small cluster of holes at a fixed relative offset, e.g. a hinge cup plus its two mounting screws) at one XY location on one face of one panel. This is присадка (prisadka — the Slavic-language umbrella term for hardware boring/drilling/fitting-marking used throughout ABF's own tutorials).

Point operations cover: confirmat screws, cam/eccentric fasteners ("эксцентрик"), U-plastic corner connectors, Minifix, Rafix, Cabineo, Lockdowel, dowels ("шкант"), hinge cups, and shelf pins (including a named "K-LINE" shelf-support bracket). Each hole type carries:

| Attribute | Meaning |
|---|---|
| Diameter | Bit diameter for that hole |
| Depth | Bore depth into the panel face |
| Face | Which panel face (TOP or BOT — see below) |
| Offset | Position relative to the panel edge/reference geometry |
| Target DXF layer | Which named layer the hole geometry is written to |

Exact default numeric values (diameters, depths, setbacks) per hardware type are not established from any ABF-official source — see the confidence note at the end of this doc. What is confirmed is that these values are user-configurable, not hardcoded (see "User-configurable parameters" below).

**Requirement for our app:** a point-operation primitive must record hole diameter, depth, target face, offset-from-reference, and a layer/tool assignment, independent of which specific hardware type placed it — the same underlying data shape services confirmat, cam-lock, Minifix, hinge-cup, and shelf-pin holes alike.

## Path operations: grooves/dados, contour/profile toolpaths, pocket toolpaths

A path operation is a line or closed region a tool follows, rather than a single point. ABF names two path toolpath kinds explicitly:

| Toolpath kind | Behavior | Example use |
|---|---|---|
| Profile Toolpath | Tool follows a contour/edge | Lockdowel connector slots |
| Pocket Toolpath | Tool removes material inside a closed region | Grooves, dados, 3D relief carving |

Groove/dado cuts for joinery (back-panel rabbets for a sliding bottom panel, tenon/mortise grooves) are Pocket Toolpaths, each assigned to its own named machining layer. A separate named operation, "Keyhole slot," routes wall-hanger keyhole slots. Full mortise/tenon joint production for CNC is also supported.

(unverified) An early 2021 user report on the SketchUp Community forum said ABF "only did boxes" — bounding-box panels only, no mortises or cutouts exported. Later official tutorials clearly demonstrate groove, pocket, keyhole, and tenon/mortise machining, so this limitation appears to have been resolved in a later version; it should not be read as a current constraint.

Each ABF-defined cutting tool ("dao cụ") carries a `toolNumber` (its slot in the CNC's tool magazine/holder) and a machining speed. When programming a Profile Toolpath, the machining depth must be set so it matches the physical router bit actually loaded in that `toolNumber` slot on the real CNC machine — the DXF/CAM tool order and the shop's physical tool setup must stay in sync.

**Requirement for our app:** a path-operation primitive must carry a toolpath kind (profile vs. pocket), a target depth, a tool/layer assignment with a stable tool-slot number, and — for pocket toolpaths — the closed region geometry to clear.

## Intersection marker: shared mechanism for joinery and hardware-slide marking ("Mark Intersection")

ABF's core joinery tool is a single generic mechanism, not a separate tool per joint type: it derives machining geometry from where two solids' geometry overlaps. In the plugin's English UI text this is called **"Mark Intersection"** (Vietnamese: "đánh dấu tiết diện giao nhau" — "mark intersecting cross-section").

Workflow, as demonstrated in official tutorials:

1. Open settings and create a new intersection-marking type.
2. Name its target machining layer.
3. Set an X-expansion/stretch tolerance ("khéo giãn X") to a value at or above the router bit radius — this compensates for kerf/bit radius so the cut pocket is the right size for the tenon to actually fit.
4. Name and activate the cross-section type.
5. Click the "mark intersection" tool, select that type, then double-click the male/tenon panel ("Mộng Dương").
6. ABF automatically marks the corresponding pocket/machining area on the mating female/mortise panel ("Mộng Âm").

The same mechanism is reused for a second, unrelated purpose: marking Blum undermount drawer-slide routing positions, by intersecting a proxy/virtual slide object with the cabinet side panel. In both cases the underlying operation is identical — take two solids, compute where one intrudes into the other, mark that intruded region on the second solid as a machining path assigned to a named layer. Joinery and hardware-slide marking are the same primitive with different input geometry, not two separate features.

**Requirement for our app:** implement one generic solid-intersection-to-machining-path operation, parameterized by (a) a bit-radius-derived tolerance/offset and (b) a target layer, and apply it both to true joinery (tenon/mortise, dado) and to hardware-proxy marking (drawer slides against a side panel). Building two separate mechanisms for these would diverge from ABF's actual design and duplicate logic our app would otherwise share.

### Face assignment: TOP/BOT and flip-fence alignment

ABF terminology distinguishes a panel's TOP face from its BOT (bottom) face; every point or path operation is assigned to one of the two. For parts that need machining on both faces, ABF's nesting-editing module (ABF MORO) generates a colored reference axis line ("đường trục cắt ke lật mặt" — the flip-fence/flip-jig cutting axis) so a CNC operator can correctly re-register the panel on the machine table after physically flipping it to cut the second face.

A hardware marker's assigned face can also be reassigned after initial placement, via a dedicated "flip face" operation available both during simulation and after marking — face assignment is not fixed at creation time.

**Requirement for our app:** every point/path primitive needs a face attribute (top/bottom) that is editable after placement, plus — for genuinely two-sided parts — a computed flip/re-registration reference so a two-sided part can be reliably re-fixtured mid-job.

## Named DXF layers as the 1:1 mapping to CNC tool/speed/depth

Every machining operation — point, path, or intersection-derived — is written to its own user-named DXF layer. The layer name is the join key between ABF's model-space geometry and the shop's CAM software: each layer corresponds to one CNC tool with a specific bit, speed, and depth. Setup is meant to be one-time — organize and name all layers once, program the matching CNC toolpath assignment once in CAM, and every subsequent model export reuses that mapping automatically without re-configuration.

Consuming CAM software named in official ABF material:

| CAM software | Use case |
|---|---|
| Aspire | Wood routing/drilling; a dedicated ABF tutorial ("[Aspire] Mapping toolpaths layer ABF") walks through mapping ABF's DXF layers to Aspire toolpaths |
| Mastercam | Named as a supported CAM target |
| AlphaCAM | Named as a supported CAM target |
| CNC plasma | Metal plate cutting, confirmed by an official ABF video title ("How to cut metal plate using CNC plasma with ABF plugin") — ABF is not wood-only |

(unverified, single-source) ABF's layer/tool-mapping model was demonstrated against a real shop CNC center described as having 9 drilling spindles and 2 mortiser/chisel units — i.e. the layer system targets combination line-boring + mortising machining centers, not just a single router with one spindle.

**Requirement for our app:** DXF export must group geometry onto named layers where the layer name is the CAM tool key, and that layer-name-to-tool mapping must be a persistent, reusable configuration set once per shop/machine rather than re-specified on every export. See [04-production-output/02-cnc-dxf-export.md](../04-production-output/02-cnc-dxf-export.md) for the concrete export format.

## User-configurable parameters and layer names, savable as Presets

Per the plugin author directly, replying on the SketchUp Community forum thread to a user asking whether hole depth and hinge parameters could be changed: hole parameters and their target DXF layer name are configurable per hardware type in ABF's settings — they are not hardcoded. Configured sets of these parameters can be saved and reused as a **Preset**.

This applies uniformly across the three primitives:
- Point operations: diameter, depth, offset, and target layer per hardware type.
- Path operations: tool selection (profile vs. pocket), depth, and target layer.
- Intersection markers: the X-expansion/kerf tolerance and target layer per marking type.

**Requirement for our app:** parameters must live in user-editable, named, savable configuration objects (presets) — one preset per hardware type or joint type — rather than as constants baked into the machining code. A user should be able to define a new hardware type or joint type by creating a preset, without a code change.

## Confidence note on source material

Most of the specifics in this document come from the ABF vendor's own YouTube channel (video titles/descriptions) and the plugin author's direct replies on SketchUp Community forum thread 127578 — the highest-confidence sources available, since they are the vendor describing its own product. Several individual claims (the X-expansion tolerance mechanic, `toolNumber`/speed semantics, the "9 spindles + 2 mortiser units" CNC-center detail, the Aspire layer-mapping tutorial, keyhole slot routing, and the flip-fence axis line) rest on a single video each, whose full content could not be scraped (YouTube blocks transcript/description scraping via automated fetch) — they are corroborated by nothing contradictory, but are marked "(unverified)" above rather than stated as flatly confirmed.

A third-party review site, 3dshouse.com, was checked and explicitly **excluded** from this document except where corroborated elsewhere. It supplies specific numbers (e.g. a 35mm forstner bit / 9.5mm depth hinge-cup spec, 22.5mm setback) that read as generic European-hardware-industry defaults rather than ABF-documented facts, and names an unconfirmed developer ("Dang Phi Bao") not corroborated by any ABF-official source. None of those specific numbers appear in this document. Exact default numeric values per hardware type, and the exact ABF settings-dialog layout, remain unestablished and would require direct access to the plugin.
