# The TODO System — Shapes

Not a detailed design; the shapes that `goal/todo.md`'s requirements and flows have already forced, and the small number of things still genuinely open. Detailed architecture happens at the keyboard.

Each shape is marked **forced** (the requirements leave no room), **proposed** (a choice with a reason, revisable), or **open**.

## 1. It is a text kind, and the record-shaped prediction was wrong — *forced*

`file-documents.md` predicted todo as "record-shaped: an edit is a field, and history is per item," which is why M3 deferred it as an expensive first test of the four-artifact shape. The requirements say otherwise. An item is a line. Tags and dates are inline markers left in the line (T16). History is per *day*, not per item — nothing in the three interactions asks when a single item's status last flipped; they ask what the list looked like.

So `TodoDocument extends SegmentedDocument`, segments keyed by `DateKey`, exactly as the stream is. It supplies `load(key)` and `keys()` and inherits everything else: edits, undo, spans, comments, the journal, the WAL, windows, divergence, versioning, restore. `file-documents.md` needs correcting on this point.

## 2. Days as segments, copied forward — *proposed, and load-bearing*

A list is a directory of day files — `todo/<list>/YYYY/MM/YYYY-MM-DD.todo.md`, mirroring `stream/` (§6). **Each day's file holds that day's working set in full**, and the morning walk writes it by carrying items forward: era 2 exactly, minus the retyping.

This is the choice everything else hangs on, and it is worth stating what it buys, because it is a lot:

- **Flow 3's "designated working set" needs no representation of its own.** It *is* the day's file. Persistence across app close, standing across skipped days, idempotence on a second walk — all fall out.
- **Flow 7 (scrub to a past day) is opening a file.**
- **ctime and mtime stop being metadata to maintain and become facts about the corpus** — first day a line appears, last day it changed. R15's "recorded from day one, never backfilled" becomes structurally guaranteed rather than a discipline someone has to keep.
- **Q3b (what evicts resolved items) is answered:** nothing evicts them; they simply are not carried. They stay in the day they were finished.
- **Undo, WAL and divergence arrive free** because every verb is a `replace()` on a body, as the fileset's `pin`/`reorder` already are.

The cost is duplication, and it is small: a ~30-line working set copied daily is roughly 220k lines over twenty years, ~15 MB — against the stream's own 0.4–0.9 GB. Cheap, and the "duplication" is precisely what history is.

## 3. Items carry ids, and this is smaller than it first looked — *forced*

Copy-forward only works if tomorrow's line can be recognised as today's item, and text-matching breaks the moment an item is reworded. So an item carries a stable id, assigned at creation and carried forward with it — a trailing `<!--tephra:item 7f3a-->`, invisible in any markdown renderer. Identity is also what makes ctime and mtime derivable in §2, what the link index points back at, and what backlog resurfacing tracks.

**This was first written up as a departure from the "no ids" rule. On a closer reading of the record, it is not one.** The rule belongs to **D20**, and what D20 actually says is that spans are *inferred from the markdown, never stored beside it*. An item id is not stored beside the text; it is **in** the text, like every other marker, so the document remains a pure function of its bytes and hand-editing is still satisfied structurally rather than by care. D20 is untouched.

**And the precedent already exists in this codebase.** Comment threads carry machine-assigned ids that live inline as `<!--tephra:comment …-->`, with `unusedCommentId` minting them and `TypedSpan`'s comment variant naming them. An item id is that pattern, unchanged. What is genuinely new is only that the id is *required* rather than optional and must be unique across the corpus — a constraint, not a new mechanism.

The real caution is sequencing, not principle: ids written from day one are cheap, and retrofitting identity onto a year of carried-forward lines is not. Same class as R15's un-backfillable timestamps.

## 4. The verbs are sugar over `replace()` — *forced*

Because markers live in the text (T16), tagging *is* an edit. The X-layer API is therefore small, and its shape is the fileset's:

- `add(text)` — parse the inline notation, append to today. The one verb flow 1 calls from outside the surface.
- `setStatus(id, status, note?)`, `setDue(id, date)`, `tag(id, name)`, `untag(id, name)` — each one `replace()` on a span of the day's body.
- `carry(ids)` — the walk's designation verb, and the only one that writes a whole segment.
- `items(filter)` — reads.

**The parse is shared** (`shared/kinds/todo.ts`), for the reason `shared/fileset.ts` and `shared/prose.ts` are: main reads day files off disk, the renderer parses the one in the editor, and two implementations of one parse is the failure this codebase keeps meeting. It is also what makes the assisted and typed entry paths in T16 incapable of disagreeing.

## 5. Two indices, differently shaped, and one of them is not a TODO feature — *forced*

Flows 4 and 6 want different things and cannot share a structure:

- **Tags** — tag → items, partitioned into *has live items* and *does not* (T6, which is what makes completion in flow 1 useful), plus per-tag recency if Q3a resurfaces on tag activity. This one is TODO-scoped, because TODO tags are their own namespace (T5).
- **Links** — link → appearances, each carrying last-seen date, the surrounding text, and a back-reference to what contained it.

