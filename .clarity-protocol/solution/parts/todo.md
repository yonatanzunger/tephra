# The TODO System — Shapes

Not a detailed design; the shapes that `goal/todo.md`'s requirements and flows have already forced, and the small number of things still genuinely open. Detailed architecture happens at the keyboard.

Each shape is marked **forced** (the requirements leave no room), **proposed** (a choice with a reason, revisable), or **open**.

## 1. It is a text kind, and the record-shaped prediction was wrong — *forced*

`file-documents.md` predicted todo as "record-shaped: an edit is a field, and history is per item," which is why M3 deferred it as an expensive first test of the four-artifact shape. The requirements say otherwise. An item is a line. Tags and dates are inline markers left in the line (T16). History is per *day*, not per item — nothing in the three interactions asks when a single item's status last flipped; they ask what the list looked like.

So `TodoDocument extends SegmentedDocument`, segments keyed by `DateKey`, exactly as the stream is. It supplies `load(key)` and `keys()` and inherits everything else: edits, undo, spans, comments, the journal, the WAL, windows, divergence, versioning, restore. `file-documents.md` needs correcting on this point.

## 2. Days as segments, carried forward automatically — *proposed, and load-bearing*

A list is a directory of day files — `<name>.todo/YYYY/MM/YYYY-MM-DD.md`, mirroring the stream (§6). **Each day's file holds that day's working set in full.**

**The carry is automatic, and that is a correction to the first draft of this document.** It said the morning walk wrote the file by carrying items forward — era 2 exactly, minus the retyping. But `goal/todo.md` also says the walk is offered and never compelled, and those cannot both be true: a skipped walk would leave the day with no file, so an item added on Thursday would go either into a file dated Monday (making ctime a lie) or into a Thursday file holding one item (making the invariant a lie). **So the first touch of a new day materialises that day's set from the last day that has one**, whether or not anyone walks it, and the walk becomes a review pass over a file that already exists.

The split is worth naming because it is what makes the whole scheme safe: **the carry protects the data; the walk protects the attention.** Era 2 did both at once and could not tell them apart, because copying the list by hand *was* reading it.

This is the choice everything else hangs on, and it is worth stating what it buys, because it is a lot:

- **Flow 3's "designated working set" needs no representation of its own.** It *is* the day's file. Persistence across app close, standing across skipped days, idempotence on a second walk — all fall out.
- **Flow 7 (scrub to a past day) is opening a file.**
- **Q3b (what evicts resolved items) is answered:** nothing evicts them; they simply are not carried. They stay in the day they were finished.
- **Undo, WAL and divergence arrive free** because every verb is a `replace()` on a body, as the fileset's `pin`/`reorder` already are.

**What it no longer buys, and this is the second correction.** The draft credited copy-forward with making ctime and mtime "facts about the corpus" — first day a line appears, last day it changed — rather than metadata to maintain. That is true and it is not enough: the resolution is one day rather than a timestamp, and recovering either one means finding the earliest or latest file containing an id, which is a corpus scan without an index. **T3 now stores both explicitly** (§3). The other four items above are untouched, so the choice survives; the argument simply stops claiming this one.

The cost is duplication, and it is small: a ~30-line working set copied daily is roughly 220k lines over twenty years, ~15 MB — against the stream's own 0.4–0.9 GB. Cheap, and the "duplication" is precisely what history is.

## 3. Items carry ids, and this is smaller than it first looked — *forced*

Copy-forward only works if tomorrow's line can be recognised as today's item, and text-matching breaks the moment an item is reworded. So an item carries a stable id, assigned at creation and carried forward with it — a trailing marker, invisible in any markdown renderer. Identity is also what the link index points back at, and what backlog resurfacing tracks.

**The marker carries the timestamps too**, because T3 stores them rather than deriving them:

```
- [ ] Call the surveyor #house DUE 2026-09-14 <!--tephra:item 7f3a1b2c 1756684800 1756771200-->
```

id, ctime, mtime. The grammar `scanMarkers` already parses is `<!--tephra:<verb> <rest>-->` with `rest` handed to the caller unsplit, so adding `item` to its verb list is the whole change to the shared scanner; the todo parse splits the three fields itself.

**Eight base-36 characters, minted against the index rather than sized against the birthday bound.** `unusedCommentId` mints four and checks them against one body, which is correct there and wrong here: ids must be unique across the corpus for `tephra:todo/<id>` to resolve without a list name, and four characters over a few thousand items collides with probability near one. Eight is ample on its own, and checking the mint against the index — which must hold every id anyway, for the address to resolve — makes it certain rather than merely likely. Same pattern as `unusedCommentId`, aimed at the right set.

**mtime is stamped by operations, never by typing.** A status change, a tag, a due date and a committed row edit each already rewrite the line as one `replace()`, so the stamp rides along and costs nothing. Keeping it exact through free-text typing would mean main injecting a marker rewrite into the line the cursor is in on every keystroke — against a renderer that holds the buffer optimistically and reconciles against main's acknowledged length, which is what `DesyncError` exists for. `goal/todo.md`'s flow 2 makes this a non-issue rather than a compromise: **a row is edited by a gesture that commits once**, so a text change *is* an operation. The only edits that escape the stamp are ones made to the file as raw text, and those are picked up by the next carry.

