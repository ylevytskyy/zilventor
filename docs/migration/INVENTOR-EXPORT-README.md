# Migrating an Inventor 2012 library into ZilInventor

This guide walks through a one-time migration: pulling your existing Inventor
2012 furniture library out of `.ipt`/`.iam` files and into ZilInventor's native
`.zipt`/`.ziasm` format. The path is two halves: a VBA macro that runs *inside*
Inventor to dump STEP geometry plus JSON sidecars to disk, and an "Import from
Inventor" command in ZilInventor that walks that folder and produces OPFS
files.

It is one-way and one-time. There is no two-way sync, no incremental
re-export, and no formula tracking. The goal is to land your library in
ZilInventor cleanly enough to keep working there from now on.

## What this migrates and what it doesn't

**Migrated:**

- **Geometry**, sealed as STEP (AP214). Each unique `.ipt` exports once even
  if it appears in twenty different assemblies — the macro deduplicates by
  resolved file path.
- **Assembly tree**, with components placed by `(translation, quaternion)`
  pose. Two-level hierarchies (assemblies inside assemblies) round-trip; the
  importer walks the tree and writes nested `.ziasm` files.
- **iProperties** — Part Number, Description, Material, Mass, Vendor,
  Project, Revision Number, Stock Number, Cost Center, Weight, Title,
  Subject, Author, Manager, Company, Category, Keywords, Comments, Status —
  land under canonical lower-camel keys in a `properties` bag on the
  resulting part/assembly. Custom iProperties keep their original Inventor
  key verbatim, including spaces and Cyrillic.
- **Numeric user parameters** — your `Width`, `Height`, `Depth`, etc. land
  in the `parameters` panel as resolved numeric values. The original
  expression string travels along as a comment but is **not** re-evaluated.
  Editing `Width` in ZilInventor will not propagate to dependent parameters
  the way it does in Inventor — the imported part is sealed geometry; only
  the parameter's surface metadata round-trips.
- **Per-occurrence color overrides** in assemblies. If you tinted
  individual placements in Inventor, those overrides arrive in ZilInventor
  as occurrence colors.

**Not migrated:**

- **Inventor assembly constraints** (mate, flush, angle, insert) — these
  reference internal Inventor face/edge IDs that don't survive STEP
  transit. Imported `.ziasm` files arrive with components positioned by
  pose only and zero constraints. You will need to re-add ZilInventor
  constraints by hand. The geometry is solid, so you have something to
  pick faces on.
- **Inventor expressions** — only the resolved numeric value of each user
  parameter rides along, plus the expression string as a metadata comment.
  No re-evaluation.
- **iLogic rules** — no ZilInventor analogue.
- **Drawings** (`.idw`, `.dwg`) — out of scope; that's sub-project 6
  territory.
- **Animations / presentations** (`.ipn`).
- **Custom appearances and textures** — only flat color is captured.
  Textured appearances flatten to a base RGB.
- **Sheet metal / weldment / Frame Generator** — bodies export as STEP
  geometry but the feature-specific metadata (bend tables, weldment
  symbols, frame member catalogs) is lost.

The practical implication: imported parts are read-only in ZilInventor.
The Add* buttons in the Model tab are disabled with a tooltip explaining
that re-authoring requires creating a fresh ZilInventor part. You can
still place imported parts in assemblies, add ZilInventor mate/flush/angle
constraints on top, and treat them as black-box building blocks.

## One-time install: load the macro

You only do this once per Inventor installation.

1. Open **Autodesk Inventor 2012**.
2. **Tools → Macros → Visual Basic Editor** (or press Alt+F11).
3. In the Project panel on the left, find **Standard.ivb** (this is
   Inventor's per-user macro project — it's where personal macros live).
4. Right-click **Standard.ivb → Import File…** and pick
   `tools/inventor-export/ZilInventorExport.ivb` from this repo.
5. **File → Save Standard.ivb** (or Ctrl+S inside the VBA editor).
6. Close the VBA editor.

The macro is now installed. **Tools → Macros…** lists two new entries:

- `ZilInventor_ExportActiveDocument`
- `ZilInventor_BatchExportFolder`

