# M4 — search

**Requirement: R10. Decisions: D9 (as amended), D65, D66.**

Phases, under MC's rule: **`npm test`, `m0`, `m1`, `m2` and `m3` are green at
the end of each one.**

**What this is, in one sentence.** *"I know I wrote that down."* — era 1's
recorded failure, and the half R10a's link directory does not serve: search
finds text you remember writing, the directory finds documents you remember
opening.

## Three things had been sharing the name "filtered view"

D9 says subject views, date-range views and search results are one mechanism.
That is right, and it was hiding a three-way ambiguity that had to be settled
before anything could be built.

- **A results pane** — a list of hits, each with enough context to recognise,
  click to go there. `Links.tsx` already is one.
- **A composite document** — the matching passages concatenated and read as
  running prose. This is the "subject view" of `goal/scope.md`, and the thing
  D9's open question is about.
- **A walk** — successive jumps through the live document, the word-processor
  gesture. `Nav.tsx` already does this for tag occurrences.

**The first and third are M4. The second is out of v1** — see D9 as amended.
It is not deferred for want of a design; it is descoped for want of a demand,
and the demand may never arrive, because a results pane and a walk between them
answer the question the composite was invented for.

## The engine: narrowing, filtering, ordering

**A query is a conjunction of predicates in two kinds, plus an ordering** —
which is the whole of the architecture, because it is what lets an index arrive
later without anything being restructured (D65).

- **Narrowing** predicates are answerable from the corpus index without reading
  a byte of prose: a tag, a date range, a document, a kind. They produce the
  candidate set.
- **Filtering** predicates must read the text: literal substring now, regex
  later, fuzzy later.
- **Ordering** is chronological in v1 — origin and direction, below — and
  **ranked** later. It belongs to the engine and **not to the query language**:
  the command chooses it, nobody types it.

The engine narrows first and reads only the survivors. *"foo in #wombats"* does
not scan the corpus and discard non-wombat hits; it never opens the other files.

**And that is what the forward constraint reduces to.** Adding a full-text
index later **moves substring from the filtering side to the narrowing side** —
one new predicate implementation, same engine, same result stream. Regex stays
on the filtering side permanently, which is correct rather than a limitation:
regex over raw text is what it is, and the design should say so rather than
pretend an index could serve it.

### Ranking is the third concern, and it arrives with the index

**Chronological order streams because the candidate set is enumerable in that
order** — the engine emits as it walks and the first hit is as cheap as the
last. **Rank order is not free that way.** Ranking generally has to see every
candidate before it knows which comes first, so a scan cannot rank-stream at
all; what makes ranked streaming possible is an index traversable in impact
order. **Ranking therefore implies the index**, and lands with it or after it —
which is also why it is not a v1 gap.

Two things v1 pays for now because they are cheap now:

- **The stream's element is a `Hit`, not a bare `Located`** — a location plus a
  lead of surrounding text, which the results pane wants regardless, and later a
  score. Both additions are then additive; streaming raw locations would make
  the first of them a change to every signature that touches a result.
- **A pane distinguishes *nothing yet* from *nothing found***, because a ranked
  query has a latency to first result that a chronological one does not.

**The walk pins the ordering to chronological permanently**: stepping through a
document in relevance order is not a coherent gesture. ⌘⇧F's pane is where the
choice eventually lives, as a control on the view rather than a token in the
grammar.

## Origin and direction, not a fixed order

**A query carries where to start and which way to go**, and the ordering falls
out of that rather than being a property of the engine. Reverse-chronological
from today is just *origin = now, direction = past*, which is the default for
both commands and the order R10a already established as the one that needs no
ranking.

**Direction is what makes the walk usable at twenty years** (D66). "Find the
previous mention" from where the cursor is standing is the gesture; a search
that could only ever run forwards from 2006 would be useless in the stream, and
a search that had to finish before it could answer would be worse.

