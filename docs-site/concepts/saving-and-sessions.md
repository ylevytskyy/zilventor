---
title: Saving and Sessions
---
# Saving and Sessions

> Zilventor saves your work for you as you go — you don't have to remember to, and there's
> nothing to click.

## Why there's no Save button

Open the **File** menu and you'll notice **Save** is greyed out. That's not a bug — it's
permanently disabled, on purpose. The app autosaves continuously in the background, so a
manual Save action would be redundant at best and misleading at worst (it would imply your
edits aren't already safe). If you're looking for a way to get a copy of your document out of
the browser, that's **Save As** — covered below.

<!-- SCREENSHOT: File menu with the disabled Save button next to the enabled Save As button -->

## Autosave mechanics

Every edit to the document you're working on schedules a write to the browser's
Origin-Private-File-System (OPFS) — a sandboxed storage area belonging to the browser, not a
folder your OS file browser can see. Writes are debounced: the app waits 500ms after your last
change before it actually saves, so a burst of edits (dragging a slider, typing dimensions)
produces one write, not dozens.

While this happens, the app tracks a visible save state — saving, saved, or error — so you get
feedback rather than silence. Each successful autosave also captures a throttled 256px
thumbnail of the current viewport, used later in file pickers and recent-files lists.

What gets written depends on what kind of document is open:

- A **Part** writes a `.zipt` file through the kernel's serializer. If the feature tree hasn't
  produced a solid yet (a brand-new, still-empty part), autosave skips the write rather than
  raising a spurious error.
- An **Assembly** merges in BOM, cut-list, and color-override data and writes a `.ziasm` file.
- A **Drawing** writes a `.zidw` file.

All autosave writes take an OPFS lock on the target path, so two writes to the same file can't
race and corrupt each other.

## Session restore on reload

When you reload the page (or reopen the tab), Zilventor tries to put you back where you left
off. Once the kernel finishes initializing, the app checks whether a document is already open;
if not, it looks up a pointer — document kind plus OPFS path — that the last autosave recorded,
confirms that OPFS file still exists, and reopens it automatically. Things tied to the document
itself, like the custom texture registry, come back with it.

Camera position and the current selection aren't part of this restore — you'll land back on
the same document, but framed and selected however the viewport happens to initialize on load,
not exactly how you left it.

If restore fails for any reason (for example, the OPFS file was cleared), it fails silently:
the app just starts with no document open, without showing an error.

## Save As

**Save As** is the one manual save action that exists, and it's enabled whenever a document is
open. It packages the current document — using the same packer and thumbnail logic as
autosave — into a downloadable archive file (`.zipt` for a part, `.ziasm` for an assembly,
`.zidw` for a drawing) and hands it to the browser's download mechanism, writing to your actual
disk instead of OPFS.

Reach for Save As when you need to get a document out of the browser sandbox: backing it up
outside OPFS, sharing it with someone else, or moving it to another machine.

## Format versions

Every saved file embeds a `formatVersion` number in its manifest. The current version is
**41**.

- **Opening an older file** — one saved by an earlier build, with a lower `formatVersion` — runs
  it through a chain of migration steps automatically. This is transparent: the file just opens
  with all current fields populated, and you never see the migration happen.
- **Opening a newer file** — one whose `formatVersion` is higher than what your running app
  supports — can't be handled automatically, since the app doesn't know what the newer fields
  mean. Instead of risking a corrupted open, it shows a message telling you the file was saved
  by a newer version of Zilventor and to update before opening it. If you hit this message,
  someone (or some device) saved the file with a newer build than you're running — get the
  latest version rather than trying to force it open.

<!-- SCREENSHOT: the "update to open" dialog shown when opening a file with a newer formatVersion -->

## See also

- [Documents and Kinds](./documents-and-kinds.md)
- [Your First Project](../getting-started/your-first-project.md)
- [Known Limitations](../troubleshooting/known-limitations.md)
