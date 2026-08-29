# MC — documents, kinds and windows

**Its own milestone, because it is a refactor of the spine** (D54). M3's
remaining bullets — reordering, deletion, jump-to-a-file, the pinned lists —
all write to documents or open them, so they resume on top of this rather than
being built twice.

**Each phase establishes one floor of the invariant stack** (`architecture.md`):
MC2 and MC3 put invariant 2 in place — X touches files only through documents,
and gets them only from the `Corpus` — and MC5 does the same for invariant 1 in
the renderer. Invariant 3 stays a direction rather than a rule for now.

The rule for every phase below: **`npm test`, `m0`, `m1`, `m2` and `m3` are green
at the end of it.** A phase that cannot be finished in a state where the app runs
is too big and gets split. Nothing here is a rewrite; each phase moves one thing
onto its final footing.

---

## MC1 — Kinds, and the day-shaped leak

**What changes.** `DocumentKind` becomes a real discriminator on `DocumentMeta`.
`extent()` and `dateAt()` — day-shaped, and answerable by nothing else — leave
the shared `Document` interface for a stream-specific one. `SegmentKey` gains
the constant a one-segment document will use.

**Why first.** It is pure refactor with no new object, so it proves the seam
before anything depends on it, and it makes the next phase's type errors
meaningful rather than noise.

**Proved by.** The suites, unchanged. A `Document` that is not a stream must not
compile against `extent`.

**Risk:** low. Callers are the print chooser, the timeline, the pane's date
targets and the service's IPC, all of which know they are talking to the stream.

---

## MC2 — `Corpus`: borrowing, and who hears about changes

The meaty one, so it lands in four pieces. **Each piece ends with every suite
green**; nothing below is a state the app cannot run in.

**Where it goes.** `main/x/documents/` — the floor of X, holding the `Corpus`
and, from MC3, the kinds. Nothing else in `x/` may see the corpus's file system,
and a directory says so better than a rule does (`architecture.md`, invariant 2).

### MC2a — the object, used by nothing

1. **`x/documents/corpus.ts`.** `use(id, work, how?)`, `list(kind?)`,
   `exists(id)`. `create`, `rename` and `remove` wait for MC3, when there is a
   kind that can be created.
2. **Opening is a factory keyed by kind.** One entry for now — `'stream'` — and
   an explicit throw for the rest, so MC3 adds a line rather than finding a
   place.
3. **Dedupe the OPENING, not the opened.** The map holds
   `Promise<Document>`, because two borrows racing on a cold id must not both
   construct one. This is the segment-cache race, and it arrives here by the
   same shape it did there.
4. **The cache.** Bounded LRU. **Never evict what is dirty; never evict what a
   window is pointed at.** `retain: false` never enters it at all.
5. **`mode: 'read'` refuses edits** — a document borrowed for a scan cannot
   dirty anything, so a batch pass has no flush obligation on its way out.
6. **Unit tests**, and these are the phase's real deliverable: one object per id;
   concurrent cold borrows yielding one instance; `retain: false` leaving the
   cache untouched; a dirty document surviving eviction pressure; a borrow that
   outlives an eviction attempt still valid; `mode: 'read'` refusing `replace`.

*Green because nothing calls it yet.*

### MC2b — the service borrows, and hears through the Corpus

7. **Windows are what "open" means, so the Corpus must know about them.**
   `watch(id)` returns an unwatch; the service calls it when a window opens and
   releases it when the window does. `LocalWindow` holds its document directly,
   so this is not bookkeeping for its own sake — it is what makes that reference
   safe.
8. **Event aggregation, which cannot wait for a later phase.** The service
   subscribes to `onJournal`, `onChanged` and `onDiverged` **once at
   construction, against one document**. With documents opening and being
   evicted, that subscription has no lifetime to live in — so the Corpus
   subscribes when it opens, unsubscribes when it evicts, and re-emits with the
   document's id. The service subscribes once, to the Corpus.
9. **`#windows` learns which document each window belongs to**, so a change
   reaches the windows over THAT document and no others.
10. **The 37 `#doc.` call sites become borrows**, through one `#stream(work)`
    helper. Mechanical, compiler-guided, one pass.

*Green because behaviour is unchanged: the stream is still the only kind, and
only the path to it moved.*

### MC2c — the tiers, and the commit that must not be early

11. **`flushAll()`**: every open dirty document writes. The file tier calls it
    instead of `#doc.writeDirty()`.
12. **The version tier calls `flushAll()` before it commits.** This is the piece
    that cannot wait for MC7: the moment a SECOND document can be dirty — MC4,
    where a pin becomes a document edit — a commit that flushed only the stream
    would capture a file without the edit sitting in memory beside it. That is
    M1's subject arriving through a side door.
