# Every file is a document

> **A design note, not yet a decision.** For M3.2's remainder and M3.4. Written
> against D27 (one segment outside the stream), D53 (sections are filesets),
> D52 (the index is a cache), D12 (divergence), D32 (the WAL and versions).

## Why now, and not for the reason it looks like

The sidebar can pin, unpin and list; it cannot **open** the thing it names. A
markdown file in the corpus — a note, a branched passage, a fileset — has no
window to be shown in, so `Reference{kind:'file'}` declines rather than
navigating, and D53's claim that a pin is "undoable by the ordinary undo" is
false: a pin is a file write that ⌘Z has never heard of.

The sequencing argument is the sharper one. **The rest of the sidebar's work
writes to fileset files**: reordering rewrites the order, deletion removes a
section, "pin to…" writes into a chosen one. Done before this, all three are
direct writes that have to be rewritten afterwards. Done after, they are
ordinary document edits and inherit undo, the write tiers, the WAL, divergence
and versioning without asking.

## The shape: documents come in KINDS, and the stream is one of them

The framing that makes the rest fall out: **"an infinite stream chopped into
days" is a file format, not a privileged thing.** It sits beside plain markdown
and the fileset as one kind among several, and `DocumentMeta.kind` — which the
format already declares by filename suffix and mirrors in frontmatter (D3) — is
what says which.

| Kind | What it is | What it adds beyond `Document` |
|---|---|---|
| **markdown** | one file, one segment (D27) | nothing |
| **fileset** | a file whose content is an ordered list of references (D53) | `entries()`, `pin`, `unpin`, `reorder`, `remove` |
| **stream** | days as segments, growing at one end (D8) | `today()`, `dates()`, `extent()`, `dateAt()`, growth |
| *(later)* **pdf, todo…** | whatever they are | whatever they need |

**`Document` is what every kind can answer**: identity, generation, dirtiness,
`read` into a window, `replace`, undo and redo, `spans`, position arithmetic,
flush and release. Everything a KIND can do beyond that lives on the kind.

### Two day-shaped things have leaked into the common interface

`extent(): {first: DateKey, last: DateKey}` and `dateAt(): DateKey` are on
`Document` today, and they are the stream's. A fileset has no extent in dates
and no date at a position; implementing them means returning null forever, which
is a type saying "not applicable" in the one vocabulary that cannot say it.

They move to the stream kind, and the callers that want them — the date-range
print chooser, the day seam, the timeline — are asking a stream a stream
question and can say so.

### What this makes of the sidebar's writes

**`pin`, `unpin` and `reorder` are fileset verbs**, so they belong on the
fileset document rather than on a reader that edits files behind the document
layer's back. That is the whole sequencing argument arriving at its destination:
put them there and they are ordinary `replace` calls, which means undo, the
write tiers, the WAL, divergence and versioning without a line of new machinery
— and D53's claim that a pin is undoable stops being aspirational.

## Three properties that hold for every kind

**1. One representation in main, N in the front end — and main is therefore the
synchroniser.** A window is a front end; several windows over one document are
several front ends over one authority. This is D37 restated: the document lives
in main, the views are elsewhere, and everything they do goes through the middle
where it can be ordered.

**2. An `AppWindow` is a view onto a document.** Opening, closing and having
several is a property of windows, not of documents — a document does not know
how many windows are looking at it, and does not need to.

**3. A new kind changes the verbs and nothing else.** A PDF document would have
its own (render a page; annotate a region?) and would still be one authority in
main with N views, still openable in a window, still closable. **The kind varies
what you can DO; it does not vary the architecture.**

That third property is the test for whether this design is right, and it is
worth applying before writing the code rather than after: if adding a kind would
require a new registry, a second synchroniser, or a window that is not a view of
a document, then the shape is wrong and this is the moment it is cheapest to
find out.

## The rule this turns on

**X reaches a document only through the table, and reaches a file only through a
document.** There is no second path and no "unless it is not open" clause: if
something in X wants to know what a file contains, it borrows the document and
asks it.

