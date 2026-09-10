# M4 — search

**Requirement: R10. Decisions: D9 (as amended), D65, D66.**

Phases, under MC's rule: **`npm test`, `m0`, `m1`, `m2` and `m3` are green at
the end of each one.**

**Built in a different order from the one they are numbered in.** The API for
MS1 and MS2 is written first, together, so the two interlock by construction
rather than by hope; then **MS2 is implemented with its tests**, then **MS1 with
its tests**. The reason is legibility of the engine's tests: a predicate array
built by hand is an ugly object, and MS1's tests are the ones that most need to
be readable. With the parser already standing and independently tested, MS1's
tests may use it — a red engine test is diagnosable because the parser's own
table-driven tests are green beside it. **The few tests that are specifically
about predicate handling are still built by hand**, and `Query` never carries
the raw text, so the type stays independent even where the tests do not.

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

## The engine: narrow, order, scan

**Three concerns, and they are not alike** (D65) — which is the whole of the
architecture, because it is what lets an index arrive later without anything
being restructured.

- **Scope** is answerable from the corpus index without reading a byte of prose:
  a document, tags, a date range. It produces the candidate ranges.
- **The phrase** has to read text. Literal now; regex and fuzzy are later arms of
  the same union.
- **Ordering** is chronological in v1 — origin and direction, below — and
  **ranked** later. It belongs to the engine and **not to the query language**:
  the command chooses it, nobody types it.

**What a text index changes later is one step, and it is less than it sounds.**
A phrase becomes answerable while narrowing, so it moves out of the scan and the
scan has nothing left to do for it. Regex never moves — regex over raw text is
what it is — and lands as one more thing the scan knows how to test.

### Scope and phrase: two parts that are not alike

**A query has two parts.** `scope` says *where to look* and is answerable from
the index without reading a byte. `where` says *what to look for* and can only be
answered by reading text. Narrow by the first, scan what survives with the
second.

**Scope is a struct whose fields conjoin — a document, tags, a date range — and
not a node in a boolean tree.** That is a deliberate limit. In principle a tag is
just another predicate and belongs in the tree; in practice putting it there buys
`#a or #b` at the price of a query planner, because a narrowing term under an
`or` narrows nothing and the engine would have to compute whether a tree can be
narrowed at all. **This is a notebook, not a database.**

**Narrowing yields ranges, not files, and a whole file is the coarsest one.** A
tag delimits a range (D11), so *"foo in #wombats"* means foo **inside**
wombats-tagged text — not foo anywhere in a file that mentions wombats, which is
a worse answer to the same question. Dates narrow to day files, tags to spans
within them, a future text index to lines: one mechanism, three granularities.

**A scope on its own is a complete query**: `#wombats` alone is the subject view,
its candidate ranges being the results with nothing to filter them by. D9's
unification arrives as a consequence rather than as a feature.

### `phrase` and `and` are two node kinds, and v1 has only the first

**Structurally identical, opposite in meaning.** An `and` asks that these words
be present and lets the engine be as approximate as it likes about it — stemming,
synonyms, any order. A `phrase` says **take this literally**: these terms, this
order, adjacent. That distinction gets *more* important as search gets cleverer,
which is why it is a node kind and not a flag on one node.

**v1 is phrase-only** — `Where` is a union of one, with `and`, `or`, `not` and
`regex` as later arms rather than a restructure. A scan is exact, so the one node
a scan can honour completely is the literal one; and *"I know I wrote that
down"* is a half-remembered phrase, not a bag of words.

**Term order is never normalised** — it is the whole meaning of a phrase, and it
stays meaningful in a future `and` because proximity scoring is made of order and
adjacency. `formatQuery` round-trips, which makes the rule testable.

### A hit is a line

*Where* the terms must appear needs an answer once there is more than one: the
file is far too coarse at twenty pages a day, and the line is what a markdown
paragraph already is. **A hit is a line the phrase is in**, positioned at the
match — and for a scope-only query, the candidate range's first line with nothing
marked.

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
| `foo bar` | that phrase, literally | scan |
| `#wombats` | inside text tagged so | scope |
| `2026-03`, `2026-03-01..2026-03-15` | in that range, both days included | scope |
| `"#wombats"` | the text, not a tag | scan |

