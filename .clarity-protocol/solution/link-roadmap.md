# ML — the link directory

**Requirement: R10a. Decisions: D57, D60, D61.**

Three phases, under MC's rule: **`npm test`, `m0`, `m1`, `m2` and `m3` are green
at the end of each one.**

**What this is, in one sentence.** *"Where is that document I was looking at on
Tuesday?"* — search's sibling, and the half nobody has ever served: search finds
text you remember writing, this finds documents you remember opening. Era 1 had
no links at all; era 2 had them and no way to find them again.

**And what it is architecturally**, which matters more for sequencing: it is the
first instance of **D9's filtered-view mechanism** — the one that holds search
results, subject views and date-range views to be one thing rather than three.
M4 has to build that mechanism regardless. This builds it against the tractable
query: a finite enumerable set, no ranking, reverse-chronological *is* the order,
and the whole thing fits in memory at twenty years. Full-text search over
0.4–0.9 GB does not have any of those properties.

**It also takes the easy fork of D9's one open question.** D9 leaves open whether
a filtered view is editable — "read-only it folds into the markdown UX; editable
it is a composite surface writing back into source ranges, which is the most
demanding thing in the design." **A link directory is read-only by nature.** So
the mechanism gets built without answering that, and the answer is forced later
by tag pivots, where it is genuinely needed.

## Where it sits

**Orthogonal to MT, and the ordering is not driven by engineering.** The two
share exactly one piece of code — ML1 — and nothing else: MT's list is a pane
showing a *document*, this is a pane showing a *query*; D57 already made the TODO
link mode a filter over this index rather than something MT builds; and MT6's
tag pivot is single-segment and editable, which is a different problem wearing
similar words.

So it is scheduled on urgency, and urgency puts the TODO list first. **ML lands
after MT3**, at which point the list is usable and MT4–MT6 are still ahead.

**One sequencing note.** MT1 renames `stream/` (D59) and `CorpusIndex` caches by
path, so doing MT1 first spares this a cache invalidation. Harmless either way —
it is a cache, which is the point of D52 — but free to avoid.

---

## ML1 — one link scanner

**Ships inside MT3, because MT3 needs it**, and is counted here so the dependency
is written down rather than discovered. A todo row is a React table cell, not
CodeMirror, so rendering a live link in one means finding links in a string —
and without this that is the codebase's *third* link regex.

- `shared/links.ts`: every markdown link in a body, both legal spellings of a
  destination, classified through `referenceOf`, which already does that work.
- **No opinion about which links matter** (D61). `indexable(reference)` is a
  separate predicate and lands with ML2.
- Retires `LINK` in `widgets.ts`. **Its first test is the bug it fixes**: insert
  a link whose URL contains a space, and find it rendered — today `destination()`
  writes `(<http://a b>)` and the renderer's own regex cannot read it back.
- `shared/fileset.ts`'s `ITEM` may keep its own regex: an entry line is a label,
  a target and a summary, which is a bigger grammar than a link. Its link half
  should be checked against the scanner in a test rather than merged into it.

**Does not do:** any index, any surface, any policy.

## ML2 — the index

**No surface, and testable straight through the index** — the same discipline as
MT2, and for the same reason: the data model is where the decisions are.

- `links` joins `Scanned` and `Payload` in `CorpusIndex`, as a **parallel array
  rather than a `ScannedSpan` kind**: a link has a target *and* a label, and
  `{kind, name, from, to}` has nowhere to put both. `isPayload` gains a guard,
  which discards the cache once and rebuilds it — free, by design.
- `canonicalizeLink()` in **its own module with its own tests** (D60). Pure
  `(target) => CanonicalLink` for now: strip known tracking parameters and
  fragments, resolve corpus-relative paths to one corpus path. Expected to grow.
- **Store the raw target; group by the canonical form** (D60). The canonical
  form is a derived key, recomputed on read, never the only record.
- `indexable(reference)` (D61) — the one place that says what counts.
- **Dating, which is free.** A day file dates by its `DateKey`; everything else
  dates by the stamp `IndexStore` already keeps. Nothing new is stored.
- Aggregation: link → appearances, each carrying the file, the date, the label it
  was written with, the line it sat in, and the offset to get back to it.

**Does not do:** ranking, fetched titles, dead-link checking.

## ML3 — the pane

**The part M4 pays for anyway.**

- **`NavTarget` grows a variant that is not a document.** It already carries
  `{kind:'span'}` commented *"a search result"*, so the shape was anticipated;
  what changes is that a window's location becomes *a document **or** a query*.
  Window restore, the title bar and back/forward all follow from that one
  change, and every filtered view after this one inherits it.
- The directory itself: a row per **destination**, newest first by last
  appearance. Destination, the label it was written with, the line for context,
  when it was last seen, how many places it appears.
- **Two places per row, which is what makes it more than a bookmark list.**
  Where it goes — browser, OS, or a document in the corpus, all three of which
  `nav.open` already dispatches. And where you wrote it, which is usually the
  question behind the question.
- ⌘-click opens in a new window, the gesture the sidebar already established.
- A query box, filtering in the client. At this scale nothing else is warranted.

## What is deliberately not here

- **Ranking.** Reverse-chronological is the order the requirement asks for.
- **Fetched titles.** The label a person wrote is nearly always the title,
  because that is how people write links, and fetching would put the network on
  a retrieval path that has to answer in about two seconds.
- **Dead-link checking.** A different feature with a different failure mode.
- **An accumulating history of deleted links** (D60). The index is a cache of the
  corpus as it stands; the corpus's own append-only shape is what keeps links
  from finished work.