An earlier draft of this note said "an open document answers for itself; the
disk answers otherwise", which is the same idea with a hole in it. Two answerers
means two implementations of one question, and the hedge is where they drift:
the index asking "is this loaded?" and the fileset reader forgetting to. **Make
opening cheap and there is nothing for the second path to do.**

Three things follow, and each of them makes something already built simpler.

### Eviction stops being optional — and the sweep says so itself

If the index borrowed seven thousand days the ordinary way, the cache would hold
seven thousand documents, so it must be able to let go: **never what is dirty,
never what a window points at; otherwise least-recently-used within a bound.**

But the better half is that **the sweep declares itself** rather than being
guessed at. A batch pass borrows `{ mode: 'read', retain: false }`, so it never
enters the cache at all and never displaces what a person is working on. The
eviction policy is then a backstop for ordinary use rather than the mechanism
that keeps indexing affordable.

### The index stops being a peer of documents

Today `Document.spans()` consults the index and the index reads days through the
document — two arrows in opposite directions, which worked only because each
called a different method. Under one access path that dependency collapses:

- **A document answers about itself**, from its own segments. It never consults
  a cache.
- **The index answers about the CORPUS**, from a cache it refreshes by borrowing
  documents through the table.

So the index becomes what it always claimed to be — a cache over what the
documents would say (D52) — rather than a thing documents ask. Corpus-wide
questions go to the index; questions about one document go to the document; and
neither has to know the other exists.

### The repository manages the table, not only the files

`Repository` and `StreamHistory` write and read files that documents may be
holding, which today is safe by luck and sequencing. With one access path they
work through the table by construction:

- **a commit flushes every dirty document first**, because the table is what
  knows which those are;
- **a restore reloads the documents it rewrote**, because the table is what
  knows which are open — and a restore that left a stale document in memory
  would be a version that "took" and then got overwritten by a buffer.

`solution/parts/history-architecture.md` describes the tiers; what changes is that
their subject is the table's contents rather than a single stream.

## What each existing mechanism does about it

| Mechanism | What changes |
|---|---|
| **Undo** | Per document, as it already is. The Pane knows which document is current, so ⌘Z routes there — undo is a document operation, not an application one |
| **WAL** | Already per document: `walFile(docId)` takes an id and only ever got `'stream'` |
| **Write tiers** | Quiesce and ceiling stay global timers; the flush loops over dirty documents instead of one |
| **Versioning** | Unchanged. A commit is corpus-wide and scans for itself (D32) |
| **Divergence** | Unchanged. It is per segment, and a one-segment document is a segment |
| **Windows** | A file document's window is the whole file: no growth, both boundaries `end` |
| **Navigation** | `{kind: 'document', id, at?}` stops throwing; back and forward are already generic |
| **The renderer** | `RemoteDocument` stops hard-coding `'stream'` and is opened per id; the Pane holds the current one |

## The second window, which D10 already promised

> "Expanding shows its entries; **clicking an entry goes to it, in the current
> window or a new one.**" — D10

This is not a complication of the registry; it is the **argument for it**. Two
windows showing the same corpus need one authority over what a file contains, or
they are two caches of one fact — the failure this codebase keeps meeting, this
time with the user watching both copies at once.

Most of it already exists, because D37 split the document from its views for a
different reason and got this for free:

- **The service is per process, not per window.** It already broadcasts to a SET
  of sinks (`addSink`), which is exactly "every open window hears about it".
- **A window's view is a `DocumentWindow`**, and there have always been several
  of those over one document. Two BrowserWindows holding the same note is the
  same arrangement one window holding two regions already is.
- **Edits announce themselves** (D45), so a change typed in one window reaches
  the other by the path external edits already take.

What is genuinely new:

| | |
|---|---|
| **Creating one** | `createWindow()` runs once today. It becomes a function of a `NavTarget`: open the document, hand the renderer its starting location |
| **The gesture** | Click opens here; ⌘-click, and a context-menu item, open there. Both from the same row — the sidebar's one verb (D51) does not change, only where the verb lands |
| **Menu commands** | Already routed to `BrowserWindow.getFocusedWindow()`, so they follow the focus without change |
| **The lock** | Per notebook and per process (D32). Two windows in one process share it; nothing to do |