**Quoting has a smaller job than it did.** With everything unquoted already a
phrase, `"…"` escapes a selector back into text. The same syntax means the same
thing when `and` arrives, at which point it resumes distinguishing the phrase
from the conjunction.

**Case folding is decided by the query rather than by a switch** — a query in
lower case folds, one with a capital in it does not.

**Dates are the one genuinely new notation**, since tags have a spelling and
ranges do not. `2026-03` and `2026-03-01..2026-03-15` are unambiguous against
prose, which is the only property required of them.

**Inclusive in the notation, half-open in the struct.** Ranges compose only when
one end is open, and a month is then `2026-03-01` to `2026-04-01` with no
month-length arithmetic anywhere; *through the fifteenth* is still what a person
means, and `parseQuery` is the one place that becomes the sixteenth.

**A tag in a scope is the subject key**, normalised case-insensitively and
whitespace-collapsed as subjects are everywhere else, so `#House Deal` and
`#house deal` are one scope.

## Two commands, one query

They differ in exactly two things: the scope's `document`, and how results are
shown.

**Find in this document** (⌘F) sets the scope's document to the one in this
window and renders by **walking** — jump to the nearest hit in the chosen
direction, again for the next. **Scope is the document, never the window**: in
the stream that means the whole twenty years, and what it excludes is notes,
task lists and filesets. That is the useful cut, and it is uniform — no special
case anywhere for the stream being large.

**Search Tephra** (⌘⇧F) leaves the document unset and renders into a **results
pane**, the shape `Links.tsx` already has.

**`@codemirror/search` is deliberately not used**, though it is already a
dependency and already in the keymap. It cannot express `#wombats`, and two ⌘F
behaviours with two grammars is worse than the decoration work its panel would
have saved.

---

## MS1 — the query engine *(done)*

**The type is the phase boundary**, and it is written. `shared/search-api.ts`
holds the vocabulary and the `Search` and `Cursor` interfaces — alongside
`document-api`, `nav-api` and `pane-api`, because the engine is in main while the
field and the pane are in the renderer. `shared/query-text.ts` is the notation.
`main/x/documents/search.ts` is `Scanner`, v1's implementation — inside the floor
because it reads files, which the layering test insisted on before a line of it
ran, and named for how it works because an index-backed engine answers the same
interface in v2.

```ts
interface Query {
  readonly scope: Scope      // document, tags, half-open dates — all conjoined
  readonly find: QueryNode   // v1: { op: 'phrase'; of: Term[] }
  readonly order: Ordering   // chronological, from an origin, in a direction
  readonly fold: boolean     // of the asking, not of a node
}
```

**Three steps, and nothing to decide between them.** Narrow the scope into
candidate ranges from the index; order them; scan them. `candidatesFor` is steps
one and two and is exported on its own, because *narrowing prevents reads* is
provable by inspecting what it returns, with no filesystem in the picture.

The pull-based cursor, the scan, and the `Hit`. Main-side and headless: **it is
testable with no UI at all**, which is the reason it is its own phase.
Chronological is the only ordering, and it is a parameter rather than an
assumption baked into the traversal.

**Done.** `main/x/documents/search.ts` — `candidatesFor` and `Scanner`, 29
tests in `tests/integration/search.test.ts`. What came out of building it:

- **A tagged range covers part of a LINE, and that distinction is the whole
  meaning of a tag scope.** The scan widens a candidate to line edges so a hit
  can be shown whole — and the first draft then matched anywhere in the widened
  line, so `outside #house` found the word outside the tag. The line is widened
  and the *match* is not.
- **`at` and `within` are found twice, in two texts.** `at` points into the file,
  where the markers still are; `within` points into the line as a reader sees it,
  which is shorter by however much machinery was in it. One number cannot be
  both, and the first draft used `at` for the highlight.
