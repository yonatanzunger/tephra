# Navigation — the sidebar, and the index under it

> **A design, not yet a decision.** For M3.2. Written against D10 (sections and
> the default section), D11 (reference by identity), D7 (when an index arrives),
> D50 (annotations are one union with one policy).

## The Timeline is days, and only days

**Found in a real notebook, from a screenshot** (2026-09-04). After importing a
few hundred markdown documents, the Timeline filled with their headings, drawn
as dates: rows reading `NaN driven, market`, `**Introduction**`,
`NaN content/uploads/2023…`.

**Nothing was wrong with the index; the query was.** The method was called
`outline`, and a corpus *outline* plausibly includes a note's headings — so for
any file with no date span it pushed them in as top-level entries. With a
handful of day files that never showed, and every test the sidebar had used a
fixture of days alone.

**The cast is what let it reach the screen.** `OutlineNode.title` was a string
that was *sometimes* a `DateKey`, and the sidebar recovered the difference with
`node.title as DateKey`. `dayLabel` then did what it was asked with
`AI-driven, market-shaping`: split on hyphens, `Number('shaping')` is `NaN`, and
the month falls back to the raw text. Three things had to be true at once and
the type system had been told not to look.

So: `timeline()` returns `TimelineDay`, which carries a real `DateKey` beside
its headings — two things that are not the same type no longer share one, which
is the rule already applied to positions. `dayLabel` refuses anything not shaped
like a date instead of inventing a label for it. And the sidebar's fixture has
documents in it that are not days, which is what a real notebook is full of.

**A note's headings are a real thing to want in a sidebar.** They are not the
Timeline, and whatever shows them will ask a differently-named question.

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

— implemented as `CorpusIndex` over an `IndexStore` in `w/`, the same shape as
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

## Curated sections, which the format already half-describes

`format-spec.md` settled most of this in the v1 draft: a section is a fileset at
`sections/<name>.fileset.md`, its frontmatter says `kind: fileset`, its entries
are an ordered markdown list, **the entry type is inferred from the link target**
so there is no type field to keep consistent, and the text after the link is a
human-authored summary that regeneration must never clobber (R20).

```markdown
---
tephra: 1
kind: fileset
title: House deal
---

- [Mortgage contact](tephra:mark/mortgage%20contact) — call before Thursday
- [Offer letter](../docs/offer.pdf)
- [The listing](https://example.com/…)
```

What D51 adds is that **a row is a row**, so the same list has to be able to
name the things the built-in sections name.

### The URI namespace

One host per kind, and the kinds are `Reference`'s:

| Entry | Written as | Resolves by |
|---|---|---|
| bookmark | `tephra:mark/mortgage%20contact` | name, first in date order (D11) |
| subject | `tephra:tag/House%20Deal` | every range carrying it |
| day | `tephra:day/2026-08-24` | the date |
| section | `tephra:section/house-deal` | the fileset of that name |
| file | `../notes/titration.md` | a relative path |
| URL | `https://example.com/…` | the browser |
| other document | `../docs/offer.pdf` | OS intent |

**The two that are paths stay paths**, and only the things that resolve by
identity take the scheme — which is what makes a section file still useful in
any other markdown tool: three of six entry kinds are ordinary links, and the
other three read as what they are even when they do not resolve.

`tephra:` is already registered (`main/scheme.ts`) and the renderer already
intercepts link clicks, so nothing here needs a new registration. The app itself
lives at `tephra://app`, an authority form; references are path-only, so the two
namespaces cannot collide.

### A fileset of filesets

**The nav's top level is itself a section**, `sections/index.fileset.md`, whose
entries are mostly `tephra:section/…` references in the order they should
appear. That gives the panel one file to read with an explicit order in it —
which is the whole argument D10 made for membership-in-a-fileset over
pinning-as-a-property.

**It also dissolves the separate "default section".** D10 said the default
section always exists and holds the pins; under this shape the top-level list IS
where a pin goes when nobody says where, because an entry may be any reference
and not only a section. One file, one order, no distinguished second file whose
only job is to be the place things land.

Recursion is real — a section may name a section — so the panel renders a tree.
Two rules keep that finite: a section already open on the path renders as a
plain entry rather than expanding again, and depth is capped at three, which is
deeper than anyone has yet wanted.

### A broken entry stays visible