If Inventor's macro security prompt asks whether to enable macros, choose
**Disable with notification** (Tools → Macros → Security…). Disabling
*without* notification silently kills macros and the export will appear to
do nothing.

## Running the batch macro

For migrating an entire library, batch is what you want.

1. **Tools → Macros…** → select `ZilInventor_BatchExportFolder` → **Run**.
2. **First dialog: input folder.** Pick your library root. Example:
   `D:\Furniture\Library`. The macro recurses into every subfolder.
3. **Second dialog: output folder.** Pick a folder *outside* the input
   root. Example: `D:\Furniture\Library_export`. The macro refuses to
   proceed if the output folder is inside the input folder, to keep STEP
   files from interleaving with your source `.ipt` files.
4. The macro walks the tree, opens each `.ipt`/`.iam` once, exports it,
   and closes it. STEP export takes 1–3 seconds per part on most hardware;
   assembly metadata writes in well under a second. A 200-part library
   typically completes in 8–12 minutes.
5. When the macro finishes, a message box reports the location of
   `_export-log.txt` — open it to see one line per processed file
   (`OK`, `SKIP`, or `ERR <reason>`).

For a single document, use `ZilInventor_ExportActiveDocument` — open the
`.ipt` or `.iam` you want to export, run the macro, pick an output
folder, and the active document writes to that folder.

## Inspecting the output folder

The output mirrors your input layout. For each `.ipt`:

```
SidePanel.ipt        -->  SidePanel.step + SidePanel.ipt.json
```

For each `.iam`:

```
Cabinet.iam          -->  Cabinet.iam.json
```

(no STEP for assemblies — they reference parts by relative JSON paths).

The output folder root contains `_export-log.txt`, listing every document
processed. Open any `.ipt.json` in a text editor to confirm the
properties and parameters round-tripped correctly. The structure looks
like:

```jsonc
{
  "schemaVersion": 1,
  "kind": "part",
  "exportedAt": "2026-04-30T14:23:01Z",
  "source": { "iptPath": "Cabinet/SidePanel.ipt", "fileVersion": "Inventor 2012" },
  "step": "SidePanel.step",
  "name": "SidePanel",
  "properties": { "partNumber": "Z-001", "description": "Side panel", "material": "Plywood 18mm" },
  "parameters": {
    "Width": { "value": 600, "unit": "mm", "expression": "600 mm" }
  }
}
```

If a part failed to STEP-export (Inventor's translator occasionally trips
on legacy thread features or broken sheet metal), the log will say
`ERR <relpath> STEP export failed: <Inventor message>`. See
**Troubleshooting** below for the workaround.

## Importing into ZilInventor

1. Open ZilInventor (`pnpm --filter @zilventor/app dev` if running locally,
   or whichever deployed URL your team uses).
2. Switch to the **File** tab in the ribbon.
3. Click **Import from Inventor**.
4. **First picker: input directory.** Pick the *output folder of the
   macro* — i.e. the folder containing all those `.step` and `.json`
   files.
5. **Second picker: target directory.** Pick (or create) an OPFS
   subfolder. A fresh subfolder named after your project (`MyKitchen2026`)
   keeps imported files together.
6. **Conflict policy radio:**
   - **Overwrite existing files** — clobbers anything already there.
     Use for fresh imports or when re-migrating after a clean wipe.
   - **Skip existing** *(default)* — leaves any existing ZilInventor
     files alone. Use when re-running the import and you've already
     edited some imported parts.
   - **Cancel on conflict** — aborts the whole import on the first
     collision. Paranoid mode for incremental work.
7. Click **Import**. A progress bar shows the current file. The summary
   dialog at the end reports `Imported N parts, M assemblies. K errors.
   J skipped.`

## What the imported parts look like

Open any imported `.zipt` from the **File** tab. You'll see:

- **Browser pane:** the standard origin features (XY/XZ/YZ planes, X/Y/Z
  axes, origin point) plus a single feature node labelled
  `Imported (<filename>.step)`. That feature is read-only — its
  right-click menu has only "Properties", no Edit or Delete.