- **The origin has to carry `when`.** Compared as a bare offset, a candidate
  starting at 0 in a *newer* file counted as before an origin halfway down an
  older one — so walking backwards returned the future. Position here is a day
  first and an offset second.
- **The two ends of a range are not interchangeable at the origin**: walking back,
  a range starting before the cursor may still hold hits before it, so its start
  decides; walking forward, its end does.
- **A match inside a marker is not a match**, for the same reason `plain.ts`
  exists: `tag-start` would otherwise report the filing system as prose.

**And it found a defect in `CorpusIndex`** — see below.

## Found on the way: the index never used its own cache for day files

**`CorpusIndex` re-read every day file on every sweep, and the stamp cache spared
none of them.** Measured before the fix: three consecutive sweeps over a two-day
fixture each read both days plus a probe for a part that does not exist. After:
the first sweep reads them, the second and third read one small JSON.

**The cause was one comparison.** `SegmentedDocument.heldSegment` answers
`undefined`, and `#loadedDate` tested it against `null` — so every day file
reported as *held by the editor*, every sweep took the branch meant for a day
with unsaved edits in it, and **a cache entry was never written for a single day
file.** The store held `notes.json` and nothing for the stream, which is what
made it visible: the half of the corpus that matters was the half being cached.

**Why it mattered more than it looked.** This is exactly what the index's own
header says it exists to avoid — *"answering 'every subject in twenty years' by
opening twenty years of documents"*. Every sidebar question re-read the whole
stream. Invisible at today's corpus; not at R6's 0.4–0.9 GB.

**Found because MS1's central claim is that narrowing prevents reads**, and the
first attempt to test it end to end could not be written: the index's own reads
drowned the scan's. The claim was the diagnostic. The test now counts reads, as
it should, and `candidatesFor` keeps a second test of the same claim that touches
no filesystem at all.

**Fixed**, and a day the editor really is holding still answers for itself — which
is the behaviour the branch was written for and now the only case that reaches it.

## MS2 — the grammar *(done)*

Parsing one text field into a whole `Query` — the command's document scope and
ordering handed in, the tags and dates found in the text conjoined onto that,
everything left over becoming the phrase. Returning a fragment and leaving each
caller to assemble the rest is how two callers come to assemble it differently.

**An inverse pair, and held to it**: `parseQuery: (text, params) → Query` and
`formatQuery: Query → (text, params)`. The reverse returns both halves because a
query holds what the notation cannot spell. `format` then `parse` is the identity
on queries — the property worth testing; `parse` then `format` is identity only
up to normalisation, since one query can be typed many ways.

**What may come back alongside the query is `params` or a `Problem`, and there is
no third thing.** A problem is text that could not become part of the query — an
impossible date, a `/regex/` v1 cannot run. It is reported *and* still searched
for as ordinary words, because losing characters somebody typed is the one thing
a search box must never do.

Pure and shared, so it is unit-testable and the renderer and main agree by
construction rather than by convention — the mistake `shared/links.ts` exists to
have already fixed once.

**What separates it from MS1 is the query type.** MS2 turns text into a `Query`
and stops; MS1 takes a `Query` and reads files. Nothing in the engine parses, and
nothing in the parser touches a disk — which is why one is testable with a string
table and the other with a fixture notebook.

**MS2 is small** — a parser and a table-driven test — and is built *first*, for
the reason at the top of this page: MS1's tests then get to say
`parse('foo #wombats')` instead of assembling a struct by hand, and a struct
assembled by hand is exactly the kind of test nobody rereads. The risk that
buys — a parse bug and a scan bug arriving as the same red test — is retired by
MS2 already standing with its own tests green beside them.

**Done.** `shared/query-text.ts`, 33 tests. What came out of building it:

- **The tokenizer is one left-to-right pass**, not a whitespace split with
  classification afterwards, because `#'house deal'` has a space in it and so
  does a quoted run: whitespace is not a boundary until you know what you are
  inside of.
