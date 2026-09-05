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

## ML3 — the pane *(done)*

**Done**, and verified by `npm run m3`. **The part M4 pays for anyway**, and it
paid for itself immediately: `NavTarget` gained one variant that is not a
document, and the title bar, back/forward, window restore and *bring it to the
front* all followed from that alone. Nothing needed a special case per view,
which is the whole claim — every filtered view after this one inherits it.

- **`{ kind: 'links' }`, deliberately concrete** rather than a general
  `{kind:'query'}`. There is one query; what a shared shape should look like is
  a thing the second one will say, and inventing it now would be guessing.
- **`Pane.document` became nullable**, which is the honest consequence: a pane
  showing a query has nothing to undo into. Keeping the last document would have
  been one character less and would have put ⌘Z on a document nobody is looking
  at.
- **`documentOf` became "the subject of a window"** — a document *or* a query.
  Still one comparison, which is what stops the second filtered view from having
  to add a second one.
- **⌘2, beside ⌘0 and ⌘1**, meaning what they mean: there should be a window
  with this in it, in front.
- **Restore was free.** `WindowState.location` is a `NavTarget` and the parser
  takes it as it stands, so a window left on the directory comes back to it.

### What the building found

- **A history entry was being lost.** `goTo` pushed the previous location onto
  the back stack only `if (this.#window !== null)` — and a pane showing a query
  has no window, so leaving the directory pushed nothing and *back* would have
  skipped it. It tests whether anything has been loaded now, which is what it
  meant all along.
- **The context line was showing raw markup** — `[the paper](https://…)` where a
  sentence belongs. Exactly the defect reported on the due-soon rail a few days
  earlier, in a place nobody had thought to look at yet. `flattenLinks` is the
  same cure, and this is the second caller that wanted it.
- **A column that sorts by one thing and shows another.** The date column first
  showed a *filename* for an appearance in a note, on the grounds that its mtime
  is not really when the link was written — true, and worse: the rows were
  already being *sorted* by that same number, so showing something else was the
  real inconsistency. Every appearance carries a day now, computed in main
  because there is one answer about what day it is and the notebook's zone is
  where it lives (D62, D63); the index stays free of both.

### And then it was used, which found five things

**All five were about recognition**, which is the directory's entire job — and
four of them were invisible until there was a real corpus behind it.

- **A link written in a TASK could not be opened.** `tasks.todo/2026/09/…md` is
  a *segment of a directory document* (D59), not a document id, so following it
  asked to open a path that is not one — `ENOTDIR`. Main answers with the
  document and the segment now, so the renderer does not have to guess which
  kind of thing a file is.
- **Clicking the destination did nothing**, because it went through `openLink`,
  which resolves paths *inside the notebook* and returns null for a URL. The
  roadmap named the right function and this did not use it: `nav.open` dispatches
  browser, OS and corpus document, and returns which happened.
- **A task's line showed its item marker.** The file being what it appears to be
  is the premise of the storage, and it means a line pulled out for display
  carries what the app wrote beside what a person did. `plainLine` is the answer
  for every place that shows a LINE rather than a document; tags and due dates
  stay, because a person typed those and meant them (T16).
- **The label was not enough to recognise anything.** "course", "bio draft",
  "list" mean what the sentence around them meant. So **the sentence leads** —
  first line, full size — and the destination follows beneath it. The row is
  still about a destination; what it *shows* is what a person would know it by.
- **There was no way to filter by source**, which turns out to be one of the few
  things anybody reliably remembers: *it was in a task*, *it was in the
  publication list*. Every row names its source and the name is a filter you can
  click.

**And then a sixth, from looking at it again: the link belongs IN the
sentence.** Showing the label beside the row was arbitrary — a row groups
appearances by destination, and each may have been written with different words,
so one of them was being shown as if it spoke for all. It is underlined where it
was written now, exactly as in the file, and the label is not repeated anywhere.

That merged two renderers into one. The task list already drew links in its rows
(MT3) and this needed the same thing; the two would have differed in precisely
the way `shared/links.ts` exists to prevent — and the todo copy carried the same
`openLink` defect, so **a URL in a task row had never done anything either**.
One `Prose`, dispatching through `nav.open`, and `plainLine` stops flattening
links so a caller that can draw one draws it live. Only a caller that cannot —
a button's label, a menu item — composes `flattenLinks` on top.

**And a seventh, about type.** Next to the task list the panel *felt* small and
hard to read — 13.5px against the notebook's 20px, with 10.5px chips. Every
number was a constant in a stylesheet where the theme should have owned it,
which is MT3's finding word for word. The fix is not a bigger constant:

**Two faces, by what each thing IS.** The line a link was written in is quoted
prose from the notebook — not chrome, a sentence you wrote — so it is set in the
READING face, at a fraction of the reading size (`--quoted`, .78 for now, a knob
rather than a number to live with). Everything around it is apparatus and stays
in the UI face. That is how an index has always been set, entry in the text face
and apparatus in the UI face, and it is why the panel stopped feeling like a
different, smaller app than the notebook beside it. The expansion rows are
smaller again, because they are the same link seen a second time.

**One more, found while fixing those.** The title bar asked the LOCATION what
kind it was, so a window reached by a span — which is how the sidebar opens a
note and how every directory row opens anything — fell past the document branch
and called a task list *"5 Sep"*. It asks the document now, which is what it
meant: a window is called after what it is showing, and only the stream is
called after a day.

## What is deliberately not here

- **Ranking.** Reverse-chronological is the order the requirement asks for.
- **Fetched titles.** The label a person wrote is nearly always the title,
  because that is how people write links, and fetching would put the network on
  a retrieval path that has to answer in about two seconds.
- **Dead-link checking.** A different feature with a different failure mode.
- **An accumulating history of deleted links** (D60). The index is a cache of the
  corpus as it stands; the corpus's own append-only shape is what keeps links
  from finished work.