**This was first written up as a departure from the "no ids" rule. On a closer reading of the record, it is not one.** The rule belongs to **D20**, and what D20 actually says is that spans are *inferred from the markdown, never stored beside it*. An item id is not stored beside the text; it is **in** the text, like every other marker, so the document remains a pure function of its bytes and hand-editing is still satisfied structurally rather than by care. D20 is untouched.

**And the precedent already exists in this codebase.** Comment threads carry machine-assigned ids that live inline as `<!--tephra:comment …-->`, with `unusedCommentId` minting them and `TypedSpan`'s comment variant naming them. An item id is that pattern, unchanged. What is genuinely new is only that the id is *required* rather than optional and must be unique across the corpus — a constraint, not a new mechanism.

The real caution is sequencing, not principle: ids written from day one are cheap, and retrofitting identity onto a year of carried-forward lines is not. Same class as R15's un-backfillable timestamps.

## 4. The verbs are sugar over `replace()` — *forced*

Because markers live in the text (T16), tagging *is* an edit. The X-layer API is therefore small, and its shape is the fileset's:

- `add(text)` — parse the inline notation, append to today. The one verb flow 1 calls from outside the surface.
- `setStatus(id, status, note?)`, `setDue(id, date)`, `tag(id, name)`, `untag(id, name)` — each one `replace()` on a span of the day's body, each stamping mtime as it goes.
- `edit(id, text)` — the committed row edit, which is the same shape: one `replace()` over the line, tags and date and all, because the surface collects the whole change before sending it.
- `carry()` — materialise today from the last day that has a file. **Automatic, idempotent, and not the walk's** (§2): it runs on the first touch of a day and does nothing on the second. The only verb that writes a whole segment.
- `items(filter)` — reads.

**The parse is shared** (`shared/kinds/todo.ts`), for the reason `shared/fileset.ts` and `shared/prose.ts` are: main reads day files off disk, the renderer parses the one in the editor, and two implementations of one parse is the failure this codebase keeps meeting. It is also what makes the assisted and typed entry paths in T16 incapable of disagreeing.

## 5. Two indices, differently shaped, and one of them is not a TODO feature — *forced*

Flows 4 and 6 want different things and cannot share a structure:

- **Tags** — tag → items, partitioned into *has live items* and *does not* (T6, which is what makes completion in flow 1 useful), plus per-tag recency if Q3a resurfaces on tag activity. This one is TODO-scoped, because TODO tags are their own namespace (T5).
- **Links** — link → appearances, each carrying last-seen date, the surrounding text, and a back-reference to what contained it.

Both are caches over what the files say, discardable and rebuildable, machine-local (D7, D52) — so they belong in or beside `CorpusIndex`, which already sweeps every file by `stat` stamp and scans bytes for exactly this reason.

### The link directory is a corpus capability (R10a)

**It was scoped to the TODO list because that is where the need was felt, and that scoping is wrong.** *"Where is that document I was looking at on Tuesday?"* is asked of the notebook at least as often as it is asked of the task list, and the machinery does not care which file a link was found in. `CorpusIndex` already walks every file; `Reference` already has a `url` variant alongside `file`, `tag`, `day` and `section`; `../architecture.md` already reserves the pattern ("a second index later (backlinks, tags) needs no change"). Building it TODO-only is not cheaper — it is the same work aimed at less.

So: **one index over every link in the corpus**, whatever file it appeared in, reverse-chronological by last appearance, searchable, each row carrying enough context to recognise the link and a reference back to where it lives. The TODO surface's link mode is a *filter* over it, and the stream gets the same view for free. Promoted to **R10a** in `requirements.md`, beside full-text search, which is its sibling: search finds text you remember writing, this finds documents you remember opening.

**Sequencing note.** This makes the link directory separable from the TODO work — it needs no item ids, no walk, and nothing from the storage above. It is *not* cheaper than it looked, which the first draft of this line claimed: nothing scans links today, so it is a scanner, an index payload and a pane of its own. It has its own roadmap (`solution/parts/link-roadmap.md`) and lands after MT3, sharing exactly one piece of code with this milestone — the scanner, which MT3 delivers because a todo row needs to render a live link.

## 6. One format for every list, and an address for every item — *forced*

**Two shapes, one format** *(amended 2026-09-02; D55)*. The first draft said there was no lightweight second form, on the grounds that a secondary list wants the walk and the history as much as the main one does. An **overall todo file** — the blog posts you mean to write — wants neither: it does not turn over daily, so the carry has nothing to carry, and *today's working set* is a meaningful idea for tasks and a meaningless one here. A **daily todo file** is a `.todo` directory of day files; an **overall todo file** is a single unsegmented one, holding exactly what one day segment holds. (Whether that is spelled `.todo` or `.todo.md` is open — `solution/parts/todo-roadmap.md`.) They share the item grammar, every verb and the whole surface; what differs is `keys()`, which `SegmentedDocument` has modelled since D54 (`ONLY_SEGMENT` is what markdown and fileset are built on). Multiplying *formats* still buys nothing, and this does not multiply one.