13. **The WAL becomes per document.** `walFile(docId)` already takes an id and
    has only ever been given `'stream'`; the journal handler now knows which
    document an edit belongs to, so it routes to that document's log. Doing it
    here rather than at MC4 avoids a scramble when the second writable kind
    arrives.

*Green: `m1` is the proof, since it is the suite that asks whether anything can
be lost.*

### MC2d — proving it

14. **The existing suites are the regression net** — `document-service.test.ts`
    and `document.test.ts` in particular, which drive the ordering guarantee and
    the write tiers through the service.
15. **New: a borrow under load.** Twenty concurrent borrows of one id, with
    edits interleaved, ending with one document and no lost edit.
16. **Eviction under pressure**, as far as one kind allows: a borrow survives
    ten sweeps at a cache bound of zero, a borrow that THROWS still releases,
    and a dirty document is still held at a bound of one. **The multi-document
    version — cycling clean documents through a bounded cache while one is dirty
    — moves to MC3**, because it needs a second kind to be openable and writing
    it against one document would be testing the test.
17. `m0`, `m1`, `m2`, `m3`.

### What MC2 does NOT do

No new kinds (MC3), no renderer changes (MC5), no `ui-state` changes (MC6), and
no restore behaviour (MC7). If a step here seems to need one of those, the
sequencing is wrong and it is worth stopping to say so.

### The risks, and what each one is mitigated by

| Risk | Mitigation |
|---|---|
| The 37 call sites hide a behaviour change | The stream stays the only kind, so any behaviour change is a bug rather than a design choice — and the suites already cover ordering, tiers and recovery |
| A window outliving its document | `watch(id)` is taken when the window opens, not when it is used; the never-evict rule does the rest |
| Two borrows constructing one document | The map holds the promise, not the result. Named in MC2a because we have paid for this exact race once |
| A commit landing between an edit and its flush | `flushAll()` before commit, in MC2c rather than MC7 |
| The eviction bound being wrong | Start large enough that eviction never fires in ordinary use, and let MC3's sweep — which retains nothing — be what proves the bound is not load-bearing |

## MC3 — The markdown kind, and the readers that stop reading files

**Split in two, on measurement.** `StreamDocument` has 83 members and about
thirteen of them are day-shaped: the loader, `dates`, `extent`, `dateAt`,
`proseIn`, `externalChanged`, `branch` and their helpers. Everything else is
already keyed by `SegmentKey` — `DateKey` is an alias for it — so a second kind
does not need a second implementation of any of it. **That makes the extraction
worth doing and too large to do beside anything else.**

### MC3a — untangle the index from the document *(done first, stands alone)*

`Document.spans()` consults the index while the index reads days through the
document. The corpus-wide question moves to where it belongs: **the service asks
the INDEX for corpus-wide spans, and a document answers only about itself.**
`attachIndex` and the `SpanIndex` interface go away, and the two arrows in
opposite directions become one.

### MC3b — `SegmentedDocument`, and the kind that stands on it *(done)*

The generic machinery — edits, history, spans, comments, tags, the journal —
becomes a base class whose only abstract members are *load a segment* and *list
the segments*. `StreamDocument` supplies days; `MarkdownDocument` supplies one.
Then `StreamIndex` and `Filesets` take the `Corpus`, the sweep borrows
`{ mode: 'read', retain: false }`, and the import-graph test lands.


**What changes.** `main/x/documents/kinds/markdown.ts`: one segment, keyed by the constant,
no whole-body date span (that span is a day's, and `Segment` learns the
difference). `StreamIndex` and `Filesets` stop taking a `Notebook` and take the
`Corpus`; the index's sweep borrows `{ mode: 'read', retain: false }`.

**As built, the index went the other way, and that is the better answer.** It
did not move ONTO the Corpus; it moved INSIDE it, to
`main/x/documents/corpus-index.ts`. The reason is the one thing the index exists
for: answering "every subject in twenty years" without opening twenty years of
documents. It scans bytes and compares `stat` stamps, and routing that through
open documents would have deleted the feature while satisfying the rule. So the
rule is stated as what it always meant — **only the floor touches storage** —
and the index is part of the floor, which is exactly what D52 called it.

`Filesets` did move onto the Corpus, and pinning is a document edit now. That
found three things at once: a body has no frontmatter in it, so a title is a
question for the DOCUMENT (`titleOf` / `setTitleOf`, which is not an edit — no
span, no undo entry, no generation); an empty file is not a disposable day, so
`disposable` is a fact about days and now says so; and **an open document exists
whether or not its file does yet**, which is what `Corpus.exists` and
`Corpus.list` now answer. Without that last one the second pin into a new
section could not see the first, and the sidebar showed the notebook as it had
been a second earlier.