**Which makes the interface pull, not push.** The renderer asks for the next
hit; the engine reads exactly as far as it must to produce one. The walk pulls
one at a time and never scans past where you stopped walking; the pane pulls
eagerly to fill itself and stops at the bottom of the list. Cancellation is
closing the iterator, and backpressure is free. Over IPC that is `start(query)`
→ id, `next(id, n)`, `cancel(id)` — three messages, no firehose, and the
existing push channels are left for things that really are events.

## A location is a `Located`, and there is not a second kind

`nav-api.ts`'s `Located { file, date, from, to }` is already document id plus
segment key plus range, spelled in the file vocabulary the scanner works in: a
day file *is* the stream at that date, a note file is its own document. The link
directory emits it, `onGo` consumes it, the occurrence walk steps through it.
**Search returns the same type**, and the alternative — a parallel
document-shaped location converted at every boundary — buys nothing.

**Ordering across dated and undated files is already answered too.**
`corpus-index.ts`'s `whenOf` gives a day file noon on its date and everything
else its mtime, which is what makes one chronological merge over day files,
notes, filesets and task lists well defined. ML made that call; search inherits
it.

## The grammar: one field, the notations that already exist

**One text field, parsed** — not a form with checkboxes. T16's one-notation rule
applied to queries, and the notations are the ones already in the corpus:

| Written | Means | Kind |
|---|---|---|
| `foo bar` | both substrings present | filtering |
| `#wombats` | tagged | narrowing |
| `2026-03`, `2026-03-01..2026-03-15` | in that range | narrowing |
| `/re/` *(later)* | regex | filtering |

**Dates are the one genuinely new notation**, since tags have a spelling and
ranges do not. `2026-03` and `2026-03-01..2026-03-15` are unambiguous against
prose, which is the only property required of them.

## Two commands, one query

They differ in exactly two things: a scope predicate, and how results are shown.

**Find in this document** (⌘F) issues the query with `document:<the one in this
window>` and renders by **walking** — jump to the nearest hit in the chosen
direction, again for the next. **Scope is the document, never the window**: in
the stream that means the whole twenty years, and what it excludes is notes,
task lists and filesets. That is the useful cut, and it is uniform — no special
case anywhere for the stream being large.

**Search Tephra** (⌘⇧F) issues the same query with no scope predicate and
renders into a **results pane**, the shape `Links.tsx` already has.

**`@codemirror/search` is deliberately not used**, though it is already a
dependency and already in the keymap. It cannot express `#wombats`, and two ⌘F
behaviours with two grammars is worse than the decoration work its panel would
have saved.

---

## MS1 — the query engine

Predicates, the narrow-then-filter plan, the pull-based cursor, cancellation,
and the `Hit`. Main-side and headless: **it is testable without any UI at all**,
which is the reason it is its own phase. Substring is the only filtering
predicate; tag, date range and document are the narrowing ones; chronological is
the only ordering, and it is a parameter rather than an assumption baked into
the traversal.

The tests that matter: a query that is cancelled stops reading files; a
narrowing predicate provably prevents reads; direction reverses the sequence and
nothing else; a hit at a file boundary is not split or duplicated.

## MS2 — the grammar

Parsing one text field into a predicate conjunction, with the date notation.
Pure and shared, so it is unit-testable and the renderer and main agree by
construction rather than by convention — the mistake `shared/links.ts` exists to
have already fixed once.

## MS3 — find in this document

⌘F, the walk, direction, and the highlight. Extends the occurrence stepper in
`Nav.tsx` from a finished array to a pulled stream, which is the one piece of
existing machinery this changes rather than reuses.

## MS4 — search Tephra

⌘⇧F and the results pane, rendered like the link directory: a lead of
surrounding text, a source, a date, click to go there. Streaming in, so the
first hits are usable before the scan finishes.

---

## What is not in M4

- **The composite document** — descoped (D9 as amended).
- **Ranking, stemming, structure** — `features.md` has these at v3+, and
  reverse-chronological is what makes their absence tolerable.
- **A text index** — D23 puts it in v2, and the predicate split is what makes
  that a later addition rather than a later rewrite. **Ranked ordering comes
  with it**, since a scan cannot rank-stream.
- **Image paste (R7)** rides along in M4 by schedule, not by kinship. It shares
  nothing with this.