- **The tag notation moved to `shared/tags.ts`** and `todo.ts` now imports it.
  A second reader arrived, and T16 means it has to get the same answer as the
  first — two copies of one grammar is exactly how `links.ts`'s halves came to
  disagree (D61). It is exported as a source string and a factory rather than a
  shared `RegExp`, since a `/g` regex carries `lastIndex` and one instance shared
  between two scanners is a bug that only shows up when both run.
- **Half-open ranges paid for themselves immediately.** Two ranges in one query
  conjoin, and conjoining is intersection — the later start and the earlier end,
  which inclusive ends would have made off-by-one-prone. A pair that does not
  overlap yields `from === until`, an ordinary half-open range admitting nothing,
  with no special case anywhere downstream.
- **An empty range has no spelling**, which the round-trip test found. The
  notation cannot write a range admitting nothing, so `formatQuery` writes what
  *produced* one: two days that do not overlap, which intersect back to exactly
  it. A backwards `a..b` would have been shorter and does not parse — it is a
  problem, by design, since a silent swap is worse than a complaint.
- **An unclosed quote is not a problem** — it is a field halfway through being
  typed in, and what has been typed so far is what to search for.

**Its return type is richer than `Predicate[]`**, because the query field parses
as somebody types and an incomplete `#wo` has to read as incomplete rather than
as a tag. Where a parse stopped is a UI concern, which is a second reason it does
not belong to the engine.

## MS3 — find in this document *(done)*

⌘F, the walk, direction, and the highlight — and the IPC that neither MS1 nor
MS2 needed. **Done.** `shared/ipc.ts` (three channels), `main/searches.ts`,
`renderer/src/frame/Find.tsx`, plus the `find` scene and `npm run m4`.

**Three messages, because the answer is not a value**: `open` narrows and
returns a handle, `next` pulls as far as it must, `close` stops. The first
pull-shaped channel in the app — everything else is invoke/handle or a push.

**Cursors belong to windows and die with them.** A search is somebody looking at
something, and a window closing is them stopping. The alternative is a cursor
outliving its renderer, which leaks only after a long session.

**`Searches` does the one translation on the path**: a query's origin is a
`Located` — a file and an offset into its body — and the renderer says where the
caret is in the words it speaks, a segment and an offset. Which file a day lives
in is the floor's business (D54).

**Earlier and Later, not Previous and Next.** The stream's axis is time and its
newest end is where you always are, so ⌘F's Enter walks *backwards*. *Previous*
would have had to mean "further into the past", which is the opposite of what it
says.

**The count is progressive, which is the honest version of a number I first
refused to show.** *3 of 47* does mean the corpus has been read to the end, and
waiting for that before the first answer would be wrong — but that argues against
a *blocking* total, not against a total. So there are two cursors: the **walk**,
which reads one hit at a time and is what you steer, and a **counter**, which
reads the same query from the newest end in batches and reports as it goes. The
number grows and says so while it is growing: `3 / 47…` is true where `3 / 47`
would have been a guess.

**Newest-first whichever way the walk is going**, because *3 / 15* has to mean the
third newest match or it means nothing — an ordinal counted from wherever the
cursor happened to be would change under you when you turned round.

**Debounced, cancelled on every keystroke, and capped at two thousand.** A tally
is an orientation aid, not an inventory: past a few thousand the useful statement
is *there are more of these than you want to step through*, so above the cap the
total is shown as a floor (`12 / 2000+`). The walk is unaffected either way,
because the walk never needed the count.

**A match is MARKED, not selected**, and that was the second attempt. Selecting
the range looked right until the caret went back to the field so the next
keystroke could be another search — at which point CodeMirror draws an
*unfocused* selection, a flat grey painted straight over the mark beneath it. So
`find-marks.ts` decorates instead, which stays exactly as visible while the caret
is elsewhere, which is the whole time. `revealAt` went back to placing a caret.