### A window has an identity, and it is not called `Window`

**`AppWindow`, with an `AppWindowId`.** The bare name is unavailable twice over:
`Window` is a DOM global (D35's reason for `DocumentWindow`), and `WindowId`
already means *a loaded region* in `ipc.ts`. A third meaning for the same word
in one codebase is how the coordinate bugs started; this one gets a name that
says which window it is.

**A window is NAMED for the document open in it**, which is what a title bar
wants and what a person would say out loud. The stream is `Notebook` — a special
file rather than a special case, which is the same move D8 made in calling the
stream a document. Two windows on one file disambiguate the way every editor
does, by suffix; the ID beneath is what code uses and never what a person sees.

### `ui-state.json` holds a SET of windows

```jsonc
{
  "theme": "…",                           // the machine's, not a window's
  "listView": "time", "searchWidth": 380, // ditto (D30, D41)
  "windows": [                            // order is not meaningful; the SET is
    { "id": "…", "document": "notebook.stream", "location": {…}, "cursor": {…} },
    { "id": "…", "document": "notes/titration.md", "cursor": {…} }
  ]
}
```

Restoring opens one window per entry, and a notebook with no state opens one on
the stream. **Order carries nothing** — it is a set, and pretending otherwise
would invent a stacking order nobody chose. R1.2 asked for "where I was" to
survive a quit and did not anticipate the plural; this is that requirement, said
for two windows.

The file stays machine-local and disposable (D32), so an older shape is not
migrated: it is ignored, and the app opens on the stream — which is what losing
this file has always cost.

### One struct per window, rather than globals per concept

The renderer reaches the app through `__view` and `__pane`. **Each window is its
own renderer process, so those are already per window** — what is missing is a
way to say WHICH window a harness means, and a place for a window to know its
own name.

So: one `__tephra` per renderer — `{ id, name, document, view, pane }` — and the
harness addresses a window by name rather than evaluating in whichever renderer
it happened to get. That also gives the title bar something to read.

### The File menu, which is where a person expects all of this

| Item | Key | What it does |
|---|---|---|
| **New** | ⌘N | A new empty document, in a new window |
| **Open…** | ⌘O | A file picker over the notebook, opening **in this window** |
| **Open in New Window…** | ⇧⌘O | The same picker, a new window |
| **Notebook** | ⌃⌘N | The stream: raises its window if one is open, opens one if not |
| **Close Window** | ⌘W | This window. The app stays running with none open, as macOS expects |
| **Print…** | ⌘P | Already there |

**The picker is scoped to the notebook.** A markdown file from anywhere else is
an import (R28, D47) — a different act with a different meaning, and offering it
here would blur the line the corpus depends on: what is in the notebook is
synced, versioned and searched, and what is not, is not.

**The rule holds across windows unchanged**: an open document answers for
itself, and there is one open document however many windows are looking at it.

## What is in this slice, and what is not

**In:** the registry, `FileDocument`, opening a note or fileset from the
sidebar, editing and undoing in it, the index and the fileset reader going
through the registry, and the pane's document target.

**Out, deliberately:** splits WITHIN a window (a second window is the answer to
"two things at once", and D10 says so), growth policy for file documents (there
is nothing to grow), and an eviction policy for open documents (a person opens a
handful; a corpus scan opens none, because scanning goes through `Segment` and
never through the registry).

**A second window is in**, because leaving it out would mean building the
gesture twice: the sidebar row that opens a document is the same row that would
open it elsewhere, and the choice is a modifier rather than a mechanism.

## Settled

- **A one-segment document's `SegmentKey` is a constant**, `'content'`. Nothing
  outside the stream has a meaningful second component, and a constant says that
  once rather than in every caller.

- **A document is open because a window points at it** — but that is a fact
  about WINDOWS, not the lifetime protocol. See the table below: the front end
  telling main when it closes something is advice, not bookkeeping, because
  advice that goes missing costs nothing and bookkeeping that goes missing
  leaks.

- **Every write goes through the document, and main acquires it.** A front end
  asking to pin does not write a file: it asks main, which gets the document —
  the one already open, or one it opens for the purpose — and edits it. Any
  other arrangement has two writers on one file, which is chaos with a delay
  fuse: it works until the day someone has the fileset open.

  Note the asymmetry this creates, deliberately: a window opening a document
  takes a reference; main opening one to service a write does not. The second is
  transient, and counting it would keep documents alive for having been written
  to once.

- **The editing surface is modular by kind.** A fileset opens as markdown to
  begin with, because it IS markdown and that is honest — but the front end
  should choose its surface from the document's kind rather than assume one, so
  that a fileset can later be edited as a list, and a PDF as neither. A registry
  of kind → surface in the renderer, with markdown as the default, costs almost
  nothing now and is the difference between adding a kind and rewriting the
  editor.

- **`New` writes `notes/untitled-N.md`** and renaming happens afterwards, the
  way it does in every editor. Asking for a name up front is one more decision
  before a person can type the thing they opened the app to type.

- **Closing the last window does not quit.** The app already runs with a write
  tier and a lock and no visible window — that state exists — and macOS expects
  the dock icon to bring it back.

## The `Corpus` — the file system, as X is allowed to see it

The structure this rests on is not really a table of open documents; it is **the
whole of the file system as the X layer meets it**. Everything W offers —
listing, reading, writing, creating, removing — reaches X through this one
object, as documents. That is what "X reaches a file only through a document"
means once it is taken seriously.

**Not called `Repository`.** That word already names the version store (D32,
D43), where `GitRepository` implements it, and a second meaning would be the
`Window` mistake repeated — three uses of one word is how the coordinate bugs
started. `Corpus` is the word the design documents have always used for the body
of text this app is about, and it is exactly what this object is a face for.

```ts
interface Corpus {
  /** The same document for the same id, for as long as the work runs. */
  use<T>(id: DocumentId, work: (doc: Document) => Promise<T>, how?: Borrow): Promise<T>

  /** What is there, without opening any of it. */
  list(kind?: DocumentKind): Promise<readonly DocumentId[]>
  exists(id: DocumentId): Promise<boolean>

  /** Making and unmaking, which are file operations and belong here. */
  create(id: DocumentId, kind: DocumentKind): Promise<DocumentId>
  rename(id: DocumentId, to: DocumentId): Promise<DocumentId>
  remove(id: DocumentId): Promise<void>
}
```

`Notebook` is then reachable only from here, which is the layering W/X was drawn
for and which has been quietly violated by every X object that took a `Notebook`
in its constructor.

### The borrow says what KIND of access it is

```ts
interface Borrow {
  /** `read` refuses edits, so nothing opened for a scan can dirty anything. */
  readonly mode?: 'read' | 'write'      // default: write
  /** Whether this opening should stay in the cache. */
  readonly retain?: boolean             // default: true
}
```

**This is the lesson storage systems learned about buffer caches**, and it is
the answer to the eviction problem rather than a refinement of it: a batch pass
and an interactive open want opposite things from a cache, and only the CALLER
knows which it is. The index sweeping seven thousand days is a batch pass —
`{ mode: 'read', retain: false }` — and it therefore cannot displace the two
documents a person has open, however large the corpus grows.

An interactive open is the default because the safe answer should be what you
get by not thinking; a scan is the one that has to say so.

**Two guarantees, and they are the whole contract:**

1. **Two callers asking for one id get the same object.** Not equal objects —
   the same one. Anything else is two authorities over one file, which is the
   failure this codebase keeps meeting.
2. **It stays valid for as long as the caller is using it.** Nothing releases a
   document out from under an operation in flight.

**A borrow, not a handle to keep.** The scoped form is the API because it cannot
leak: the borrow ends when the work does, whether the work returned or threw.
The alternative — the front end opening a handle per window and closing it later
— makes correctness depend on a message arriving, and **a close that is dropped
on its way to main is a document held forever.** With `use`, a lost message
costs nothing at all.

So main takes a borrow per operation and lets it go before it answers the IPC.
A window "having a document open" is then not a lease; it is a fact the table
may consult when deciding what to keep, and nothing more depends on it.

### What keeps a document alive, then

**The table does, and eviction is a policy it applies — never a consequence of
the last borrow ending.** A `Document` holds session state that no file holds:
the undo stack, the generation, unflushed edits, its place in the WAL. Dropping
it between two operations because nobody happened to be borrowing it would throw
all of that away, and would do it invisibly.

So the table keeps what it has opened, and may evict only what is **clean, not
pointed at by any window, and not holding history a window could still reach**.
Evicting nothing at all is a correct implementation, and the one to start with.

### The concurrency the contract actually needs

One process, one event loop — so "simultaneous callers" means async operations
interleaving at their await points, which is where this codebase has been bitten
before: **the segment cache once did check-then-act across an await**, two reads
of one day raced, and the fix was to cache the in-flight promise rather than the
result. `use` has exactly that shape and inherits exactly that bug if written
the obvious way, so it caches the OPENING, not only the opened.

Ordering is per document: two edits to one document must apply in the order they
were composed (D20), and edits to different documents have no relationship. A
single serial queue satisfies that conservatively and is what exists now; a
queue per document is the refinement, and only if the conservative one is ever
measurably in the way.

## What subclasses what, and the fork waiting at the end of it

`SegmentedDocument` holds everything that is *text with positions in it*: the
segment map, the edits, the history, the spans, the journal. A kind extends it
when that describes its content, and **implements `StoredDocument` directly when
it does not** — the base is a convenience, not a requirement, and the `Corpus`
deals in the interface.

| Likely kind | Why |
|---|---|
| **stream, markdown, fileset, todo** | text with positions; extend the base |
| **PDF, image** | positions are pages and rectangles; annotations are not character spans; nothing in the base applies |
| **a saved query or filtered view** | zero files. Content is computed from other documents and writes are written THROUGH to them; there is no `load` and nothing to `writeDirty` |

> **Correction (2026-09, ML3 and MS4): the query row was never reached, because a
> query did not become a document.** It became a *location* (the link directory)
> and a *panel* (search results), both drawing a stream of locations that the
> engine produces and neither pretending to be a file. So the hard part predicted
> here — writes written *through* to source documents — was never paid for, and
> D9's amendment descoped the only thing that would have needed it. **A row in
> this table can be avoided as well as met**, and this one was avoided by asking
> what the view is *for* rather than what it would have to be.

> **Correction (D55): todo was in the record-shaped row, and that was wrong.**
> It was predicted here as "an edit is a field, and history is per item," and M3
> deferred it partly on that basis. Designing it against the twenty-year record
> (`goal/todo.md`) says the opposite: an item is a line, tags and dates are
> inline markers left in the line, and nothing anyone actually does with a list
> asks when one item's status last flipped — the questions are about what the
> *list* looked like, so history is per **day**. It is `SegmentedDocument` keyed
> by `DateKey`, like the stream.
>
> **The general form is worth keeping**, because this file predicted four kinds
> and got the first one it met wrong: *a kind looks record-shaped when you
> enumerate the fields an item has, and text-shaped when you ask what the user
> does with it.* Enumerating fields is the easier exercise and the misleading
> one. Calendar is still in this row and has not had that test applied to it.

And the contrast that draws the line: **the shreddable notebook (D46) is not a
new kind.** Encrypted bytes and opaque names are a different STORAGE for the
same documents; only W changes. A different place to keep it is not a different
thing.

### The fork the first non-text kind forces

**`Document` is a text-document interface today.** `read()` returns a window of
prose, `spans()` returns character ranges, a position is an offset. A PDF cannot
satisfy it, so the first non-text kind splits it in two: a lifecycle contract —
identity, dirtiness, flush, events, undo in the abstract — and a text contract
standing on it. Worth knowing in advance rather than discovering it while
writing a PDF reader.

## Still open

- **What the fileset's editing surface eventually IS**, if not markdown. Worth
  living with the markdown one first: it is the only version we can judge
  against, and a list editor that nobody wanted is more expensive than a
  markdown file that was slightly awkward.