Both are caches over what the files say, discardable and rebuildable, machine-local (D7, D52) — so they belong in or beside `CorpusIndex`, which already sweeps every file by `stat` stamp and scans bytes for exactly this reason.

### The link directory is a corpus capability (R10a)

**It was scoped to the TODO list because that is where the need was felt, and that scoping is wrong.** *"Where is that document I was looking at on Tuesday?"* is asked of the notebook at least as often as it is asked of the task list, and the machinery does not care which file a link was found in. `CorpusIndex` already walks every file; `Reference` already has a `url` variant alongside `file`, `tag`, `day` and `section`; `architecture.md` already reserves the pattern ("a second index later (backlinks, tags) needs no change"). Building it TODO-only is not cheaper — it is the same work aimed at less.

So: **one index over every link in the corpus**, whatever file it appeared in, reverse-chronological by last appearance, searchable, each row carrying enough context to recognise the link and a reference back to where it lives. The TODO surface's link mode is a *filter* over it, and the stream gets the same view for free. Promoted to **R10a** in `requirements.md`, beside full-text search, which is its sibling: search finds text you remember writing, this finds documents you remember opening.

**Sequencing note.** This makes the link directory separable from the TODO work and cheaper than it looked — it needs no item ids, no walk, and no surface beyond a list. It is the one piece here that could ship on its own and pay for itself immediately.

## 6. One format for every list, and an address for every item — *forced*

**All TODO files have the same shape.** There is no lightweight second form: multiplying formats buys nothing, and a secondary list wants the walk and the history as much as the main one does. So every list is a directory of day files — `todo/<list>/YYYY/MM/YYYY-MM-DD.todo.md` — and the distinguished list is simply the one at a known name, `todo/main/`, with no special-casing anywhere in the layout.

**Items are addressable, because several things need to point at one.** The index points at items, the sidebar loads them, the link directory back-references them, and a note in the stream may name one. The existing reference vocabulary (D53) takes the new host directly:

- **`tephra:todo/<id>`** — one item. Ids are unique across the corpus, so the address needs no list name, and the index resolves it. It opens at the item's **newest** instance, which is its current state. (Note this inverts `tephra:mark/<name>`, which resolves to the *first* in date order: a bookmark means where something was first said, an item means what it is now.)
- Following one opens the list, in the day holding that instance, positioned at the line.

**An item's own history comes free, and was not asked for.** Because copy-forward leaves one copy per day, the set of instances sharing an id *is* the item's day-by-day history — when it started, when it went blocked, what its text used to say. `goal/todo.md` explicitly did not ask for per-item history, and `file-documents.md` predicted it would have to be built; it turns out to be a by-product of the storage. Worth a detail view eventually. Worth building nothing for now.

## 7. The surface: one view type, five modes — *proposed*

The first entry in `renderer/src/editor/kinds/registry.ts`'s empty `SURFACES` table — the first thing in Tephra shown as something other than running text. Modes: the list (with its due-soon band and overflow rule), the walk, the tag pivot, the link directory, the scrub. `scope.md`'s counting rule holds: modes of one type, not new types.

**A pleasant consequence of §2 worth noticing.** `scope.md` calls editable filtered views "the most demanding question in the design" — a composite surface writing back into source ranges. But every *live* item is in today's file, so the live part of a tag pivot is a filter over **one segment**, and writing back is an ordinary edit to it. Only the "recently resolved" tail reaches into other days, and that part can be read-only. The hard version of the problem does not arise here.

## 8. What is still open

- **Q3a**, backlog resurfacing — **deferred to a later milestone by decision**, to be answered from use. Safe to defer because copy-forward already records every input such a mechanism could want; what ships meanwhile is a reachable, counted drawer, which is honestly a graveyard with a door on it and should be watched as one.
- **The id's own shape**: how it is minted, how long, and what guarantees uniqueness across a corpus that two devices write to concurrently. `unusedCommentId` solves the single-document version of this and is the place to start.
- **The soft cap's number**, and whether it is fixed, configurable, or adaptive. Flagged in `goal/todo.md` as the requirement with the least evidence behind it.
- **Mobile.** The walk is a daily ritual, the phone is where mornings happen, and the walk is the one flow whose interaction model differs most between a keyboard and a thumb. Mobile is v2b and behind sync, so the task now is confirming nothing here forecloses it — not designing it.

## 9. Risks

**The walk is the whole design, and it is a habit.** If it is not performed, the working set never turns over, the soft cap never speaks, and the system degrades to a long undifferentiated list — era 2 without the retyping. Nothing in the architecture can compensate; the mitigation is that the walk must be genuinely fast, and it should be watched in use rather than assumed.

**Identity is a one-way door.** Ids written into files from day one are cheap; retrofitting identity onto a year of copied-forward lines is not. This is the same class as R15's timestamps, and it is why §3 comes first.

**It is the first non-text surface**, so it will find whatever `Document` assumes about prose. `file-documents.md` predicted that fork would come with a record-shaped kind; §1 says it will not, but the *surface* still has to render something that is not a paragraph, and that is where the unknowns actually are.
