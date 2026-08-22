# Build milestones

Where the code is, and what comes next. **The feature list this draws on is
`features.md`; the staging rationale is `components.md`.** This file only says
what has been built and in what order the rest arrives — it invents no scope.

Milestones are *slices*, not feature groups. Each one is a path through W, X and
Z that works end to end, because a layer built alone is a layer whose interface
has never been tested.

---

## M0 — the slice ✅

**Purpose: falsify the API shapes before building on them.** One path through
every layer, implemented naively, so that a wrong interface is discovered while
it is cheap to change.

Open today, type, autosave, quit, reopen and find everything where it was. It
does that, verified by `npm run m0`, which launches the app twice against one
notebook and reads the files on disk rather than the app's internals.

**In:** the notebook directory and atomic writes; the day-file format with
frontmatter spliced rather than serialised; markdown-aware span scanning;
Document with generation, batched replace and document-scoped undo; the
main/renderer split with a synchronous coordinate facade; CodeMirror with the
widget layer, vim as a setting, and rendered constructs that unrender under the
cursor; Pane with back/forward and explicit extend; position restored across a
restart; external edits adopted, and divergence surfaced rather than resolved.

**Out, and deliberately so:** everything below. `untag`, `removeAnchor`,
`branch` and non-date navigation targets throw rather than pretend.

**Known gaps inside M0's own scope:** the non-vim keymap is CodeMirror's
defaults rather than a designed one (D15 asks for designed, since it is what
mobile always runs), and typography is fixed rather than tunable (R1.3).

## MV — the visual system (in progress)

Brought forward ahead of M1, and the design's own words argue for it:
`components.md` names exactly two things expensive to change later, and one of
them is "the editing surface plus visual system, because they decide whether the
thing gets used at all." The earlier ordering had it near-last.

- ✅ A **theme system** — named parameter sets in `config/themes/`, active theme
  per device (D41). The four proof-sheet arrangements ship as built-ins, with
  live controls under View ▸ Typography (⌘⌥T) so the measure is settled by
  reading rather than by argument. Default is Aldine at 54ch
- The **annotation gutter reserved in every theme**, so marginal notes can
  arrive later without reflowing a line. This is the part that cannot wait —
  and R27/R28 raised its stakes: the margin is a second column of *text*, sized
  and toned to be read, not a faint aside. The proof sheets were corrected once
  already for exactly this
- ✅ **Per-script size adjustment**, Hebrew first (D41) — runtime `@font-face`
  with `unicode-range` and `size-adjust`, face and scale as theme parameters
- The **left nav**: sections as expandos, pins first (D10). Filesets arrive in
  M3, so it opens with dates, which are v1 anyway (R9)
- ✅ A **fixed frame** (D42): Reserved nav, a fixed measure with the slack to its
  right, and the capture stream as an overlay pinned to the right edge. Measured
  in the app at five widths, toggling both — nothing moves, nothing narrows
- Somewhere non-modal for **format anomalies** to surface, which `format-spec.md`
  leaves explicitly open

**Accepted risk:** the corpus is not yet safe — no split, no WAL, no git. Fine
while testing against `./run.sh --scratch`, and not fine for real writing.

## M1 — the corpus becomes safe

Everything that stands between "it writes files" and "it will not lose twenty
years of them." Nothing above this is worth building first.

- Day-file split at 1 MB, with a forced test — a path that fires once every few
  years is broken when it fires (`implementation-notes.md` §5)
- The WAL, and the three write tiers each with quiescence **and** a ceiling
  (D32). M0 has the file tier only
- Local git repository, commits, restore (D32, D34) — versioning is local from
  v1, so v2a adds distribution rather than history
- The purge procedure, owed before the first *push* rather than the first
  commit (T10, D36)

## M2 — range operations

Select a range, then do something with it. Requirements 11–14 are one gesture
wearing four hats, and selection is the core interaction primitive.

- Tag a range with a subject; untag
- Bookmark a point
- Print a range — the web layer renders, the shell supplies the panel
  (Spike B; ~90 lines of shared JS already proven)
- Branch a range into its own file, create → update references → delete (D13)
- **Comment on a range, rendered in the reserved margin (R27)** — the same
  gesture again, and per Q8 the storage question is open. MV reserves the space;
  M2 fills it
- **Import clipboard text to annotate (R28)**, the cheapest of the three inbound
  paths and enough to answer Q9 by living with it. `.docx` follows; `.pdf` is v2,
  because extraction is its own problem and not this one

## M3 — navigation and filesets

- Section/fileset index format, and the left nav of expandos (D10)
- The default section, holding the pins, always present
- Jump to a bookmark, a file, a URL, an external document by OS intent
- Pinned lists and the events calendar, which are markdown files rather than
  features (R18, R19)

## M4 — retrieval

Marked ◆ in `features.md` as arguable, and settled as **the last things built in
v1**: in scope, after the core works.

- Literal substring search over the corpus
- Filtered views by tag and by date range — one mechanism, three query shapes
- Image paste writing a file and inserting a link (R7)

## M5 — the editing surface finished

- A non-vim keymap, deliberately designed rather than inherited (D15)
- Typography and the visual system, tunable (R1.3)
- Rendered editing of inline constructs (◆ in `features.md`)

---

**Immediately after MV:** the mobile proof sheet (Q10), opened on the phone. The
frame decision D42 is desktop-only by construction, and the mobile questions —
what replaces the margin, capture or reading, and what the keyboard does to both
— are recorded now so they keep their edge while MV is built.

## After v1

`components.md` has the reasoning; in short: **v2a** is sync alone, **v2b** is
Android, **v3** promotes what earned it. The order matters — sync must land
first because the phone needs a corpus for any judgement about it to mean
anything, and the two risks should not arrive together.

## Running it

`app/run.sh` is the wrapper, and `app/Tephra.command` is the same thing made
double-clickable from Finder.

```
./run.sh              the real notebook at ~/Tephra
./run.sh --scratch    a throwaway notebook, for testing
./run.sh --root PATH  a specific one
./run.sh --dev        renderer HMR; a dev-only exception to D17
```

It rebuilds when anything under `src/` is newer than the built main process, so
"did I remember to build?" stops being a question. It also unsets
`ELECTRON_RUN_AS_NODE`, which is set in some shells and makes `require('electron')`
return a path string — the app then dies at startup with an error naming none of
that, and it has cost an afternoon once already.

**Real packaging is unscheduled**: electron-builder, an icon, a signed `.app`.
The `.command` shim is the cheapest thing that behaves like an application in
the meantime, and nothing depends on it.

## How to know what to test

Test M0's list above. Anything in M1 and beyond is absent, and absence is not a
bug. The one thing worth re-checking after every milestone is the acceptance
run — `npm run m0` — because it asserts the property the whole project rests
on: that nothing written is ever lost.