Two names came along with it. `StreamWindow` is `LocalWindow`: it was never the
stream's, and it sits beside the renderer's `RemoteWindow` implementing the same
`DocumentWindow` from opposite sides of the boundary. `StreamDocument` moved to
`main/x/documents/kinds/stream.ts`, beside `markdown.ts` — a kind, in with the
kinds, which is also what let the floor rule pass without an exception for it.

**The invariant gets a test, not a comment.** Nothing outside `x/documents/`
imports `w/notebook.ts`, asserted over the import graph the way
`layering.test.ts` (which is `no-electron.test.ts`, grown into its real subject)
asserts its own rule. A directory boundary rather than an
allowlist, so adding a kind cannot require editing the test. Three violations of
that earlier rule got through comments; this one starts as a test.

**And the same test catches the ambient DOM types.** Electron's own type
definitions pull the DOM into scope in the MAIN process, so `Document`, `Window`
and `File` are all silently bound there — `corpus.ts` lost an hour to a bare
`Document` resolving to the browser's and complaining about `createElement`
several lines later. The rule is one line: a main-side file that names one of
those must import it. (Renaming ours to `File` was considered and rejected:
`File` is a DOM global too, and X's object is a DOCUMENT — W has the files, and
the whole point of `Corpus` is that the two are not the same thing.)

**The two exceptions are named in the test itself**: machinery (`.tephra/` state
— the index cache, the WAL, the lock) and the version store, which `History`
reaches for the log and for commits. Anything that writes corpus CONTENT still
goes through a document.

**The rule is about the CORPUS, not about machinery.** The index's own cache
(`.tephra/index/…`), the WAL and the lock are machine-local state rather than
logical documents, and they go on talking to W directly. Without that line the
rule eats itself: the index would borrow documents in order to store what it had
learned about documents.

**What this deletes.** The merge rule — *loaded answers, disk otherwise* —
disappears with its second path, and `Document.spans()` stops consulting the
index. The two arrows in opposite directions become one.

**Proved by.** The index equivalence test already written (same answers with and
without a cache) plus a new one: a corpus sweep leaves the cache no larger than
it started, which is what `retain: false` is for.

**Risk:** medium, and concentrated in the index. Its rules are already tested,
including "a loaded day answers for itself", which must keep passing with the
mechanism replaced.

---

## MC4 — The fileset kind, and pinning that can be undone *(done)*

**What changes.** `main/x/documents/kinds/fileset.ts` gains `entries`, `pin`, `unpin`,
`reorder`, `remove` — all as `replace` calls on the document. The service's
fileset writes route through `corpus.use`, so two writers can no longer race.

**What this fixes.** D53 claims a pin is undoable by the ordinary undo. It
becomes true here.

**Proved by.** m3's pinning section, plus: pin, undo, and the line is gone from
the file; pin while the fileset is open in a window, and the window sees it.

**Risk:** low, on top of MC2 and MC3.

**As built.** `FilesetDocument` has `entries`, `pin`, `unpin`, `remove` and
`reorder`, each one a `replace` on a span of the body; `Filesets` keeps only
what is about no single section — walking the tree, resolving the entries, and
the order-does-not-gate rule. For the spans to exist the parser had to say WHERE
each entry is, so `shared/fileset.ts` gained `scanEntries` (offsets) with
`parseEntries` built on it: one parse, both uses.

`reorder` is one batch on purpose. Two edits would let an undo land between them
and leave the entry deleted and never reinserted — a pin lost to a gesture meant
to be free.

Opening a window on a fileset found a day-shaped assumption in the base class:
`read()` walked from the first key to the last by ADDING DAYS, which is right
for a stream and nonsense for a note whose one key is not a date. It asks
`segmentsAcross` now, which asks the kind.

**What is proved, and what is not yet.** The unit suite proves the document
claim: pin, undo, and only the pin comes back off; pin while a window is open on
the same fileset, and the window has it without being told. The GESTURE is not
reachable from the UI yet — ⌘Z goes to the focused document, and the only
focusable one is the stream. That waits on MC5 and MC6, and m3 says nothing
about it until then rather than claiming it early.

**And ⌘Z going to the stream is right, not a gap.** Focus decides whose undo
stack a keystroke means, and while the editor is the only thing focusable, the
stream is the honest answer — undoing a pin from inside the editor would be a
keystroke reaching past what the person is looking at. What makes the pin's
undo reachable is the SIDEBAR becoming focusable, which is where the gesture
belongs; until then the verb is undoable and simply has no key on it.