A bookmark whose anchor was deleted, a file that moved, a URL that died: the
corpus is hand-editable and syncs between machines, so all three are ORDINARY.
The row renders dimmed with *not found* beside it, and never disappears —
**hiding it would make a hand-edit look like data loss**, and the entry is also
the only remaining record of what was meant.

### Pinning is an ordinary edit

The gesture takes the row's `Reference` and appends `- [Label](uri)` to a
section file. Which means it is **a text edit to a markdown document**: undoable
by the ordinary undo, versioned by the ordinary commit, hand-editable
afterwards, and requiring no new storage of any kind. The label defaults to the
reference's own name and is the part that survives when a target moves.

The remaining question is where the gesture puts things when the person does not
say: the top-level list is the answer above, and a `Pin to…` that offers the
existing sections is the fuller one.

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

## Now

**One row that is not a set of places.** Every other row in the panel names a
set and is written down somewhere — in a fileset, or derived from the index
(D51, D53). `Now` names the single place that is written down nowhere, because
it is not a place in the corpus at all: the end of the stream, where the next
sentence goes. It sits above the filesets and outside them for that reason.

A person could pin today's date and get something that looks like this, and it
would be wrong tomorrow. "Now" is not a date; it is wherever writing continues,
which is why the app opens there and why this cannot be a fileset entry.

**It looks like every other row.** Being unmanaged is a fact about where it
comes from, not about what it is for, and dressing it up would tell the reader
it is a different kind of thing to click. What it lacks is what it cannot have:
no caret, because there is nothing to disclose, and no unpin, because there is
no line in a file to take out.

## Landing at the top

A jump from the panel puts its target at the TOP of the screen, not centred.

Centring reads well in the middle of a long document and fails at both ends —
and one of those ends is where the panel usually sends you. A recent comment or
a subject from this week is near the end of the stream, where there is nothing
below to centre against: the viewport stops, and the thing you were sent to sits
on the last line with the whole screen above it being what you already read.

Landing at the top is the same rule that made centring right in the first place.
You arrive at the thing, and you read forward from it.

## A section per directory

**The problem is invisibility.** A note that arrives — imported, branched, or
dropped into `notes/` by hand — is a document in the corpus that nothing in the
panel names. The curated sections list what somebody chose to pin, and a file
nobody has pinned yet is a file nobody can see.

So every directory under the notebook root that holds documents is a section,
named for the directory, listing what is in it. `stream/` is not one — that is
the Timeline — and neither is `sections/`, because a section listing the
sections is the list twice. A directory holding no documents (`attachments/`,
`config/`) is not a section either: an empty row that opens nothing.

**Derived, not written.** The alternative is to put an `_index.fileset.md` in
every directory and append to it whenever a file appears. That costs a file in
every directory of somebody's notebook that they did not ask for, a write on
every arrival, and a watcher that must not miss one — and it can still be wrong,
because a file can arrive while the app is closed. Reading the directory cannot
be wrong: a file is listed because it is there.

**The order orders; it does not gate.** The same rule as the top level, and for
the same reason (D53). If `<dir>/_index.fileset.md` exists it decides the order,
the labels and the section's title; everything else in the directory follows it
by name. Curating a directory is therefore exactly what curating anything else
is, and until someone does, the listing is simply what is on disk.

**Labels are filenames.** Reading each document's own title would mean opening
every document in the directory every time the panel draws. The name on disk is
the one the person chose anyway, and a better label is what curating is for.

Two things this turned up:

- **A section is a fileset in `sections/`, not any fileset anywhere.** They were
  the same thing until directories had listings; a `notes/_index.fileset.md` was
  being picked up as a top-level section, so the directory appeared twice — once
  as itself, and once as a curated section holding only its curated entries.
- **`path` and `base` are different questions.** `path` is the file to edit,
  and is null for a derived listing because there is no line anywhere to unpin.
  `base` is what the entries resolve FROM, which is the file they WOULD be
  written in, whether or not it exists. Folding them together made a derived
  entry resolve from a day file's depth, land outside the notebook, and report
  itself as missing: a correct link to a real file, in a row saying "not found".

## ⌘-click opens a row elsewhere

The one verb, with a modifier: a row names a *there*, and ⌘-click puts that there
in a window of its own rather than moving the window you are reading in. The
point is having both, so **this window does not follow** — and the row does not
become the active one either, since stepping through a set is about the window
you are reading in and the set has just gone to a different one.

For a row that names a document, the new window opens that document. For a row
that names a SET of places — a subject, a bookmark, a day — it opens the first
of them, because a window shows one place and the rest are still here to step
through.