- **Model tab ribbon:** every Add* button (Sketch, Extrusion, Revolve,
  Fillet, Chamfer, Hole, Shell, Sweep, Linear Pattern, Mirror, Work
  Plane, Work Axis, Work Point) is disabled with the tooltip *"This part
  was imported from Inventor and is read-only. Re-author parametrically
  by creating a new part."*
- **Parameters panel:** lists the numeric user parameters from the
  `.ipt` as plain numeric values. No expressions, no dependency cascade.
- **Properties panel:** shows all the iProperties from the bag.

Open an imported `.ziasm` and the browser pane shows the assembly tree.
Components sit at their Inventor-exported positions. The constraints
list is empty — you'll need to re-add mate/flush/angle constraints in
ZilInventor. The faces of the imported parts are still pickable for
constraint creation; ZilInventor uses an OCCT topology-index naming
scheme on imported geometry, so you can anchor constraints to faces of
imported parts and they'll survive saves and reloads (as long as you
don't re-import the part, which can change the face indices).

The BOM tab aggregates instances correctly. Each row shows the part's
**Part Number** (from `properties.partNumber`) and **Description** (from
`properties.description`), so existing iProperty hygiene pays off.

## Troubleshooting

### STEP export fails for a specific part

Inventor's STEP translator occasionally fails on legacy thread features,
broken sheet metal, or corrupted feature trees. Check `_export-log.txt`
for the specific message. Workaround:

1. Open the offending `.ipt` in Inventor manually.
2. **File → Save Copy As → STEP** (or the AP214 option in the format
   dropdown). Save as `<stem>.step` next to where the macro tried to
   write.
3. Author the JSON sidecar by hand based on a successful sibling — copy
   `SidePanel.ipt.json`, change the `name`, `step` field, and
   `properties` to match the failing part.
4. Drop both files into the export folder before running the importer.
   The importer doesn't care that you wrote them by hand.

### Cyrillic part names render as `???` in ZilInventor

This means UTF-8 didn't survive the export step. The macro uses
`ADODB.Stream` (Charset=`utf-8`) for all JSON I/O, which works on every
Windows version that ships with MDAC 2.5+ (i.e. anything from XP onward).
If you see `???`:

1. Verify your Inventor 2012 install has ADODB available — open the VBA
   editor (Alt+F11), Tools → References, and confirm "Microsoft ActiveX
   Data Objects" appears. (It doesn't need to be checked; the macro uses
   late binding via `CreateObject`.)
2. If it's missing, install MDAC from Microsoft.
3. Re-run the macro from a fresh Inventor session (so no stale macro
   instance is loaded).

If the issue is on the import side (JSON shows correct Cyrillic but
ZilInventor renders `???`), file an issue — the importer side is fully
UTF-8 throughout.

### Macro silently exits without producing files

Almost always a macro-security setting. **Tools → Macros → Security…**
should be set to **Disable with notification**. The "Disable without
notification" setting silently kills macros, which feels like the macro
ran successfully but did nothing.

### Numbers in JSON look like `1,5` instead of `1.5`

The macro normalizes numbers via `Replace(CStr(d), ",", ".")` precisely
to handle this on Ukrainian/Russian Inventor installs. If you still see
commas in JSON output, you're running an older copy of the macro —
re-import `ZilInventorExport.ivb` from this repo and save the project.

### Re-running a single failed file

To recover from a one-off failure without rerunning the whole batch:

1. Open the failing `.ipt` in Inventor (find the path from the log).
2. Run `ZilInventor_ExportActiveDocument` and pick a temp output folder.
3. Copy the resulting `<stem>.step` and `<stem>.ipt.json` from the temp
   folder into the original output folder, alongside its dependencies.
4. Re-import in ZilInventor. The conflict policy controls what happens
   to already-imported parts.

### Output folder gets too big

Each STEP file mirrors the geometric complexity of the source `.ipt`.
A typical furniture part is 50–200 KB; complex extrusions with many
filleted edges can hit a few MB. A 500-part library typically lands
in the 100–300 MB range. The output folder is throwaway — delete it
once the OPFS-side `.zipt`/`.ziasm` files are written and verified.
