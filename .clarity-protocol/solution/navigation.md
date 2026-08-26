# Navigation — the sidebar, and the index under it

> **A design, not yet a decision.** For M3.2. Written against D10 (sections and
> the default section), D11 (reference by identity), D7 (when an index arrives),
> D50 (annotations are one union with one policy).

## The one verb

**Every row in the sidebar names a set of places, and clicking it goes to the
next one.** A bookmark's set has one element; a day's has one; a heading's has
one; a subject's has as many as it was applied to. There is no second
interaction to learn, and no row where a click means something other than
*take me there*.

This is what makes the sidebar uniform rather than two lists wearing one coat.
The alternative — clicking a place goes to it, clicking a set filters or reveals
controls — was the first draft, and it fails the plainest test there is: a
person cannot tell, before clicking, which kind of thing a row is.

What a set with more than one element earns is not a different verb but
**apparatus**: the active row shows `3 of 7`, gets `◂ ▸` to step, and marks its
occurrences in the scroll track. Clicking the row again is the same as `▸`.

**At most one row is active at a time.** The active row owns the scroll-track
marks and the step buttons, and it is what "next" is relative to. Selecting a
different row moves all three.

## Headings are ranges, and days are the top of the same tree

A heading's range runs to the next heading of equal or greater precedence, or to
the end of its day. Today the `heading` annotation covers only the heading text,
which is why the outline cannot highlight a section — and the fix is a change to
`Segment.spans()`, not a new mechanism.

That single change makes days and headings the same kind of thing at different
scales, and gives a containment tree at no cost:

```
2026-08-24
  ## The Shock Limit
    ### Definitions
  ## Objections
2026-08-25
```

Tags do not nest — they overlap freely — and bookmarks are points. So the
structures are three, not one: **a tree** (days and headings), **sets**
(subjects), and **points** (bookmarks, comment threads). The one verb covers all
three; only the row's `count` differs.

## The sections, by kind

| Section | Rows | Order | Notes |
|---|---|---|---|
| **Outline** | days, with their headings nested | document order, newest last | subsumes today's dates nav; collapsed to days by default |
| **Subjects** | one row per tag subject | alphabetical, with counts | a lookup table, not a reading order — which is why this one is not in document order |
| **Bookmarks** | one row per anchor | document order | the name is the label (D11) |
| **Comments** | one row per thread | document order, open before resolved | the row quotes what it is about; resolved threads behind a toggle |
| **Filesets** | curated sections | as written in the file | later — see the last section |

**Where you are** is a line at the top of the sidebar rather than a section: the
annotations covering the caret, which is the day, the heading, and any subjects
the cursor sits inside. `spansAt` already answers it, it costs nothing, and it
is the part a person looks at most.

## The index

The sidebar asks corpus-wide questions — every subject, every bookmark, the
whole outline — and today `Document.spans()` answers them by **loading every
segment and scanning it**. At a fortnight's corpus that is instant; at twenty
years it is a gigabyte through memory to populate a list. So the index D7 put in
v3 arrives here, because this is the first feature that cannot work without it.

### What it is, and what it is not

**It is a cache of the scan, never a source of truth.** The files are
authoritative (D23, Q2); the index holds what a scan of them found, and any
disagreement is resolved by rescanning. **Deleting `.tephra/index` must cost
nothing but time** — that is the test the design has to pass, and it is what
keeps a hand-edited corpus honest.

**It indexes SPANS, not text.** Subjects, headings, anchors, threads, dates —
the same `ScannedSpan` a segment already produces. Retrieval (M4) wants a text
index, which is a different structure with different tradeoffs; building one
here because we happen to be walking the files would be the fancy answer to a
problem nobody has yet.

### Shape

**The index covers the corpus, not the stream.** Notes, branched files and
fileset indexes are documents too, and a bookmark in one has to be findable from
the sidebar — an index that stopped at the stream would answer "no such
bookmark" about a bookmark that exists. Which of it you are LOOKING at is a
filter on the view (this file, or everything), and belongs to the sidebar rather
than to the store.

So it is keyed by file, and mirrors the corpus's own directory tree — **one
index file per corpus directory**, machine-local:

```
.tephra/index/stream/2026/08.json      ← the days of that month
.tephra/index/notes.json               ← every note
{ "2026-08-24.md": { "size": 4127, "mtime": 1756000000000, "spans": [ … ] }, … }
```

- **Per directory**, which for the stream means per month because that is how the
  corpus is laid out (D9) — the granularity falls out of the tree rather than
  being a rule of its own. A month is at most 31 entries and a few kilobytes, so
  rewriting one when a day changes is cheap, and 240 files over twenty years
  needs no thought. Per file would be seven thousand files; per year would
  rewrite a megabyte on every flush.
- **Keyed by path, not by date.** A `DateKey` is the stream's segment key and
  means nothing in `notes/`; the file is the thing the cache is a cache OF, and
  the thing `stat` answers about. What a span belongs to — document and segment
  — is in the entry.
- **`size` and `mtime`** are the staleness check: one `stat` per file, no reads.
  A file whose stamp differs is rescanned; a file missing from the index is
  scanned; an entry with no file is dropped.
- **`.tephra/` is already machine-local and already excluded from git**
  (`isMachinery`), and `LOCAL.index` is already reserved. Nothing new is
  committed to the corpus, which is what "derived and disposable" has to mean.

Size: roughly twenty spans per day at eighty bytes is 12 MB over twenty years —
small enough to hold the aggregates in memory and read a month when the occurrence
list of one subject is actually wanted.

### The rule that keeps it honest

**A loaded segment answers for itself; the index answers for everything else.**
The document merges the two, preferring memory. Without that rule the sidebar
lags what you just typed by however long the flush takes — a subject applied
thirty seconds ago would be missing from a list of subjects, which reads as a
bug in tagging rather than as a stale cache.

### Building it, and saying so

On open, the index is verified in the background: `stat` every day file, rescan
what has moved. A cold corpus — a new machine, or a deleted index — is a full
scan, and **the sidebar shows what it has with a line saying it is still
looking** rather than an empty list or a spinner over everything. Absence that
explains itself is the house rule (`Nav.tsx` already does this for the sections
that do not exist yet).

### Who scans, and who asks

The index is built BY the scan it caches, so something has to be able to demand
a real read of a real file. **That already exists, one layer down.**

- **`Segment.spans()` always scans.** It is the walk over one body, it takes no
  cache, and it is what the index builder calls — a file at a time, which is
  also the granularity the index stores.
- **`Document.spans(kind)` answers about the corpus**, and is free to answer
  from the index, from a loaded segment, or by scanning what it must.

So the builder does not ask the document to please not use the index; it asks a
segment, which never had one. A `useIndex` flag on `spans()` would put the
CALLER in charge of the implementation, which is the thing an API is supposed to
keep to itself — and every caller that is not the builder would have to have an
opinion about it.

The one case that flag would genuinely serve is a **consistency check** — scan
and compare against what the cache claims — and that is a different question
with a different answer shape, so it gets its own name:

```ts
/** Files whose cached spans no longer match a fresh scan. A diagnostic. */
verify(under?: RelPath): Promise<readonly RelPath[]>
```

### Rebuilding, which is the maintenance story

**One entry point, one granularity, atomic at the file.**

```ts
/** Rebuild from a fresh scan and swap it in. A directory, or everything. */
rebuild(under?: RelPath): Promise<{ files: number }>
```

Each month is written to a temporary file and renamed over its predecessor, so a
reader never sees a partial month. Because every day entry carries its own
`size` and `mtime`, **a half-finished rebuild is incomplete and never wrong** —
the days it has not reached yet still hold their old, still-valid entries, and
any that are stale fail their stamp check and get scanned on demand. That is the
property that makes it safe to run in the background at any moment.

It exists as ONE function because the situations that need it are many and will
keep arriving:

- **on open**, as the `stat` sweep finds files that moved while the app was shut;
- **on a timer**, so a corpus edited by other tools drifts back into agreement;
- **after a history restore**, which rewrites whole days wholesale (D32) and is
  the case most likely to leave an index describing text that no longer exists —
  eagerly, rather than waiting for the sweep to notice;