---

## MC5 — The renderer learns about kinds *(done)*

**What changes.** `renderer/src/x/kinds/*` forwarders and
`renderer/src/editor/kinds/*` surfaces, each with a registry keyed by kind and
markdown as the default. `RemoteDocument` stops hard-coding `'stream'`. The
pane's `{ kind: 'document' }` target stops throwing, so a sidebar row for a note
or a fileset finally opens it.

**Proved by.** m3: click a file entry, land in that document, edit it, undo it,
come back. And the first thing that has never worked — a `Reference{kind:'file'}`
that resolves.

**Risk:** medium. The renderer has assumed one document since M0, in more places
than the type system will show.

**As built.** Four seams, in the order they had to be cut:

1. **Main speaks in document ids.** `open`, `read`, `undo`, `redo` and `spans`
   take one, defaulting to the stream so nothing that already worked had to
   change. `DocumentInfo` carries the id and the document's own `title`, and
   `positionAt` moved onto the shared `Document` interface — a position carries
   a generation, and every caller that assembled one by hand was keeping a
   second mirror of that number (D33).
2. **`Documents`, the renderer's small half of the Corpus.** No eviction, no
   borrowing — only the two things that break the moment a second document
   exists: one handle per document, and ONE subscription to the pushed window
   changes. A per-document listener would have seen every other document's
   messages and adopted a generation that was not its own.
3. **The Pane crosses documents.** `#open` returns the document as well as the
   window, because three of its targets are the stream's and two name a document
   of their own. `RemoteStream` holds what is day-shaped (`today`, `extent`,
   `dateAt`); the base handle is what any kind can do.
4. **The editing surface is per kind.** `editor/kinds/registry.ts` says whether a
   kind has day separators, an annotation layer, and where the caret lands.
   Every entry is something that would be actively WRONG elsewhere — a day
   separator through a note that has no days, or a caret at the END of a
   document nobody is appending to. Markdown is the default rather than an
   entry, so an unknown kind still opens (R26).

**And the bug underneath all of it.** A section entry's `../notes/offer.md` was
resolved from a DAY FILE's depth — the base `resolveInsideNotebook` had always
used, correctly, back when the stream was the only document with links in it. It
landed outside the notebook, failed containment, and the row said "not found":
a correct link, a real file, and an entry that could not be clicked. A link is
relative to the document it is written in, so `from` is now part of the
question, in the panel's `missing` check as well as in following the link.

m3 grew a section for it: click a row that names a file, land in that document
under the name it gives itself, at the top rather than the end, with no day
separators; type, undo, and find both in the file; then go back to the stream.
58 checks, and it is the first time `Reference{kind:'file'}` has ever resolved.

---

## MC6 — `AppWindow`

**What changes.** Windows get identity and a name (the document's; the stream is
`Notebook`), `createWindow(target)`, and the File menu: New, Open…, Open in New
Window…, Notebook, Close Window. `ui-state.json` holds a **set** of windows.
`__view`/`__pane` become one `__tephra` per renderer, and the harness learns to
address a window by name.

**Proved by.** m3, across a quit: open a note in a second window, quit, relaunch,
find both windows where they were. Then edit the same document in both and watch
each see the other's change (D45, through the Corpus).

**Risk:** medium, mostly in the harness. Every existing scene assumes one window.

---

## MC7 — Restore through the Corpus

**What changes.** A restore reloads the documents it rewrote, because the Corpus
is what knows which are open. (The commit half landed in MC2, where the second
dirty document first became possible.)

**Why here and not earlier.** Nothing can go stale until something holds a
document across a restore, and until MC5 nothing does: the index borrows
read-only and retains nothing. Once a window holds a note, a restore that leaves
it in memory is **a version that took and was then overwritten by a buffer** —
which is the failure "a restore is committed immediately" was written to
prevent, wearing different clothes.

**Proved by.** m1's restore checks, plus a new one: restore with a note open in a
window, and the window shows the restored text rather than the buffer that
outlived it. And an audit pass over every W write that bypasses a document —
each one either machinery, or a bug.

**Risk:** low in code, high in consequence — this is the phase where getting it
wrong loses text, so it gets the same treatment M1 gave the write tiers.

---

## What is deliberately not here

- **Splits within a window.** A second window is the answer (D10).
- **A PDF kind, or any other.** The point of the shape is that one can be added
  later; adding one now would be testing the shape with an example instead of
  with the three kinds that already exist.
- **A fileset surface that is not markdown.** Live with the markdown one first
  (D54's open question).
- **Per-document edit queues.** One serial queue satisfies the ordering rule
  conservatively; the refinement waits for a measurement.
