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

**Where it goes.** `main/x/documents/` — the floor of X, holding the `Corpus`
and, from MC3, the kinds. Nothing else in `x/` may see the corpus's file system,
and a directory says so better than a rule does (`architecture.md`, invariant 2).

**What changes.** `main/x/documents/corpus.ts` arrives with `use(id, work, how?)`, `list`,
`exists`, `create`, `rename`, `remove`. It owns the `Notebook`, opens documents
by id, dedupes concurrent opens **by caching the opening rather than the opened**
(the segment-cache race, which this shape inherits), and keeps a bounded LRU that
never evicts what is dirty or what a window points at. Borrows carry
`{ mode, retain }`.

**The part that is not obvious.** A document's events — journal, divergence,
change — are subscribed once today, at service construction, against one
document. With N documents opened and evicted, subscription cannot be per
lifetime; the Corpus aggregates them and re-emits with the document's id, so the
service subscribes once to the Corpus instead.

**And the commit path moves here, not to MC7.** "Flush before you commit" is a
single document's rule today. The moment a SECOND document can be dirty — MC4,
where a pin becomes a document edit — a commit that flushed only the stream
would capture a file without the edit sitting in memory beside it. That is M1's
whole subject arriving through a side door, so the Corpus learns
`flushAll()` as it is built and the version tier calls it. The restore half
waits (MC7); it has nothing to go stale until a window holds a document.

**Proved by.** Corpus unit tests: same object for one id, concurrent opens
yielding one instance, `retain: false` leaving no trace, dirty never evicted, a
borrow outliving an eviction attempt. Then the whole suite, with the service
using `corpus.use('stream', …)` everywhere it used `#doc`.

**Risk:** the highest of the milestone. Mitigation: the stream stays the only
kind, so behaviour cannot change — only the path to it.

---

## MC3 — The markdown kind, and the readers that stop reading files

**What changes.** `main/x/documents/kinds/markdown.ts`: one segment, keyed by the constant,
no whole-body date span (that span is a day's, and `Segment` learns the
difference). `StreamIndex` and `Filesets` stop taking a `Notebook` and take the
`Corpus`; the index's sweep borrows `{ mode: 'read', retain: false }`.

**The invariant gets a test, not a comment.** Nothing outside `x/documents/`
imports `w/notebook.ts`, asserted over the import graph the way
`no-electron.test.ts` asserts its own rule. A directory boundary rather than an
allowlist, so adding a kind cannot require editing the test. Three violations of
that earlier rule got through comments; this one starts as a test.

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

## MC4 — The fileset kind, and pinning that can be undone

**What changes.** `main/x/documents/kinds/fileset.ts` gains `entries`, `pin`, `unpin`,
`reorder`, `remove` — all as `replace` calls on the document. The service's
fileset writes route through `corpus.use`, so two writers can no longer race.

**What this fixes.** D53 claims a pin is undoable by the ordinary undo. It
becomes true here.

**Proved by.** m3's pinning section, plus: pin, undo, and the line is gone from
the file; pin while the fileset is open in a window, and the window sees it.

**Risk:** low, on top of MC2 and MC3.

---

## MC5 — The renderer learns about kinds

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
