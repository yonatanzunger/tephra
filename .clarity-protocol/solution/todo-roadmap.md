# MT — the TODO list

**Design: `goal/todo.md` and `solution/todo.md`. Decisions: D55–D59.**

Six phases. The rule for every one of them is the rule MC ran under: **`npm test`,
`m0`, `m1`, `m2` and `m3` are green at the end of it.** A phase that cannot be
finished with the app running is too big and gets split.

**The ordering is forced by three things**, and only three:

- **Identity is a one-way door** (D56). Ids written from day one are cheap;
  retrofitting them onto a year of carried-forward lines is not. So the format
  comes before anything that would put lines in a file.
- **Interaction 1 dominates.** Reading the list, checking things off and adding
  to it is many-times-daily; everything else in `goal/todo.md` is at most daily.
  So the list surface comes before the walk, the pivots and the cap.
- **T12 cannot ship before T11.** The cap works by degrading visibility and the
  walk is what makes that safe. This is the design's own coupling and it is not
  negotiable.

Everything else is ordered for the shortest path to something usable, which is
the end of MT3.

---

## MT1 — Directory documents, and the stream's migration

**D59, and nothing user-visible changes.** That is the marker of a good first
phase: it moves the spine onto its final footing and the app behaves identically.

- `kindOf` answers for directories by extension, the way it already answers for
  files — one function over both, replacing the hardcoded `stream/` prefix test.
- Path composition generalises with it: `dayFile(date)` today hardcodes
  `STREAM_DIR`, and becomes a function of which directory document is asking.
- `DocumentId` for a multi-file document is its directory path. `STREAM_ID`
  stops being the literal `'stream'` and becomes the `.stream` directory at the
  root — which retires the `id === STREAM_ID` special cases in `Corpus` rather
  than adding a second set beside them.
- `stream/` → `notebook.stream/`, with a migration script. Day files are already
  `.md` and do not move.
- The sidebar's directory listings exclude kinded directories **generically**
  rather than by name, or a todo list arrives as several thousand documents.
- Fixtures and harnesses: `m0`–`m3` and `verify-git.ts` compose `stream/…` by
  hand in several places.

**Accepted cost:** restore cannot reach versions committed before the rename
(D59). Deliberate; there is nothing critical behind that seam.

**Does not do:** anything about todo.

## MT2 — The kind: format, ids, carry

**The one-way door, and it is testable with no UI at all** — which is the point
of doing it here. A todo file opens in the markdown surface meanwhile, because
`surfaceFor` falls back to it, which is R26 working as designed.

- `shared/kinds/todo.ts` — the parse, shared by main and the renderer for the
  reason `shared/fileset.ts` and `shared/prose.ts` are: the assisted and typed
  entry paths in T16 must be incapable of disagreeing. Item line, status glyph,
  `#tag` and `#'multi word'`, `DUE <date>` with relative forms resolved to
  absolute on recognition, and the trailing item marker.
- `item` joins the `MARKER` alternation in `markers.ts`. That is the whole
  change to the shared scanner; the todo parse splits the marker's fields.
- `TodoDocument extends SegmentedDocument` — `load`, `keys`, and nothing else,
  because everything else is inherited.
- `carry()` — materialise today from the most recent day that has a file.
  Automatic, idempotent, and **not the walk's** (D55, revised). Skipping three
  days produces today from Monday, once.
- Verbs: `add`, `setStatus`, `setDue`, `tag`, `untag`, `edit` — each one
  `replace()`, each stamping mtime.
- Ids: eight base-36 characters. **Minted against the document until the index
  exists** (MT5), which is what eight characters are for — the unchecked window
  is safe on its own, and the check makes it certain later.

**Does not do:** any surface, any capture, any index.

## MT3 — The list

**The first entry in `SURFACES`, and the first thing in Tephra shown as
something other than running text.** The unknowns of this whole milestone are
here rather than in the storage, so it gets a phase to itself.

- Rows: status glyph in a narrow left column, text with live links, tags at the
  right, the due date allowed to be loud.
- Creation order, oldest first, and it never re-sorts under you.
- Check off in one keystroke; finished items stay, greyed, until the next carry.
- **The row edit commits once** — text, tags and date together, one `replace()`.
  This is load-bearing for D56's mtime rule, not merely a UI preference.
- The due-soon band (T9): always present, usually short, absent when empty.

**It also delivers ML1, the shared link scanner** (`solution/link-roadmap.md`,
D61). A row is a table cell rather than CodeMirror, so rendering a live link in
one means finding links in a string — and without the shared scanner that is the
codebase's third link regex. Counted there, built here.

**Does not do:** the walk, the cap, the overflow rule, the pivots. The list is
the whole list, in order, and that is already useful.

**Usable from here.** MT1–MT3 is interaction 1 complete.

## MT4 — Capture from elsewhere

**T13, and the guard against the success criterion's first failure mode.**

- From the stream mid-sentence: the selection or the line becomes an item and
  leaves a link behind, the way `branch` already does.
- A quick-add from anywhere, keyboard-first, text and nothing else.
- `#` and date entry as a typist's assistant that produces character-for-
  character what the typed path produces (T16).

## MT5 — The walk, the tag index, and then the cap

**In that order, because the cap depends on the walk** and the walk's completion
list wants the index.

- The walk: every live item, defaults to unchanged, one gesture when nothing has
  moved. Offered on the first open of a day, never modal.
- The tag index (T6): which tags have live items, which do not. This is what
  makes MT4's completion useful, and it is where id minting starts being
  checked (MT2).
- **Then** the soft cap (T12): the count at the end of the walk, and the
  overflow rule below the fold. Nothing hidden, nothing one click from lost.

## MT6 — The pivots and the drawer

- Tag pivot (T8) — live items and recently resolved ones together. Cheaper than
  `scope.md` feared: every live item is in today's file, so the live half is a
  filter over **one segment** and writes back as an ordinary edit. Only the
  resolved tail reaches into other days, and it can be read-only.
- Scrub to a past day (T7's flow 7) — read-only, and nearly free: it is opening
  a file.
- The backlog drawer (T14) — reachable and counted. **Resurfacing is deferred**
  (Q3a), and until it lands T14 is knowingly unmet.

---

## ML — the link directory, which is not part of this

**D57: it is a corpus capability, not a TODO feature**, and it has its own
roadmap in `solution/link-roadmap.md`. It shares exactly one piece of code with
this milestone — the link scanner, which MT3 delivers as ML1 — and nothing else:
D57 already made the TODO link mode a filter over a corpus-wide index rather
than something built here.

**It lands after MT3**, on urgency rather than on any structural driver. The
list is what is needed first; the directory arrives while MT4–MT6 are still
ahead, so anything that wants it has it.

## What is deliberately not here

- **Backlog resurfacing** (Q3a). Deferred to a milestone of its own, to be
  answered from use. Safe to defer because copy-forward already records every
  input such a mechanism could want.
- **Per-item history.** It falls out of the storage (D56) and nobody asked for
  it. Worth a view eventually; worth building nothing for now.
- **The graveyard problem.** Explicitly out of scope in `goal/todo.md` — it is
  about projects dying by neglect, not about items, and it gets its own project.
- **Mobile.** v2b, behind sync. The task now is confirming nothing here
  forecloses it, not designing it.
- **Bounding `SegmentedDocument`'s whole-history methods.** Noticed here, but
  it is the stream's problem more than todo's, and it is a change to the spine.
  Recorded in `document-roadmap.md`.
