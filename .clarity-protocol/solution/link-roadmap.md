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

## ML1 — one link scanner *(done, in MT3)*

**Done.** `shared/links.ts` holds the scanner and `destination` both — the
writer moved there from the renderer, because the two are one grammar's halves
and keeping them apart is how they came to disagree in the first place. The bug
is fixed and pinned twice: once against `scanLinks` and once against the real
lezer parser, since neither check alone would have caught it.

### What it was

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

## ML2 — the index *(done)*

**Done**, and verified by 26 tests that draw nothing — the same discipline as
MT2, and for the same reason: the data model is where the decisions are.

- **`canonicalizeLink()` and `indexable()` share one module**, `shared/link-index.ts`,
  because they are one policy and they change together. `shared/links.ts` stays
  the unopinionated scanner, which is D61's split expressed as files.
- **`CanonicalLink` is branded**, so it cannot be stored where a target belongs.
  That is D60's load-bearing half made structural rather than merely written
  down: the index stores the raw target, the key is derived on read, and there
  is deliberately no way back from a key to something you could open.
- **Conservative canonicalization**, settled in conversation: drop the fragment,
  drop tracking parameters, lowercase scheme and host, drop a default port,
  resolve a corpus-relative path against the file it was written in. **Not**
  stripping `www.`, not unifying `http` with `https`, not reordering query
  parameters — each is a claim about host identity the URL does not make, and
  *"we don't need a perfect, Internet corpus-wide URL canonicalizer"*. What is
  actually worth merging is a thing to learn from use.
- **Dating is free and slightly approximate, which is recorded rather than
  hidden.** A day dates by its `DateKey`, exactly — and that covers the notebook,
  where links are mostly written. Everything else dates by the stamp the store
  already keeps, which moves when anything in the file changes, so "last
  appearance" in a note means "the note was last touched". Accepted.
- **The cache rebuilt itself**, as MT5b's did, on the rule `isPayload` has
  carried since D52: a shape it does not recognise is a cache it throws away.

### What the building found

- **Day files do not go through the generic scan path**, and the roadmap did not
  say so. `CorpusIndex.#scan` delegates a day to `SegmentedDocument.scan(date)`
  — deliberately, because a day the editor is holding must answer for itself
  including unsaved edits (D52), and a long day's later parts are covered once
  by its first file. So `scan()` had to return links too. Missing it would have
  indexed no links from **the notebook**, which is where nearly all of them are,
  and every test over notes would still have passed. There is a test with a
  two-part day for exactly this.
- **`indexable` takes the link, not the reference**, which is a small amendment
  to D61's wording. "Not images" is a fact about the link rather than about
  where it points, so a reference argument would have split the policy across
  two places — and one place is what the decision is for.

**Does not do:** ranking, fetched titles, dead-link checking, or any surface.

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
