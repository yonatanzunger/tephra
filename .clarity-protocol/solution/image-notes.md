# R7 — images into the corpus

**Requirement: R7. Scheduled with M4** by the calendar rather than by kinship:
it shares nothing with search.

**What a picture costs is a file and a link**, and that is the whole design. The
bytes go to `attachments/YYYY/MM/`, named for the day they arrived, the picture
they are, and their own hash; a relative markdown link goes in at the caret.

## Three doors, one act

**Paste, drop, and `Image…`** — and the first two are handled in the editor
because that is where the caret is. **The bytes come with the event**: a paste
and a drop both carry the file, so asking main to read the clipboard again would
be a second answer to a question already answered, and a worse one — a drop is
not on the clipboard at all.

`Image…` had sat in the File menu as `built: false` since MC6 with a note saying
it was R7 and scheduled here. That promise is kept; it is the door for a picture
you have to go and find.

## The split: main writes, the surface inserts

**Main writes the file and answers with a relative link. Nothing is inserted by
it.** The surface with the caret puts that link in through the ordinary edit
path — so undo undoes it, the journal records it, and nothing about a picture
needs to know which kind of document it landed in. `importText` predates that
idea and reaches into the stream to place a block; an image should not have to.

**The write is in the floor** (`x/documents/attachments.ts`), and the layering
test is what insisted. An attachment is *not a document* — nothing opens it,
edits it or merges it — so the rule that every document write goes through its
document has nothing to say about it; but the rule underneath, that writing files
is the floor's job, still does.

**Filed under the day it arrived, whatever it was pasted into.** A picture in a
note has no date of its own, and the day it turned up is the only honest one —
which is also what keeps `attachments/YYYY/MM/` browsable in a file manager.

**The hash is both the deduplication and the collision guard.** The same
screenshot pasted twice writes the same path with the same bytes, which is a
no-op rather than a second copy; two different pictures cannot land on one name
unless they are the same picture.

## Found on the way: inline images had never once worked

**`features.md` has listed *inline image rendering* as v1 since it was written,
and the widget has drawn an `<img>` for just as long — pointing at nothing.** The
renderer is served from `tephra://app`, so a relative src resolved against the
*bundle*; there was no route to the notebook at all. Every inline image in the
app was a broken one, and a pasted picture appeared as a grey dot.

**The fix is a second host, not a second scheme**, because a scheme gets one
handler: `app` is the bundle and `notebook` is the corpus, read-only and behind
`resolveWithinRoot` — the same guard the bundle is served behind, for a directory
holding a great deal more that is private.

**And the renderer has to know where a relative link resolves from**, which is
layout knowledge (D59): how deep a day file sits is `w/layout.ts`'s to answer. So
`linkBase` is fetched from main **once per document** rather than once per
picture, because a widget draws synchronously and cannot wait for a round trip.
Any day of the stream will do, which is not a coincidence — every day file sits
at the same depth, the same fact printing already relies on (Spike B).

**`imageSrc` moved to `shared/scheme.ts` to be testable at all.** `widgets.ts`
uses TypeScript parameter properties, which node's strip-only stripping cannot
parse, so nothing in that file can be imported by the test runner — and a pure
function deciding where every picture in the app points should not be untestable
because of the shape of a class beside it. The scheme's names went with it: three
sides speak them, and the renderer had been writing the string out again.

## What the acceptance pins

`npm run m4`'s `image` scene drives a **real paste** at the editor's own DOM, so
what is tested is the handler and not a function the harness called. Then: the
link landed in the day, a file was written beside it, the name carries the day
and the picture and its bytes, **the bytes are a PNG byte for byte**, the day
file on disk says so, the line being edited still shows its markup (D16), it
draws as a figure once the caret leaves, the src points at the corpus — and
**the picture actually loaded**, which is the claim `drawn` could not make.
