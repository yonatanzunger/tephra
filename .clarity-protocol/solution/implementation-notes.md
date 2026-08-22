# Implementation notes

Everything captured so far that is a *build-time* obligation rather than a design rationale. Organised by when you will need it, not by where it came from.

**Every entry states the failure it prevents.** A rule without a reason gets removed as an oddity by whoever reads the code next, and that person is you in eight months.

---

## 1. Invariants that fail silently

These are the ones where the code keeps running and something is quietly wrong. Highest priority.

**Watch directories, never file descriptors.** An fd-based watcher dies *without erroring* when a file is atomically replaced by `rename(2)` — which is how our own writes work. The editor and the disk then drift apart with nothing reported.

**A stale position must throw, never resolve approximately.** T1's likeliest mechanism is an operation computed against text that has since moved: a queued tag, a branch, a print. Rejecting stale `SessionGeneration`s converts the whole class into a visible error.

**Never rewrite a file you failed to parse.** Malformed YAML means "treat frontmatter as absent" *and* "do not touch this file." Overwriting what you could not read is how hand-edited content disappears.

**Rewrites splice into the original bytes; they never serialise from a parsed model.** Model-serialisation silently reformats — YAML key order, list markers, wrapping — and turns every save into a diff against itself. This breaks round-trip discipline from day one and is invisible until the first sync conflict.

**Parse markdown, never regex.** This is a physics notebook: it will contain fenced code, and code *about* Tephra will contain Tephra markers. A fence-aware scan costs almost nothing; a regex scan is wrong in a way that surfaces once, badly. **This applies to v1's scan-based search and enumeration too**, not just the parser.

**Preserve unknown frontmatter keys verbatim.** A future version's key, or a human's, must survive a round trip.

**`onChanged` must not fire on the window that originated the change.** The editor has already applied it locally; re-applying is exactly how text gets duplicated.

**`StoragePosition` must never appear in a signature Z can reach.** It is used heavily inside Document and nowhere else.

**Adjacent same-segment spans must coalesce.** A within-day split otherwise becomes visible above the API, which is the one thing D8 and D19 exist to prevent.

**Quiesce before any external mutation of the tree:** flush, release, mutate, reload. Skipping the flush silently clobbers unsaved edits.

---

## 2. The editing surface

All of this is measured, from Spike 01.

**Block widgets cannot come from a view plugin** — CodeMirror refuses outright. Inline widgets (equations mid-line, thumbnails) rebuild per viewport in a `ViewPlugin`; block widgets (tables, display equations, figures) live in a whole-document `StateField`. A state field cannot see the viewport, so it must map its ranges through each change and rescan only the block the edit touched — **never rescan the document per keystroke.** Measured: 2 ms initial scan, 0.2 ms incremental.

**Rendered constructs must unrender under the cursor.** `@replit/codemirror-vim` does its own offset arithmetic and never consults `atomicRanges`, so nothing can tell it a widget is one unit. Left rendered, six `l` presses leave the cursor frozen while vim walks the hidden source underneath. Unrendering makes every vim operation correct because vim is then operating on the text it thinks it is.

**Block widgets must also unrender from a *neighbouring* line.** Replacing whole lines removes them from the visual layout, so `j`/`k` skip them entirely — and unreachable means uneditable.

**Inline widgets atomic, block widgets not.** Marking blocks atomic makes the problem worse and buys nothing.

**Disable the editor's own history.** Undo is document-scoped (D23) and lives on Document; two histories over one text will diverge.

**Model construction is separate from view construction.** A widget that opens its file during view construction re-reads constantly and loses edit state on reparenting — R1.2 failing at the framework level rather than in application logic.

---

## 3. Storage, files and history

**Every write tier needs a quiescence trigger *and* a maximum interval.** WAL batched ~50 ms; file write on ~1 s quiescence **or every 5 s**; commit on ~5 min quiescence **or every 30 min, or session end**. Quiescence alone fails under exactly the condition this notebook exists for — an hour of continuous writing never reaches quiescence, so nothing is ever written.

**Commits never block typing.** Main process, asynchronous, off the critical path.

**`.gitignore` contains `.tephra/`.**

**Never call whole-tree `status` on the hot path.** We always know which files changed — the editor knows what it wrote, the watcher reports external edits. A full scan happens once, at startup after the app was closed.

**A restore truncates the undo stack.** So does a divergence resolution. Mapping an undo through either is not well-defined, and a wrong answer is silent corruption.

**Remote changes map through the undo stack without entering it.** They are your own edits from another device, not a stranger's.

**The `lock` file is not optional.** Two Tephra processes over one directory fight over the WAL and the fold; the failure mode is corruption, not an error.

**`attachments.manifest` distinguishes evicted from deleted.** Both look identical on disk — a missing file — and that is the replica/cache confusion D5 exists to prevent, reappearing one level down.

**Anchor resolution never caches a file path.** Branching moves anchors between files; a cached path rots silently.

**`branch()` is one operation, ordered create → update references → delete from source.** Never expose the steps. The ordering is the only safety mechanism available without a cross-object transaction, and its worst case is duplicated content (visible, fixable) rather than dangling references.

---

## 4. Process boundaries and the shell

**The app serves itself from a custom scheme** — not `file://`, not a localhost server. Electron needs `registerSchemesAsPrivileged({ secure: true })` **before app startup**. A localhost server inside a desktop app is reachable by any other process on the machine, and this corpus holds other people's information (T8).

