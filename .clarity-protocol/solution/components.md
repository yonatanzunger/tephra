# Components and sequencing

The decomposition of the build, and the order. Read with `goal/scope.md`, which supplies the counting rule and the deferral rule this ordering rests on.

## Components

1. **Format** — markdown plus extensions; how dates, subjects, bookmarks and TODO fields are represented in plain text.
2. **Editing surface** — vim mode, raw/rendered switching, inline widgets (Q1).
3. **Visual system** — typography, colour, spacing (R1.3). Reference is the Clarity app's styling.
4. **Storage and sync** — offline operation, two devices, reconciliation (Q2).
5. **Retrieval** — search, subject views, bookmarks.
6. **Range operations** — select, then tag / branch / print / bookmark.
7. **Structured lists** — TODO with urgency ranking; pinned lists.
8. **Filesets** — collections, snapshotting, browser extension.
9. **Mobile** — possibly a separate stack entirely (Q5).
10. **OS integration** — printing, paste, open-with, drag-and-drop.

Two are expensive to change later and everything else is comparatively cheap to reorder: **the format**, because it is the durable contract, the thing both platforms share, and what any merge must operate on; and **the editing surface plus visual system**, because they decide whether the thing gets used at all.

## Sequencing

**v1 — single-device Mac, the stream, excellent editing.** No sync layer, no mobile, no TODO or fileset UX. Synced by hand if at all. This is already the default place the writing happens, and it starts accumulating the corpus that makes everything downstream testable rather than theoretical.

**v2 — sync, then Android.** The purpose is road miles on the problem the project exists for: doing this from many places.

**v3 — promote what earned it.** TODO, filesets, and the rest, admitted against recorded failures of their plain-file stand-ins.

## What each stage must prove, and the constraints that carry backwards

**v1's UX is the stream, not a file list.** "N markdown files" describes storage; R6 asks for one continuous chronological stream. A folder-of-notes navigator is a different product and leaves the central bet untested.

## The notebook is one document

**The app exposes a single logical document.** Conceptually the notebook is one enormous markdown file; the split into day files exists only because very large files become unwieldy. Everything above the storage layer — editor, search, range operations, addressing — sees one continuous stream.

Two things make this more than an abstraction boundary, and both are format decisions rather than storage tuning:

- **The split rule must be deterministic and content-derived, because it is visible to merge.** Reconciliation operates on files. If devices split at different points — anything size- or runtime-derived — the same content lands in differently-shaped files and produces spurious divergence. Splitting **by date** is deterministic, identical on every device, and it is what makes append-union merge valid in the first place, since a day file is append-only where an arbitrary chunk is not. So day files are not merely a workaround for file size; they are the only split rule stable under concurrent editing.
- **The logical document is lazy and windowed, not loaded whole — and this is required in v1** (D23). Measured writing volume is 2–3.5 MB a month, 20–45 MB a year, and 0.4–0.9 GB over twenty years; a single month already exceeds the largest corpus the editor has been tested against. Windowing is required even if storage were a single file, so the abstraction has three jobs: manage the window, write back per region, and address positions in a form that survives edits elsewhere. **Positions are `(date, offset)`** — an absolute offset into the stream would shift on any edit anywhere and needs a global character-length index that `stat` cannot supply.

**Construction order: the Document API (`document-api.md`, D18), then the format spec, then this.** The API defines what facts the format must be able to carry; the windowed surface implements what the API promises.

**This is v1's first construction task, not a spike.** It was briefly in the spike plan and removed: nothing in it is empirically uncertain, and the one unknown quantity — whether the editor stays fast at that document size — is measured by Spike A. It should follow the spike rather than run beside it, since a poor latency result would change the window size and therefore the design. Its acceptance criteria, which are worth fixing now: no visible seam at a file boundary; saving touches only the files actually edited; an edit spanning a boundary written correctly to both sides; position restored on reload and still correct after content is appended to an earlier file.

## Retrieval: one filtered-view mechanism, three query shapes

Subject views, date-range views and search results are one view type over one query mechanism — that is a deletion at the layer where the scope number lives.

**The source of truth is always in the files.** Tags are markup in the markdown; bookmarks are inline anchors; dates come from the day structure. Any index is **derived, machine-local, never synced, and disposable** — rebuildable from scratch at any time. An index inside the synced directory would be a second source of truth, a merge problem, and a thing that goes stale whenever a file is hand-edited, which the design assumes will happen.

**In v1 there is no index.** Enumerate by scan; the corpus is small and a scan is instant. It stops being instant around 50 MB, which at measured writing volume is year two — so **the index is a v2 item** (D23).

**Search is staged.** v1 is literal substring matching — the browser's find, over the corpus rather than the page. Ranking, stemming and structure come later, deliberately, as their own piece of work.

**v1 makes two format decisions it cannot revisit**: where the date lives (filename or frontmatter — not mtime, which does not survive sync, copy or git), and the subject-tag syntax, which v1 fixes implicitly whether or not v1 has tagging. Search is nearly free over a directory of markdown and fixes Era 1's failure, so it belongs in v1 too.

**v2 bundles two new risks and should unbundle them.** Sync and a second platform are both new and both risky; if v2 feels bad it will not be obvious which one is wrong. Sync must come first regardless, since the phone needs a corpus for any judgement about it to mean anything — so the only question is whether to live on sync alone for some weeks before starting Android. Doing so means the phone lands on a substrate already trusted.

**The uncomfortable part of this ordering is that mobile — the requirement the project exists for — lands late.** That is survivable because Era 2 worked excellently for years without it; the access failure came from a change in circumstances, not from day one. But it is the place this sequencing could be badly wrong, and it deserves re-examination rather than a shrug. The specific risk to watch: **v1's editor choice may not port to Android, and that only becomes visible in v2.** The v1 stack decision should therefore be made with an explicit answer to "does this editing surface exist on Android, and if not, am I willing to build it twice?" — which the requirements permit, but only deliberately.

**Deferral is safe only where what is deferred is a mechanism over data already being recorded.** See `goal/scope.md`.