**A multi-file document is a directory named by its kind, exactly as a file is named by its kind.** `kindOf` already works this way in spirit — it answers `'stream'` for anything under `stream/`, so *the containing directory already decides a file's kind*. Making that a suffix instead of one hardcoded name turns the special case into a rule:

- `notebook.stream/2026/08/2026-08-31.md`
- `main.todo/2026/09/2026-09-01.md`

Day files lose their own extension, because the directory carries it. `DocumentId` for a multi-file document is then its directory path; `kindOf` is one function over files and directories both; and `STREAM_ID` stops being a magic string that means "the one document whose id is not a file" and becomes "the `.stream` directory at the root". **The distinguished list falls out of T1 rather than being named**: the `.todo` directory at the notebook root is *the* list, others live in subdirectories, and two at the root is an anomaly — which this app already has a place to report.

**The stream migrates, and the pre-migration restore seam is accepted.** `STREAM_DIR` has ten uses, all behind the constant, so the code change is small. The consequence is not: the notebook is git-versioned and `StreamHistory` reads past versions *by path*, so versions committed before the rename become unreachable through Tephra's own restore. Teaching the two history call sites both names would close that, and it is deliberately not being done — there is nothing critical in the history behind that seam, and a permanent compatibility branch is a worse thing to carry than a dated line in this document. **Versions before the migration are readable through git and not through restore.**

**Items are addressable, because several things need to point at one.** The index points at items, the sidebar loads them, the link directory back-references them, and a note in the stream may name one. The existing reference vocabulary (D53) takes the new host directly:

- **`tephra:todo/<id>`** — one item. Ids are unique across the corpus, so the address needs no list name, and the index resolves it. It opens at the item's **newest** instance, which is its current state. (Note this inverts `tephra:mark/<name>`, which resolves to the *first* in date order: a bookmark means where something was first said, an item means what it is now.)
- Following one opens the list, in the day holding that instance, positioned at the line.

**An item's own history comes free, and was not asked for.** Because copy-forward leaves one copy per day, the set of instances sharing an id *is* the item's day-by-day history — when it started, when it went blocked, what its text used to say. `goal/todo.md` explicitly did not ask for per-item history, and `file-documents.md` predicted it would have to be built; it turns out to be a by-product of the storage. Worth a detail view eventually. Worth building nothing for now.

## 7. The surface: one view type, five modes — *proposed*

The first entry in `renderer/src/editor/kinds/registry.ts`'s empty `SURFACES` table — the first thing in Tephra shown as something other than running text. Modes: the list (with its due-soon band and overflow rule), the walk, the tag pivot, the link directory, the scrub. `scope.md`'s counting rule holds: modes of one type, not new types.

**A pleasant consequence of §2 worth noticing.** `scope.md` calls editable filtered views "the most demanding question in the design" — a composite surface writing back into source ranges. But every *live* item is in today's file, so the live part of a tag pivot is a filter over **one segment**, and writing back is an ordinary edit to it. Only the "recently resolved" tail reaches into other days, and that part can be read-only. The hard version of the problem does not arise here.

## 8. What is still open

- **Q3a**, backlog resurfacing — **deferred to a later milestone by decision**, to be answered from use. Safe to defer because copy-forward already records every input such a mechanism could want; what ships meanwhile is a reachable, counted drawer, which is honestly a graveyard with a door on it and should be watched as one.
- **The soft cap's number**, and whether it is fixed, configurable, or adaptive. Flagged in `goal/todo.md` as the requirement with the least evidence behind it.
- **Mobile.** The walk is a daily ritual, the phone is where mornings happen, and the walk is the one flow whose interaction model differs most between a keyboard and a thumb. Mobile is v2b and behind sync, so the task now is confirming nothing here forecloses it — not designing it.

## 9. Risks

**The walk is a habit, and habits lapse.** This was the headline risk while the walk also wrote the day's file; §2's split shrinks it to its real size. A walk that is not performed no longer means a working set that never turns over — the carry handles that — it means the soft cap never speaks and nothing is groomed, so the list grows into a long undifferentiated one. That is era 2, which was liveable for years. The mitigation is unchanged: the walk must be genuinely fast, and it should be watched in use rather than assumed. What is no longer at risk is the *data*.

**The migration has a seam in it** (§6). Restore cannot reach versions committed before the stream directory was renamed. Accepted deliberately; worth remembering the next time somebody goes looking for an old day and does not find it.

**Identity is a one-way door.** Ids written into files from day one are cheap; retrofitting identity onto a year of copied-forward lines is not. This is the same class as R15's timestamps, and it is why §3 comes first.

**It is the first non-text surface**, so it will find whatever `Document` assumes about prose. `file-documents.md` predicted that fork would come with a record-shaped kind; §1 says it will not, but the *surface* still has to render something that is not a paragraph, and that is where the unknowns actually are.