**And the others on the page are marked too**, quietly. One mark says where you
are; the rest say what else is on this screen, which is the difference between
stepping blind and reading a page that has the answer on it twice. They also go
down the scroll track, reusing D51's mechanism — the same set seen from further
away, which is the question you ask before deciding whether to keep stepping.

**Marks are scanned from the loaded buffer, not pulled from the engine.** Asking
where every match is would read the corpus to the end, which is exactly what a
pull-shaped cursor exists to avoid. What the buffer holds is what the surface can
draw; the walk goes to places the scan cannot see, and says so by landing there.
`shared/phrase.ts` holds the one matcher both use, so a mark cannot sit anywhere
the walk would not go. **Nothing is marked for a scoped query** — a buffer scan
cannot see tags, so `foo #wombats` would mark every foo on the page, most of them
places the walk will not stop.

**`beyond` stays at zero rather than guessing.** How many matches lie outside the
loaded region is precisely what this scan cannot know, and a number wrong in the
direction of *there are none* is worse than no number.

**Running out wraps round**, which makes the two steppers a loop rather than a
pair of dead ends. The wrap is a fresh cursor with no origin — for a walk into
the past that is the newest thing there is, and for one into the future the
oldest, which falls out of the ordering without a second rule. It says which end
it came round to, because in a notebook those are different places: one is what
you wrote this morning and the other is 2006.

**Amber, not the accent.** The first version tinted matches with the theme
accent, which is brown in the running theme and indistinguishable from cream at
low alpha. A found word wants to read as a highlighter — a colour of its own,
the same in every theme, so that *this is the one you are on* never depends on
which theme is loaded. The current match differs in weight **and** in edge, not
in opacity alone.

**Two bugs worth keeping:**

- **The print window.** `app.on('browser-window-created')` read
  `webContents.id` inside the `closed` handler, which reaches a destroyed object
  and throws — and the window that found it was the hidden one printing makes. A
  PDF came out fine and main fell over on the way back, so m2's print scene lost
  its last three reports. The id is taken while the window is alive.
- **`npx tsc --noEmit -p .` is not this project's typecheck.** It silently
  skipped the main process; `npm run typecheck` (`tsc --build`) is the one that
  checks it, and it found a bad import the moment it was run.

**And a screenshot found what the scene could not**: the bar was an overlay in
the top corner and sat on top of the zone notice. It is in the flow now, below
any notice — a bar that covers the words you are looking for is the wrong shape
for a surface whose job is reading.

## MS4 — search Tephra *(done)*

⌘⇧F and the results pane, rendered like the link directory: a lead of
surrounding text, a source, a date, click to go there. Streaming in, so the
first hits are usable before the scan finishes. **Done** —
`renderer/src/frame/Results.tsx`, plus a `search` scene and ten more m4 checks.

**A location, not a panel**, which is the shape ML3 built and said the second
one would inherit: `{kind:'search', text}`. Back and forward work, the title bar
names it (*Search: surveyor*), and a search you navigated away from is one you
can navigate back to.

**And the second one settled the question ML3 left open: these do NOT want a
shared shape.** The commonality is already expressed by `NavTarget` — a window
shows a document *or* a query — and folding `links` and `search` into
`{kind:'query', …}` would put a discriminated payload inside a discriminated
payload. `links` takes no parameters and this takes a string; there is no shared
field to hoist.

**A hit is a match; a row is a line.** The pane groups by `lineFrom` and marks
every match in the line, saying *2 here* when there is more than one. Ungrouped,
a paragraph mentioning the surveyor twice drew the same sentence twice — the list
showing its own arithmetic rather than the notebook. The walk still steps through
every match, which is what ⌘G means.

**Which found a real bug on the way.** `within` was computed with
`plain.indexOf(matched text)` — the *first* occurrence — so every match after the
first in a line reported the earlier one's position. Two mentions in a paragraph
marked the same word twice and left the second untouched. It takes the ordinal
occurrence now, counted over the whole line rather than the admitted part, since
the line a reader sees holds every occurrence whether the scope admits it or not.

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