- **after crash recovery**, when the WAL has replayed into files behind our back;
- **when a month fails to parse**, which is a cache being corrupt rather than a
  corpus being wrong, and therefore a rebuild rather than an error;
- **when a person asks**, because a cache with no visible repair is a cache that
  becomes folklore.

Two constraints on running it while someone is writing: it is **chunked and
yields**, since the writing path is the one that may not stutter (R1.1); and it
**skips days that are loaded and dirty**, which answer from memory anyway.

### The API

No new document API: `spans(kind)` keeps its meaning and stops being O(corpus).
What the nav needs beyond it are nouns of its own —

```ts
interface Index {
  subjects(): Promise<readonly { subject: string; count: number }[]>
  bookmarks(): Promise<readonly Reference[]>
  outline(of?: DocumentId): Promise<readonly OutlineNode[]>
  threads(open?: boolean): Promise<readonly CommentThread[]>
  /** Every place a reference resolves to, in document order. */
  occurrences(reference: Reference): Promise<readonly DocumentPosition[]>
  /** Progress, for the line at the foot of the sidebar. */
  status(): { scanned: number; total: number }

  /** A subtree of the corpus, or all of it. */
  rebuild(under?: RelPath): Promise<{ files: number }>
  verify(under?: RelPath): Promise<readonly RelPath[]>
}
```

— implemented as `StreamIndex` over an `IndexStore` in `w/`, the same shape as
`StreamHistory` over `Repository`.

## And then pinning, which is the same row

A **`Reference` is an annotation's identity without its location**:

```ts
type Reference =
  | { kind: 'anchor'; name: string }
  | { kind: 'tag'; subject: string }
  | { kind: 'date'; date: DateKey }
  | { kind: 'heading'; text: string; in: SegmentKey }
  | { kind: 'file'; path: RelPath }
  | { kind: 'url'; href: string }
```

That is D11 stated as a type: nothing durable holds a position, so a saved row
holds a name and resolves by lookup. Two consequences fall straight out:

- **A curated section is an ordered list of References**, which is exactly what
  D10 said a fileset index is, and what makes the default section "one file to
  read with an order in it" rather than a flag scattered through the corpus.
- **A pinned row and a built-in row are the same row.** Both resolve through
  `occurrences()` into a set of places; both have the one verb. So pinning is
  copying a reference into a list — a data change, with no new rendering, no new
  interaction, and no second code path to keep in step.

The two remaining pieces are then the fileset index FORMAT (markdown, so it is
readable and hand-editable — R20–R22, R26) and the gesture that adds to it.
Neither needs the sidebar to change shape.

## Deliberately late-bound

These are settled by USING it, not by arguing about it now. Each one is cheap to
change, each one is a guess until there is a real sidebar over a real corpus,
and a wrong guess written into a decision record is harder to undo than a wrong
default in a component.

- **What order subjects are listed in.** Alphabetical-with-counts is what the
  first build will do; first-occurrence-in-the-stream is the standing hunch, and
  frequency-first is the third candidate. The thing to watch is whether the list
  is being READ or SEARCHED — a list you read wants document order, a list you
  hunt in wants the alphabet.
- **How much outline is open by default**, and whether the Outline section holds
  every day ever or a window with "earlier" at the foot. At 7 300 days this is a
  real question, and it interacts with how the index reports progress.
- **What the view filter offers** — this file, this month, everything — and what
  it defaults to. The index always holds the corpus; this is a control on the
  sidebar, and its shape should follow from what proves annoying.

## Open questions

- **A reference that resolves to nothing** — a deleted bookmark, a renamed
  subject — is shown dimmed with "not found" rather than hidden. Hiding it makes
  a hand-edit look like data loss. (Proposed, not yet tested against use.)
- **What the `stat` sweep costs on a cold twenty-year corpus.** The design leans
  on it being cheap; nobody has measured it, and the measurement wants a
  synthetic corpus like the one `git-repository` was measured against.
- **Does `spans()` need a way to bypass the cache after all?** The position above
  is that the builder asks a `Segment` and the question does not arise. If a
  caller turns up that genuinely wants the corpus-wide answer without the cache
  — and is not a diagnostic, which `verify()` covers — then the flag earns its
  place and this is wrong.