**The print document needs an explicit `<base href>`**, or every relative image silently 404s — printing renders through a temp file.

**Printing renders the range to HTML in the web layer**; the shell contributes only the panel. Both shells produced identical PDFs from the same ~90 lines of shared JavaScript.

**The WAL crosses to the main process.** The live buffer is in the renderer, and the renderer is the component most likely to die — durability that stays in the renderer is not durability.

---

## 5. Things that will otherwise never be tested

Each of these is a path that fires rarely enough to rot, or a failure that cannot be observed by using the app normally.

- **The day-file split.** At 1 MB and ~100 KB a day this fires roughly never. **A path that fires once every few years is broken when it fires.** Force it with a synthetic oversized day.
- **Vim over every widget type:** motion across, `dd` on a line containing one, visual selection spanning one, undo restoring byte-for-byte. Spike 01's 28-assertion suite is the model.
- **Crash recovery.** Kill the renderer mid-typing; verify the WAL replays and nothing is lost.
- **Hand-edit arriving while the buffer is dirty** — the divergence path, which is rare by design (D12) and therefore untested by use.
- **Atomic-rename watcher survival.** Replace a file by rename and confirm the watcher still fires.
- **Unbalanced markers.** A `tag-start` with no end runs to the end of its segment and is *reported*; verify both halves.
- **Filename/frontmatter date mismatch** — frontmatter wins, repair offered.

---

## 5a. Watch in use — correct so far, but the failure would be quiet

Both of these are implemented and tested; they are here because the tests
encode *a* reading of the right answer, and only real writing will say whether
it was the right one.

- **Offsets near a segment boundary.** A buffer position on a day boundary is
  both the end of one day and the start of the next. It resolves to the LATER
  day, because a day body ends with a newline and that offset therefore renders
  at the first column of the next day — text typed there must land in the file
  the reader can see it under. The end of the window still belongs to the last
  segment, which is what makes appending work. Watch for text arriving in the
  wrong day around midnight, and for cursor jumps when a window is extended.

- **Tags and code spans interacting.** Marker scanning is fence-aware: markers
  inside fenced blocks, indented blocks and inline code spans are text, not
  markup. The uncomfortable case is a tag that *opens* outside a fence and would
  close inside one — the close is invisible, so the tag runs to the end of its
  segment and is reported unterminated. That is the specified degradation, but
  it will look like a bug the first time it happens while writing about Tephra
  in Tephra.

## 6. Claims not yet verified

Separated deliberately from everything above, which is measured or reasoned. **Do not build on these without checking.**

- **`clipboard.readBuffer('public.png')` may avoid Electron's `nativeImage` re-encode.** If it works, byte-preserving paste is a few lines rather than a native path. Also unverified: whether re-encoding strips the ICC profile, which would make "the pixels survive" slightly too strong.
- **`isomorphic-git`'s current maintenance status and API completeness.** The structural analysis in `git-library.md` is durable; library health is not something to take on my word.
- **That the repository is readable by standard git tooling.** This is the *decisive* acceptance test for any git implementation — the entire reason for choosing git (D32) is that the exit extends to the history.
- **Binary growth in git history** over twenty years of pasted images. Probably fine at this scale; worth measuring rather than assuming.
- **Window extent as a working number.** Spike A bounds the *window*, not the file; the extent that feels right in use is unmeasured.

## Themes in practice (D41)

Four named parameter sets ship as built-ins — Aldine, Sage, Night, Broad — and
are **seeded into `config/themes/` on first launch, never overwritten**. A file
that exists is left exactly as it is, even when it differs from the built-in of
the same name; someone who edits `aldine.json` and finds it silently restored
next launch learns not to trust the directory again.

**The name comes from the filename, not from inside the file.** Otherwise a copy
made for experimenting silently shadows the theme it was copied from.

**Parsing is lenient per field, not per file.** A theme is hand-editable (R26),
so the interesting cases are all the ways a person gets one wrong. One bad
number falls back to the default for *that field* and keeps the rest — losing an
evening's work to a fat-fingered digit would be a poor trade for strictness.
Numbers are also clamped: `size: 0` renders nothing at all, including the
controls that would let you fix it, which is an unrecoverable state reachable by
one typo.

**Six authored colours, eight derived tokens.** A theme names paper, ink, head,
faint, rule and accent; the ground and muted fills are mixed from them. Asking
for twelve values that have to agree is how a palette drifts out of tune, and
mixing *paper toward ink* means the derivation follows the theme rather than
assuming paper is light — Night gets a lighter rail beside dark paper, not the
reverse.

**The app renders the draft, not the saved file.** Moving a slider changes what
you are reading immediately; saving is separate and explicit. Apply-on-save
would turn choosing a measure into a guessing game, and the whole reason these
are parameters is that the four arrangements could only be judged by looking at
them.

**The panel states the consequence of the measure.** It is not only taste: the
measure decides how much width is left, and therefore whether the capture stream
lands on empty paper or covers the margin where commentary lives (D42, R27). The
panel says which, live, so the trade is visible while it is being made.

**The default is Aldine at 54ch.** It was chosen for a reason that can be
checked rather than argued: on a 1512px laptop it leaves the overlay landing on
slack, covering nothing. The previous default — 74ch, inherited from Spike A
when the text was centred and there was no gutter — made the stream cover 155px
of margin, and a unit test now fails if the default drifts back above 58ch.
