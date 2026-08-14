# Decisions

## D1: This is not built as an extension to an existing editor

**Date:** 2026-08-12
**Status:** decided
**Resolves:** Q4, option 4

**Decision.** The project will not be built as a VSCode (or other editor) extension, in the manner of Foam or Dendron. The remaining Q4 candidates are the three that ship an application: fully native, native shell with a web view for the editor surface, and full web shell.

**Why.** The option was attractive on paper — vim mode, typing performance, file handling and printing all free — and it is close to the current working setup. It dies on **mobile**, and on measured rather than suspected grounds: the user has been running this exact arrangement as a stopgap, and reports that the total absence of mobile access "has been a huge practical blocker in every VSCode-based project I've done lately." That is Era 2's failure mode reproduced deliberately: a system that works well and is in the wrong place. Availability wherever thinking happens (R24) is the requirement the entire project exists to satisfy, and no amount of desktop quality buys it back. The secondary cost — R1.5, "the UX is the user's own" — would have been arguable on its own; the mobile gap is not.

**What the option leaves behind, which is more valuable than the option was.** Running VSCode-with-vim-plugins as a stopgap produced firsthand evidence that survives the decision:

- **The typing experience is pleasant at 130 WPM.** VSCode is Electron. R1.1 (latency), R1.4 (vim) and R1.3 (rendering quality) are therefore *jointly satisfiable in a web-based stack* — an existence proof, not an argument. This raises the prior on Q4 candidates 2 and 3 considerably.
- **The visual experience became good only after the user wrote custom themes for it.** This is evidence about *capability*, not about *content*: web tech goes where this user's eye wants it to go, and the gap between stock and excellent is theme-sized rather than platform-sized. It is **not** a specification of how this app should look — those themes were designed for reading and editing *code*, which is a different visual problem from long-form prose. **The visual reference for this project is the Clarity app's styling instead.**

**Consequences.**
- Q4 narrows to three candidates, all of which ship an application on both platforms.
- The Tauri finding (OS integration is painful) is now the *only* remaining negative evidence in Q4, and it is about Tauri's OS bridge specifically, not about web rendering. The prototype must therefore aim squarely at the OS-integration boundary — printing and image paste — rather than at rendering quality, which is no longer in doubt.
- The bar for R1.3 is set by feel against a known reference, not by a written spec — which makes it a *prototype* criterion the user judges instantly rather than something to specify in advance.

**What would reopen this.** Only the mobile requirement being dropped, which would mean abandoning the fix for Era 2's failure. Effectively: nothing.

## D2: The project is named Tephra

**Date:** 2026-08-12
**Status:** decided

**Decision.** The project is **Tephra**. The directory and git repository are renamed accordingly; "notebook" is retired.

**Why.** Tephra is the fragmentary material deposited by an eruption, and tephrochronology is the practice of dating strata *by their ash layers* — a continuous accumulation of deposited fragments, readable in order, datable by where each one sits. That is the data model exactly. It is also short, unclaimed, and types quickly, which matters for something that will be a command and a directory for twenty years.

**The rejected favourite carries the more important reasoning.** *Paredra* — one who sits beside — was the initial preference and was rejected for a reason that generalizes well past naming: **it risks anthropomorphizing the thing, and this is a tool, not a companion.** In the user's words, "I have a paredra, I'm married to her." That principle is now a constraint on the whole design surface — interface copy, any assistive or generative feature, error messages, and anything that might otherwise acquire a persona. Tephra is a substance, which is the correct register.

## D3: Three native types over one directory; everything else is external or embedded

**Date:** 2026-08-12
**Status:** decided
**Detail:** `goal/scope.md`

**Decision.** Tephra has three native file types — **markdown**, **TODO**, and **fileset** — each with its own UX. Every other file in the directory is either *external* (PDFs and similar, handed to the OS) or *embedded* (images referenced from markdown and rendered inline). Type is **declared by name, never inferred from context**.

**Why.** This is the concrete form of "smaller than a high-powered notebook app": the scope number is the count of *view types*, and it is countable. It also arrives by deletion rather than by decree — the events calendar dissolved into a pinned markdown file, and pinned lists, branched documents and the notebook stream are all one type. Explicit typing is a correctness requirement rather than tidiness: Portal found that a mutable list mistyped as append-only notebook content merges with append-union semantics and *silently duplicates edited lines*, with no error raised.

**Since resolved.** Three types do not mean three syntaxes — see D6. The subject view is not a fourth type but one instance of a single filtered-view mechanism — see D9. Pinning is not a type either — see D10. The count holds at three.

**Still open inside this decision.** Whether a filtered view is *editable*. Read-only it folds into the markdown UX; editable it is a composite surface writing back into source ranges, which is the most demanding thing in the design.

## D4: Sequencing is v1 stream / v2 sync then mobile / v3 promotion

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/components.md`

**Decision.** **v1** is a single-device Mac app over one directory of markdown files, presenting the notebook as one continuous stream with an excellent editing experience — no sync layer, no mobile, no TODO or fileset UX. **v2** adds sync, then Android, in that order and preferably with time living on sync alone in between. **v3** promotes the remaining features.

**Why.** Format and editing surface are the two things expensive to change later; everything else is comparatively cheap to reorder. v1 starts the corpus, which is what makes retrieval, urgency ranking and the forced-review question testable rather than theoretical. Storage comes off the critical path because explicit resync is already acceptable (R25) and manual sync is merely *more* explicit.

**The amendments that make it safe.**
- **v1's UX is the stream, not a file list.** Otherwise the central bet — one stream plus filtering, rather than N notebooks — is left untested.
- **v1 fixes two things it cannot revisit:** where the date lives (filename or frontmatter; mtime does not survive sync, copy or git) and the subject-tag syntax, which v1 decides implicitly regardless. **Refined by D18:** what cannot be revisited is the format's *coverage*, not its syntax — and the deadline for settling it is v2, not v1.
- **v2 unbundles its two risks.** Sync and a new platform are both new; sync must come first anyway, since the phone needs a corpus for judging it to mean anything.
- **v3 is promotion, not a backlog.** v1 deliberately runs the plain-file TODO and fileset so that promotion answers a recorded failure.

**The known weakness.** Mobile — the requirement the project exists for — lands late. Era 2 worked excellently for years without it, which makes this survivable, but the specific risk is that **v1's editor choice may not port to Android and that only becomes visible in v2.** The v1 stack decision must be made with an explicit answer to whether the editing surface exists on Android, and whether building it twice is acceptable.

## D5: Storage is a local replica over a network source of truth, syncing continuously

**Date:** 2026-08-12
**Status:** decided

**Decision.** Each device holds real, user-visible directories of plain files, backed by a single source of truth in reliable network storage. **Text is a replica, not a cache** — written back, never discarded or refilled from truth, because between writing offline and pushing it is the only copy. **Attachments are a genuine cache** — evictable and refetchable, which is what lets a phone hold the whole corpus of thinking without holding the whole corpus of material.

**The steady state is continuous and invisible** (carried from Portal): local edits autosave and propagate to the remote as soon as possible, asynchronously, never interrupting the user. During a disconnect they accumulate locally and go up at the first opportunity. **R25's "explicit resync is acceptable" describes the degraded mode, not the normal one** — the ceremony is permitted on reconnection, not as the everyday experience.

**What it decides and what it does not.** This is a **topology** decision — a star with a hub — and it eliminates peer-to-peer and local-network-only sync. It buys a canonical history, a backup for free, and a phone that syncs without the Mac being awake. It does **not** answer Q2's real fork, plain files as source of truth versus a CRDT; that stays open.

**Consequences to carry.**
- The hub must keep working for twenty years and it holds other people's information, which bears on where it lives.
- Local directories live at a stable, visible path rather than an opaque store inside an application support directory. That is what makes the exit structural rather than aspirational.
- Sync is off the typing critical path entirely, per R1.2.
- **Continuous propagation means many small writes per device per day, so reconciliation must be both side-independent and arity-independent.** This is the constraint that invalidated Portal's original commit-time ordering rule (D33): it assumed one commit per side, which autosave makes false. Any ordering rule adopted here must not reacquire that assumption.
- On mobile, continuous propagation is subject to battery and metered-connection discipline — batch on quiescence.

## D6: One syntax family for v1 and v2; a bespoke TODO syntax may be adopted at promotion

**Date:** 2026-08-12
**Status:** decided

**Decision.** All three native types (D3) are markdown, leniently parsed. When the TODO type is promoted to its own UX, adopting a bespoke syntax — YAML is the likely candidate — is reopened *then*, with the UX's real requirements known.

**Why the deferral is safe.** Converting a markdown TODO to YAML is a script, so no data is stranded. Until promotion there is one parser and one merge story, the exit stays structural, and the hand-maintained markdown TODO of v1 and v2 is directly readable by whatever v3 builds.

**One pleasing consequence.** The v1 TODO carries no last-touched timestamps, since nobody hand-writes those — so at promotion every item would import as equally fresh, which is the failure R15 exists to prevent. But the import *is* a transcription: each item is either carried forward or dropped. **That makes the migration the first instance of the forced review** Q3 is looking for, rather than a defect in it.

## D7: Source of truth lives in the files; every index is derived and machine-local

**Date:** 2026-08-12
**Status:** decided

**Decision.** Tags, bookmarks and dates are represented in the markdown itself. Any index over them is **derived, machine-local, never synced, and disposable** — rebuildable from scratch at any time and never authoritative. **In v1 there is no index at all**; enumeration is by scan.

**Why.** An index inside the synced directory is a second source of truth: it becomes a merge problem, it diverges between devices, and it goes stale whenever a file is hand-edited — which this design assumes will happen (hand-editing is a feature). Portal reached the same conclusion twice independently, refusing an index for FileSet search and for bookmarks, and settling on "enumerate by scan in v1."

**Consequences.** Bookmarks referenced from a fileset are referenced **by name and resolved by lookup**, never by file-and-offset, which rots the moment text moves. A reference to a bookmark that no longer exists must dangle **visibly**, not silently.

## D8: The notebook is one logical document; storage splits it by date

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/components.md`

**Decision.** The app exposes the notebook as a single continuous document. The split into day files is below that boundary — but the **split rule is a format decision, fixed at date boundaries**, not a storage-tuning knob.

**Why the split rule cannot be a free implementation detail.** Reconciliation operates on files. Devices that split at different points — anything size- or runtime-derived — put the same content into differently-shaped files and manufacture divergence. Date boundaries are deterministic and identical everywhere, and a day file is append-only where an arbitrary chunk is not, which is precisely what licenses append-union merge. Day files are therefore not merely a workaround for unwieldy file sizes.

**Consequences.** The logical document is **lazy and windowed** — tens of megabytes of prose will not load joyfully at 130 WPM, so windowing is required regardless of how storage is arranged. It must supply addresses **stable across window moves and across merges**; byte offsets into a logical concatenation are not, since an upstream insertion from another device shifts everything after it. Bookmarks already avoid this as inline anchors; scroll and cursor restore (R1.2) need equivalent treatment, most likely date-plus-offset.

## D9: Dates and tags unify at the query layer, not in the data model

**Date:** 2026-08-12
**Status:** decided

**Decision.** A date is **not** a tag. Dates remain a distinguished axis: total, automatic, ordered, immutable, and layout-determining. Tags remain a partial, manual, unordered, mutable, freely-overlapping relation. **What unifies is the query and the view**: subject views, date-range views and search results are one filtered-view mechanism, and a query may mention dates and tags together ("everything tagged *house deal* since March").

**Why not further.** The two are alike only in query surface. Every character has exactly one date and most text has no tags, so a date is a *function of position* and a tag is a *relation*. Dates support range queries and ordering; tags support set membership. Dates determine the storage split (D8) and tags cannot, since they overlap freely — which is the very property that made subjects-as-tags beat notebooks-as-containers. Dates are system-assigned and immutable; retagging is a core gesture (R12) while re-dating is corruption. Unifying them would not delete a concept, it would rename one and append a footnote listing five exceptions — which is exactly the point at which a generalization stops paying.

**Where the unification does pay, it is taken fully.** One filtered-view UX instead of three is a deletion at the layer where the scope number lives (`goal/scope.md`), and at the index level a date is simply an attribute with an ordered comparator, so the mechanism is shared even though the model is not.

## D10: Navigation is a list of sections; the default section is the pins

**Date:** 2026-08-12
**Status:** decided

**Decision.** The left nav is a list of **sections**, each an expando, each one a fileset. Expanding shows its entries; clicking an entry goes to it, in the current window or a new one. An entry is one of four things: a **bookmark** (jump to a place in a file), a **file** (jump to its start), a **URL** (open in the browser), or a **document Tephra does not handle**, such as a PDF (open by OS intent). **The default section always exists** and holds the pinned items at the top.

**Why this beats "pinning is a property."** Both were on the table. Membership in a distinguished fileset wins on two counts. It is **one file to read** rather than a flag scattered across the corpus that must be discovered by scan — and it therefore has an **explicit order**, which a scan-derived pin list does not, and which a navigation panel needs. The earlier objection that the events calendar is a table rather than a collection of pointers dissolves: the calendar is a *file entry within* a section, not a section.

**Consequence for sequencing.** Filesets acquire the **navigation** role from v1, well ahead of the document-collection experience (R20–R23). The v1 obligation is the index format plus rendering it as a nav section; summaries, snapshotting, en-masse opening and the browser extension stay deferred. One type, two jobs, arriving at different times.

## D11: References are by identity, never by position

**Date:** 2026-08-12
**Status:** decided

**Decision.** Nothing durable is addressed by byte offset or line number. Bookmarks are inline anchors that travel with the text; tags are inline markup delimiting the range they apply to; section entries reference bookmarks by name and resolve by lookup; links are ordinary markdown links.

**Why it keeps paying.** Three separate requirements had already forced this answer independently — Portal killed a bookmark side-index because it breaks whenever a range moves, D7 killed synced indexes because they go stale under hand-editing, and overlapping tags cannot be expressed positionally at all without a second structure. When three constraints select the same survivor, it is a principle rather than a preference.

**The one permitted exception is soft state.** Scroll and cursor restore (R1.2) have no anchor to attach to, since they land wherever the reader stopped. An offset within a day file is acceptable *there* precisely because being wrong is cheap and self-correcting — the reader lands slightly off and scrolls. The rule: positional addressing only where a wrong answer costs nothing.

**What identity-based addressing does not buy.** A bookmark is addressed by **(file, anchor name)**, not by name alone — anchor names cannot be globally unique across twenty years without either enforcement friction on a gesture that must stay cheap, or collisions. So references still need maintenance when the *containing file* changes, which happens on exactly one operation: branching (D13). The win is therefore narrower than "references never break," and it is still the win that matters: **anchors survive text moving within a file for free** — the ordinary case, triggered by every act of typing above a bookmark — and the residual fragility is confined to a rare, explicit, user-initiated action.

**Maintenance policy is chosen by cardinality, not by uniform rule.**
- **Few referrers that must resolve instantly — the sections (D10) — are updated on write.** The set of filesets is small and finite, so a branch operation scans and rewrites them. Cheap, bounded, deterministic.
- **Many referrers that tolerate ambiguity — ordinary markdown links in the corpus — resolve on read.** A link that names an anchor is resolved by scan at follow time; a collision or a move surfaces a picker over candidates rather than a hard break. This reuses Portal's D52 finding, that viewing and choosing are independent and a picker needs no default.

**Ordering within the branch operation follows the same discipline as Portal's cross-repository move: create, then update references, then delete from the source.** Never the reverse. The worst case is then duplicated content — visible and fixable — rather than lost content or dangling references.

## D12: Concurrent multi-device editing is not an expected workflow

**Date:** 2026-08-12
**Status:** decided

**Decision.** Moving between devices without an intervening sync is not an expected pattern. Concurrent divergence must therefore be **correct, visible and recoverable — not seamless.** It is a case to handle honestly, not one to optimize.

**What it deletes.** Portal's hash-based ordering rule for append-union (D51) existed to guarantee that two devices computing the same merge independently converge. With concurrent editing out of the expected path, that convergence argument does not arise, and the rule can go. Most of the merge ladder goes with it: the normal case is a fast-forward.

**What it does not delete, and this is the honest part.** The failure mode remains, it is merely rare — and "close the laptop before the push completes, then write on the phone" is a daily action whose sync state is invisible. So the requirement is a divergence that is **surfaced with a picker** rather than resolved silently, which R25 already permits as reconnection ceremony. Writes must also be atomic (write-temp-then-rename), because autosave makes interrupted writes the ordinary single-device risk — and that is the same mechanism that silently kills file-descriptor-based watchers, so directories are watched, never descriptors.

**It probably resolves Q2.** A CRDT's entire value proposition is conflict-free concurrent editing. If concurrent editing is rare and ceremony on reconnection is acceptable, that benefit is small while the cost is large — files become an export and R26 weakens. **Plain files as source of truth is the strongly indicated answer.** Recorded here as the argument; Q2 stays formally open pending confirmation.

## D13: Branching a range into its own file is v1; finding it independently is v2

**Date:** 2026-08-12
**Status:** decided

**Decision.** The branch operation — take a selection, make it its own file, leave a link behind — ships in **v1**. The *independent findability* half of R14 (locating a branched file without going through its origin) waits for v2, along with tags and search.

**Why it moves up.** It scores on two of the three v1 admission tests: it is part of the editing experience, and it removes an ambient anxiety about ever needing to restructure — which is exactly the kind of friction that decides whether the tool becomes the place writing actually happens.

**Three consequences.**

- **The stream is no longer append-only.** A branch performs an interior deletion, and it can do so in a day file from months ago, so **no day file is ever final**. Portal's append-union merge degrades gracefully here by design — its prefix test fails and reconciliation falls to ordinary textual merge — and under D12 that path is rare anyway. But any later optimization that assumes historical immutability is now invalid, which is cheap to know and expensive to discover.
- **Bookmark maintenance is small but not free.** A bookmark is addressed by *(file, anchor name)*, since anchor names cannot be globally unique over twenty years — so moving a range to a new file does require updating references. The set of sections is finite and quick to scan, so a branch rewrites them directly; ordinary in-text markdown links resolve on read instead and surface a picker rather than breaking (D11). Portal's hardest sub-problem here — images travelling with the range, cross-repository copy-verify-delete — evaporates entirely, since Tephra is one directory rather than per-project bundles. That is the second requirement this structural choice has deleted rather than solved.
- **A branched file leaves the dated stream and therefore loses its date.** Dates come from the day-file structure (D8), and a branched file is not a day file — so it must record its **origin date in frontmatter** at branch time, or it becomes an undated object in a system organized by date. This is a format decision and therefore lands in v1 regardless of anything else.

**One thing this makes load-bearing.** With independent findability deferred, **the link left behind in the stream is v1's entire findability mechanism** for branched content. It is not a courtesy note; it is the only path back, and it should be built as a real, followable link.

## D14: Explicit W / X / Z layering, with Document and FilesetCollection as the core objects

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/architecture.md`

**Decision.** The code is explicitly layered. **W** is infrastructure — files, directory watching, atomic replacement, OS services, and later the network hub. **X** is the logical objects of the domain, exposing conceptual operations and translating them into W's language. **Z** is the features and UI, consuming X. The core X objects are **Document** (one logical markdown document, whose storage implementation handles day-file segmentation) and **FilesetCollection** (the set of filesets, which can update a reference globally across them), alongside Corpus, Fileset, Query and Range.

**Why it is not merely a style preference here.** The most alarming finding Portal produced was a layering violation: a widget that opened its file during view construction re-read constantly and lost edit state on reparenting — R1.2, *no state is ever at risk*, failing at the framework level rather than in application logic. Separating model construction from view construction is the same rule as Z never reaching into W.

**Two things this makes true that were previously only descriptions.** "The notebook is one document" (D8) becomes real in code, since Document is one interface with two storage implementations — segmented for the stream, single-file for branched documents and pinned lists. And "update references on branch" (D11, D13) has an owner, since FilesetCollection is the only object that can see all filesets at once.

**Search is an X-level component, not a W-level scan.** An earlier draft allowed the Corpus to grep the directory directly, as a performance shortcut. That was wrong on four counts: W does not know which file holds a given part of the notebook, so its results cannot be expressed as positions in the logical document; W does not know the format, so a raw scan matches frontmatter and markup as prose; a W-level hit is a file and an offset, the address D11 forbids; and unsaved edits live in X's buffer, so a disk scan cannot find the paragraph just typed. The v1 implementation reads through the Document API; a later one maintains an index fed by **Document's change events**, with Document staying ignorant of its consumers.

**The six rules that keep it honest** are in `solution/architecture.md`. The one that would otherwise be discovered painfully: **the layering is strict for operations and persistence, and deliberately loose for reading live state.** R1.1 is a hard latency requirement, and an editing surface routing every keystroke through Z→X→W cannot meet it — the live buffer is held in memory and rendered from directly, while X persists asynchronously. A naively strict version of this architecture would violate the project's primary requirement.

## D15: Vim mode is a switchable feature, not the fixed editing model

**Date:** 2026-08-12
**Status:** decided
**Detail:** `goal/discovery/spike-01-findings.md`

**Decision.** The vim keymap is a setting the user can turn off, and the editing surface must remain fully usable without it. R1.4 stands — vim is the default and the reason the surface was chosen — but it is no longer load-bearing for the surface being pleasant.

**Why — two independent reasons, and the second is the stronger one.**

**Mobile cannot use vim at all.** Spike A′ confirmed it on the phone: a modal keymap over a soft keyboard is not merely worse, it is unusable. R1.4 already said vim is desktop-only by nature, but that was a statement about where vim is *wanted*; this is a statement about where it can *function*. Since desktop and mobile run the same editing surface wherever they can (Q4), the surface must work without vim as a first-class mode rather than a degraded one.

**And on the desktop it has a cost that resists naming.** Spike A produced an unexpected result: typing is measurably fine either way, and yet **it feels less fluid with vim on**. The difference survived every attempt to name it. Keystroke-to-paint is identical (p50 4.2–12.5 ms with vim, 4.4–12.7 ms without), both modes take the browser's native `beforeinput` insertion path with nothing default-prevented, and the seven other candidate causes — line wrapping, markdown parsing, syntax colouring, match highlighting, bracket matching, font smoothing, position within a long wrapped paragraph — were each measured and cleared. The effect is real to the user and below the resolution of the instruments.

**Why this is a resolution rather than a deferral.** The trigger for the whole project is that the tool must be a joy to type in, and "there is something slightly off that I cannot name" is exactly the kind of friction that decides whether writing actually happens here. A switch converts it into a preference, which is the honest answer when the cause is unnamed. It is also nearly free: the vim layer already lives in a single CodeMirror compartment, so toggling it is a reconfigure rather than a rebuild.

**One lead left on the table.** CodeMirror's drawn cursor costs about 1 ms against the browser's native caret, and vim requires the drawn one for its normal-mode block cursor. If the feeling is ever worth chasing, that is where to start — and it would also mean the vim-off path can use the native caret and be *better* than vim-on rather than merely equal.

**What would reopen this.** Nothing; the mobile half alone settles it, and a switch forecloses nothing. The question it leaves open is whether the non-vim mode deserves its own keymap design rather than inheriting CodeMirror's defaults — which now matters more than it looked, since that mode is what the phone always runs.

## D16: The editing surface is CodeMirror 6, with widgets that unrender under the cursor

**Date:** 2026-08-12
**Status:** decided
**Resolves:** Q1
**Detail:** `goal/discovery/spike-01-findings.md`

**Decision.** One surface — CodeMirror 6 — carries both raw markdown edited with vim and inline rendering of equations, images and tables. Mode switching is a decoration toggle, not a second editor.

**Why.** Spike A confirmed it against a 1.05 MB corpus of real prose on desktop and Android. The editor's own cost is 0.4 ms per keystroke at p99, flat across document size, widget count and typing speed, with no queueing at 600 WPM. Every vim operation over every widget type behaves correctly and undo restores byte-for-byte.

**Three constraints came with the answer, and none of them was a choice.**

- **Block widgets cannot come from a view plugin** — CodeMirror refuses. Inline widgets are rebuilt per viewport in a `ViewPlugin`; tables, display equations and figures live in a whole-document `StateField` that maps through changes and rescans only the edited block. A state field cannot see the viewport, so anything that rescans the corpus per keystroke is wrong by construction.
- **Rendered constructs must unrender under the cursor.** `@replit/codemirror-vim` does its own offset arithmetic and never consults `atomicRanges`, so nothing can tell it a widget is one unit. Left rendered, the cursor freezes at the widget's edge while vim walks the hidden source underneath.
- **Block widgets must also unrender from a neighbouring line.** Replacing whole lines removes them from the visual layout, so `j` and `k` skip them entirely — unreachable means uneditable.

**What it does not decide.** Rendered *editing* per node type still stages as Q1 described: inline constructs first, tables and equations last.

**What would reopen this.** A vim implementation that respects atomic ranges would relax the second constraint, not the decision.

## D17: The app ships as an Electron shell

**Date:** 2026-08-12
**Status:** decided
**Resolves:** Q4
**Detail:** `goal/discovery/spike-01-findings.md`

**Decision.** Tephra is candidate 3 — a full web shell, Electron specifically. The desktop and mobile builds share the editing surface; the contract between them remains the file format.

**Why the question's premise dissolved.** Q4 existed because OS integration looked expensive. Spike B built printing-a-range and pasting-an-image twice, and both are a paragraph of shell code in either shell — 71 and 21 lines in Swift, 23 and 10 in Electron. **The Tauri finding was about Tauri**, and the cost that made this question hard is not there.

**Why Electron rather than the native shell, once cost stopped deciding.** Typing felt better in Electron — the same subtle, unnameable difference as vim against non-vim, and more acute. **On macOS this is not separable from the shell:** a native shell gets WKWebView, Electron is Chromium, and no third arrangement is affordable here. So the difference cannot be fixed inside the Swift arm at any price. Meanwhile the one thing the Swift shell did better — a print panel showing a preview of the document — closes in eleven lines in Electron by rendering to PDF and showing it in Chromium's own viewer, which brings thumbnails, zoom and a print button with it.

**The asymmetry is the argument.** The gap that cannot be closed sits on R1.1, the requirement the project exists for. The gap that closes cheaply sits on R11, which is occasional.

**Consequences to carry.**
- **The app serves itself from a custom scheme**, not `file://` and not a localhost server. Every origin tested is a secure context, so nothing is lost; a custom scheme needs no port and, unlike a localhost server inside a desktop app, cannot be reached by any other process on the machine — which matters because these files hold other people's information. Electron requires `registerSchemesAsPrivileged({ secure: true })` before startup.
- **A ~150 MB bundled runtime**, accepted.
- **Paste re-encodes rather than preserving the pasteboard's original bytes** — 4 062 against 7 610 for the same image. Pixels survive, the file does not. This is the one cost that cannot be recovered after the fact, and if it matters it needs a small native path.
- Printing renders the range to HTML in the web layer and hands it to the shell; the print document must carry an explicit `<base href>` or relative images silently vanish.

**What would reopen this.** Electron becoming untenable for the Android side, which it does not touch — mobile was always free to be its own build.

## D18: The Document API is written before the format spec

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`

**Decision.** v1's first artifact is the **Document API**, not the file format. The format is an implementation of a storable state adequate to that API.

**Why, and it corrects an earlier claim of mine.** I had called the format v1's one irreversible artifact. The sharper statement is that **syntax is convertible after the fact and coverage is not.** Delimiters can be rewritten, keys renamed, files restructured — none of that strands anything. What cannot be recovered is a fact the format had no place for: an origin date never written, a tag never recorded, a distinction the syntax could not express. And the set of facts that must be recordable is exactly the set the API exposes, so designing the API first makes coverage fall out instead of being guessed.

**The deadline this creates.** Conversion is cheap while there is one device, one build, and free downtime. It stops being cheap at v2 — two devices, one possibly mid-sync, an older build on the phone reading files a newer build wrote. **The format must be settled before sync ships, not before v1 ships.**

**Three things the API pinned down that the format must now serve.**
- **Positions are live and carry a generation; anchors are durable.** A stale Position must fail loudly rather than resolve approximately — this converts the most likely mechanism of T1, an operation computed against text that has since moved, into a visible error.
- **The window is expressed in dates, never in files**, which is what makes D8's "one document" true at the interface rather than only in prose.
- **Overlapping tags cannot be expressed by nested delimiters**, and R12 requires overlap. The likely answer is that anchors are the primitive and a tagged range is a named pair of them, which interleaves freely and deletes a concept — a bookmark is then simply an unpaired anchor.

**The object is named Document, not File.** Calling it File invites exactly the confusion the abstraction exists to prevent; files appear nowhere in the interface.

## D19: Document is built in two tiers — spans, then semantics

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`

**Decision.** Inside Document, a **span tier** knows text, points and spans and nothing about their meaning; a **semantic tier** knows the kinds — anchors, tags, headings, dates — their invariants, and how each is written. Z sees only the semantic tier.

**Why the generalization pays.** Anchors, tags, headings and dates are four kinds of annotation over the same text: each marks a point or a span, each answers "are you active here," each can be enumerated, jumped to, and used as a selector. Four parallel enumerate-and-resolve surfaces collapse into one. It also **pulls in more than the four**: search results, selections, links, images and the branch link left behind in the stream are all spans, so "treat a result as a selector" needs no machinery, and a filtered view (D9) becomes literally *a query returning spans* — which sharpens the standing open question into "can you write through a span set?"

**The deeper reason it is right.** The requirements already observed that R11–R14 are one gesture wearing four hats: *select a range, then do something with it*. This makes the application's core interaction primitive the primitive of the data model too.

**What it does not do — D9 survives intact.** Dates become a span *kind* with strong extra invariants (total, contiguous, non-overlapping, ordered, immutable, system-assigned), not "just another tag." D9 said dates and tags unify at the query layer and not in the data model; this is that decision *implemented* rather than reversed — the unification is now mechanical instead of aspirational.

**Three rules keep the tiers from collapsing.**
- **Read-uniform, write-differentiated.** Querying is identical across kinds; creating is not. An anchor is a marker, a tag a marker pair, a heading appears because you typed `##`, a date is never authored. There is no `createSpan(kind)`.
- **Z never sees the span tier**, because a uniform API invites bypassing the layer where the invariants live.
- **Document-level metadata stays out.** Kind, origin date and origin link (D13) are properties of the whole document, not spans over it. Forcing them in is the generalization going one step too far.

**Amendment to D8, which was half wrong and half right.** Segmentation is **not** an API concern — nothing above Document knows about files, and a within-day split for an unusually large day would change nothing above. My earlier framing implied the split rule was visible upward; it is not. But invisible is not unconstrained: **reconciliation operates on files**, so devices that split differently manufacture divergence. The split rule therefore belongs to the **wire format**, which D18 already defines as a storable state adequate to the API — not to storage discretion, and not to the API. Any within-day rule introduced later must itself be deterministic and content-derived, and changing it is a coordinated format migration.

**One concrete format consequence, free now and expensive later.** If the split rule may ever change, **a date carried in a filename constrains it** — a filename-borne date forbids any file from spanning two days, so days can be split but never coalesced. A date marked in content survives any split rule. That is a decision for the format spec, but it should be made knowing which door it closes.

## D20: Spans are inferred from the text; one batch write primitive; durability contract stated

**Date:** 2026-08-12
**Status:** decided, with one sub-question open
**Detail:** `solution/document-api.md`

**Decision.** Spans are **inferred from the markdown**, never stored beside it — dates from frontmatter, headings from markdown headings, anchors from anchor markers, tags from a delimited protocol. Spans and their ids are never persisted. The single mutation is `replace([{span, payload}])`, a **batch**; an empty span inserts, an empty payload deletes. Reads are `size`, `fetch` and `snap`, where fetch is markdown-aware and returns the span it actually served alongside the text.

**What inference buys, which is more than convenience.** The document becomes a pure function of its text: no side state to keep consistent, no index to go stale, no span merge — merge is text merge. Hand-editing is satisfied structurally rather than by care. And it **deletes a rule from D19**: "read-uniform, write-differentiated" is unnecessary, because there is no per-kind write path at all. Creating a tag is inserting marker text; the semantic tier is a set of text generators over one primitive.

**Why the write primitive must be a batch.** Tagging a range is two insertions. As two calls the document passes through a state with an unbalanced marker that a change consumer will observe, and the second call's offsets must be adjusted by the first — arithmetic in the caller, which will eventually be got wrong. As one transaction there is no transient invalid document, and undo granularity matches user intent.

**Undo is single-sourced, and the boundary is whether an editor holds the document.** CodeMirror keeps its own history; two histories over the same text diverge. For an open document the editor's transaction system is the write path and calls `replace`; for a document not open — fileset references during a branch — Document writes directly.

**Durability: `replace` is durable on return, and the keystroke path does not call it.** The editor holds the live buffer and renders from it (D14 rule 6), so typing is not a sequence of API calls; `replace` serves operations, which are rare enough that synchronous durability is free. What guarantees typed text is a separate contract, and **the realistic failure is a renderer crash rather than power loss** — the live buffer lives in the renderer, which is the component most likely to die, so durability must cross to the main process cheaply. Rewriting a day file per keystroke is not cheap; an append is, and the notebook is append-shaped anyway. Two API-compatible candidates: durable-on-append via a journal replayed after a crash, satisfying "losing anything, ever" literally; or durable-on-quiescence via debounced autosave, which satisfies it psychologically and not literally. **The choice may be deferred; the contract may not** — it is stated now as *durable when `flush()` resolves, and durable within N ms otherwise*. Fixing N later is not a breaking change; discovering there was never a contract is.

**Open sub-question: the offset unit.** Code points are principled; **both target platforms are natively UTF-16** — JavaScript and Kotlin — so code points cost a conversion at every CodeMirror boundary, on the path R1.1 governs, and astral characters will occur because mathematical alphanumerics live above the BMP. `size` is also O(1) in UTF-16 units and O(n) in code points. Either choice is defensible; the invariant is that a Span never splits a surrogate pair.

**Two leaks the semantic tier must close.** Adjacent same-date spans must coalesce, or a within-day split makes storage segmentation visible above the API — the thing D8 and D19 exist to prevent. And document-level metadata (kind, origin date, origin link) is not a span; forcing it in is the generalization going one step too far.

## D21: Document's buffer is a CodeMirror EditorState; coordinates are (date, offset)

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`

**Decision.** Document's live buffer **is** a `@codemirror/state` `EditorState`. A view attaches when the document is open and detaches when it is not; the state exists either way. Document coordinates are **`(date, offset)`**, not absolute offsets into the stream.

**Why the alignment works.** `@codemirror/state` has no DOM dependency — it is a rope, a transaction system and a state container. Its model already matches the one D20 arrived at independently: state is immutable, a change spec is *an array of `{from, to, insert}` relative to the pre-state, sorted and non-overlapping* — which is `replace([{span, payload}])` exactly — and a `ChangeSet` can be inverted, composed, mapped through other changes, and serialised.

**What it dissolves.**
- **The undo conflict is deleted, not arbitrated.** There are not two histories; there is one StateField, and every mutation is a transaction. D20's rule that open documents write through the editor and closed ones write directly is **withdrawn** — a headless `EditorState` takes the same transactions as one with a view, so the distinction never existed.
- **Durability becomes small.** The journal is a log of serialised ChangeSets: append on transaction, replay after a crash, compose and discard when the file is rewritten at quiescence. That makes the strict contract — nothing lost, not even the last keystroke — cheap enough that there is little reason to take the weaker one. The realistic loss event remains a **renderer crash**, which is why the journal must be an append crossing to the main process rather than a file rewrite.
- **Two annotations do real work.** `isolateHistory` on programmatic operations, so applying a tag is its own undo step rather than merging into the sentence being typed; `addToHistory: false` on externally-originated changes with history mapping through them, which is the mechanism v2's sync layer will want.
- **A nearly-free R1.2 win:** `EditorState` can serialise its history field, so the undo stack can survive an app restart. Most applications drop it; this user would notice.

**Why `(date, offset)` rather than absolute offsets.** Absolute positions require a global index of every file's *character* length, which `stat` cannot supply — and worse, **they make every position in the corpus stale after any edit anywhere**, since inserting a sentence into a 2020 entry shifts every 2026 offset. With `(date, offset)` an edit invalidates only positions within that date, which matters because search results, nav targets and section entries all hold positions. It also handles the within-day split cleanly: the date→files mapping changes and nothing above it does. Ordering is lexicographic; a Span may cross dates.

**Span ids are dropped.** With inference there is nothing for an id to identify, and the durable handle is always the name in the text.

**The bet, named rather than assumed.** This couples the model layer to a JavaScript library. Defensible because the package is DOM-free, and because Spike A′ found the same page runs well on Android — so a web-based phone build shares the code. If Android is ever native Kotlin, the contract ports and the implementation does not. That is a real cost, and an argument for the phone being web-based too.

## D22: The Document API is CodeMirror-compatible, not CodeMirror-dependent

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`

**Decision.** The Document API declaration names no CodeMirror type and imports nothing from it. The alignment established in D21 is preserved as a **compatibility property** rather than a dependency, so that replacing the editor costs an adapter rather than a redesign. The three coordinate systems are **named types in the code** — `DocumentPosition`, `WindowPosition`, `StoragePosition` — with the last confined to Document's interior and never appearing in a signature Z can reach.

**Why.** These primitives are fundamental to the problem, not to the library: a dated stream, spans inferred from text, one batched mutation, positions that expire. They will outlive any particular editor. Expressing them in the editor's vocabulary would make a library choice look like a design commitment.

**The five properties that keep the adapter thin** — and the checklist any replacement editor must satisfy:

1. Edits are a sorted, non-overlapping batch relative to the pre-edit state.
2. Window positions are integer offsets in the same unit the editor uses, so window↔document conversion is arithmetic.
3. Changes are serialisable, which is what makes the durability journal a log of change records.
4. Changes can map a held position through them.
5. Edits can be annotated with an origin controlling history grouping and membership.

CodeMirror satisfies all five, which is why D21 is cheap. If the editor is ever replaced, this list rather than the API is what has to be re-satisfied.

**Two smaller things the declaration settles.** `fetch` is asynchronous while `DocumentWindow.text` is synchronous, which puts D14 rule 6 — strict for operations, loose for live state — into the type signatures instead of prose. And `EditOrigin` (`user` | `operation` | `external`) carries the entire undo policy in the API rather than in editor configuration.

**One thing it deliberately leaves unresolved.** Windowing is in the API and may not be needed in v1 — Spike A measured flat cost at 1.05 MB, year one of the corpus is about that size, and 25 MB is twenty years away, so v1 may legitimately return a window covering the whole document. Having the type present means windowing can arrive without an API change. It also flags the question that arrives with it: **whether undo should survive a window move**, which is unanswered and deferred with it.

## D23: Undo is document-scoped; windows are a read affordance; journal+digest as model, not as storage

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`
**Amends:** D21, D22

**The fact that forced this.** Era 3 produced 40–50 thousand lines a month — roughly **2–3.5 MB a month, 20–45 MB a year, 0.4–0.9 GB over twenty years**. Spike A's 1.05 MB corpus, which read as a generous test, is **about a fortnight of writing**.

**Decision.** `DocumentPosition` is the true position and everything else derives from it. **Undo is movement through the document's change history, in document space, entirely unrelated to what is on screen.** A window is a rendering affordance — load this region, widen its boundaries to something meaningful, make it fast to edit — holding no history and owning no state lost by closing it. Reads take a span *and a generation*.

**The clarifying model is journal plus digest**: a document is a sequence of change records with periodic realised snapshots; state at time *t* is the last snapshot before *t* plus everything since. Undo is scrolling backwards in that space, which makes its independence from windows obvious rather than argued.

**The model is adopted; the storage architecture is not.** Making the journal authoritative would demote the plain text files to a derived snapshot — which is exactly the fork Q2 closed in the opposite direction, arriving through a different door. **The journal is a write-ahead log over authoritative text**, folded in and discarded at quiescence. Retaining it past quiescence is a separate small choice that buys restart-surviving undo at the cost of a second representation.

**What this amends in D21.** D21 claimed the undo conflict was *deleted* because Document's buffer **was** an `EditorState`. At this corpus size that premise is false — the document does not fit in a buffer and never did. The conflict is therefore **relocated, not deleted**: there is exactly one history, it lives in Document in document space, the editor's own history is **disabled**, and undo/redo bind to `Document.undo`/`redo`. What survives of D21 is the transaction *shape* (D22's compatibility contract) and the serialisable-change model that makes the journal cheap. This is the "a rationale can expire when a later decision changes the substrate underneath it" discipline firing on a decision three hours old.

**Three consequences beyond the API.**
- **Windowing is required in v1**, not deferred. A month of writing is already 2.4× the largest thing the editor has been tested against.
- **The index arrives sooner than D7 assumed.** Scanning is instant at 10 MB and is not at 50 MB, which is year two. "Index is a v3 concern" was optimistic; plan it for v2.
- **Undo may land outside the current window**, so `undo()` returns the change and the UI moves there. An undo with no visible effect is worse than no undo.

## D24: Offsets are opaque, in UTF-16 code units

**Date:** 2026-08-12
**Status:** decided
**Resolves:** the open sub-question in D20
**Detail:** `solution/offset-units.md`, `solution/document-api.md`

**Decision.** `Offset` is an opaque branded type whose unit is **UTF-16 code units**. Arithmetic on two Offsets yields a plain number that cannot be assigned back without a deliberate cast, so accidental unit-dependence is a type error. Only two places may know the unit: the **window adapter** and the **position algebra**. Bytes appear only in file I/O, which takes no offsets at all.

**Two facts reframed the question and removed most of the case for bytes.**
- **Nothing durable holds an offset**, by D11 — bookmarks and tags are markers in the text, section entries reference names, links resolve by lookup. The only serialised offsets are inside the journal, a transient write-ahead log written and read by one build of one app. And the usual objection is slightly mis-stated: we never write UTF-16 *as an encoding*. The journal is UTF-8 JSON containing integers whose semantics happen to be a count of code units.
- **The document↔storage boundary is file-granular, not offset-granular.** Writes are whole-file atomic replacements and reads load whole files; at ~100 KB a day nothing seeks into an undecoded file. So byte offsets are never *required* as an addressing unit.

**The structural fact that decided it.** Conversion is nearly free when it is a byproduct of a bulk transcode already happening — decoding a file on load, encoding on save. It is expensive when maintained incrementally against a buffer edited at 130 WPM. UTF-16 puts zero cost on the hot boundary; bytes would require a prefix-sum structure over the live buffer to buy portability that has no consumer, since rule 4 keeps search inside the Document API rather than handing it to an external scanner.

**Why opaque as well.** The unit has no dominant winner and two decisions today were already revised by a single new fact. Opacity is free at runtime, catches the accidental case at compile time, and keeps the choice reversible.

**The runner-up, and when to revisit it.** `(date, line, column)` was the only genuinely different shape, and its argument is real: lines are the granularity of merge, so line positions would align with reconciliation rather than cut across it. It loses on complexity — a three-component position where two were already a compromise — and because the date partition already wins most of the locality benefit, a single date holding roughly 1500 lines. **Revisit only if the format spec finds that merge wants line addresses anyway.**

**Invariant, asserted at construction:** no offset ever falls between the halves of a surrogate pair.

## D25: The wire format

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/format-spec.md`

**Decision.** Markdown files in a dated directory tree, with anchors and tags as HTML comments, types declared by filename suffix and mirrored in frontmatter, and sections as ordinary markdown link lists. Full spec in `format-spec.md`.

**The choices with reasons worth keeping.**

- **Markers are HTML comments** — invisible in every renderer, greppable, hand-typable, self-describing to a reader in fifteen years. A bookmark is an unpaired marker; a tag is a named pair. **Paired points are what make overlap work**, since nested delimiters cannot express a tag over lines 3–8 crossing one over 6–12 but four independent points can.
- **Same-subject spans may not overlap, which removes the need for identifiers.** Markers for a given subject strictly alternate, so pairing is unambiguous with no ids; tagging an already-tagged range extends the existing span, which is what the user meant. This is the second time inference has deleted an id (D20 was the first).
- **The split rule must be prefix-stable, not merely deterministic.** The boundary of part *k* depends only on the content before it, so appending never moves an existing split. A size threshold at a paragraph boundary has this property; a rule keyed to total size or to save timing does not — and without it, appending to a day reshuffles its files and manufactures divergence.
- **Frontmatter is authoritative and the filename mirrors it**, for both date and kind. Enumeration uses filenames as a hint, verified lazily, so the common path does not open 5 000 files; a disagreement is reported and repairable rather than silently resolved.
- **Section entry type is inferred from the link target** — a `tephra:mark/…` URI, a relative path, an http URL — so there is no type field to keep consistent. The trailing text after each link is the summary, which has a home from day one because coverage cannot be backfilled even though R20 is a v3 feature.

**Two implicit assumptions corrected.**
- **Markers inside code blocks must not be interpreted.** This is a physics notebook; it will contain fenced code, and code about Tephra will contain Tephra markers. The parser must be markdown-aware — **and so must v1's scan-based search and enumeration**, previously described as "grep for markers." A fence-aware scan costs almost nothing; a regex scan is wrong in a way that surfaces once, badly.
- **A rewrite must splice edited regions into the original bytes, not serialise from a parsed model.** Whole-file atomic replacement makes model-serialisation tempting, and it silently reformats — key order, list markers, wrapping — turning every save into a diff.

**The line-address question is answered, not deferred.** D24 left `(date, line, column)` to be revisited if the format wanted line addresses for merge. It does not: markers are inline and travel with the text, no position is persisted, and reconciliation operates on text rather than addresses. **UTF-16 offsets stand.**

**Open inside this decision.** Marker verbosity is a judgement about how raw mode feels, not a correctness question. And the degradation table promises every anomaly is reported — somewhere non-modal has to hold that list.

## D26: Window is the complete editor-facing API

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`

**Decision.** `Window` becomes the full surface an editor binds to: text, `edit()` in window coordinates, synchronous `spansAt`/`spans`/`snap`/`advance`/`distance`, a change feed, and coordinate conversion. It translates to `DocumentPosition` and forwards to `Document.replace`. An editor never touches Document — **except for undo.**

**Why it is the right seam.** Window is already the only code that knows both coordinate systems, and D24 named it as one of only two places permitted to know the offset unit. Making it the whole editor API puts the D19 tier boundary and the D24 unit boundary in the same object, and lets it be shaped as closely as convenient to the editor's own idiom without that shape leaking into X.

**Undo is deliberately absent from Window.** It is document-scoped (D23) and can land outside the current region, so the editor binds its undo key to `window.document.undo()` and moves the window to wherever the returned change happened. Reaching past the facade is the point: it keeps the scoping visible in code rather than implying that undo is a property of what is on screen.

**Two contracts that each prevent a specific bug.**
- **`edit()` updates in-memory state synchronously and resolves on durability.** The editor never awaits on the typing path, but a genuine write failure — disk full, permissions — still surfaces rather than being swallowed.
- **`onChanged` does not fire on the window that originated a change.** The editor has already applied it; re-applying is exactly how text gets duplicated.

## D27: Branched documents have no date; positions are keyed by segment

**Date:** 2026-08-12
**Status:** decided
**Amends:** D13, D9's phrasing

**Decision.** The `origin` and `originMark` frontmatter keys are dropped. A branched document is **not in the dated stream and is not given a date to pretend otherwise.** `DocumentPosition`'s first component becomes a **`SegmentKey`**, which is a `DateKey` in the stream and a single constant in every other document. `dateAt` returns `DateKey | null`.

**Why the origin fields went.** The relationship that matters is the **link left behind in the stream** — it points the useful direction, from where you were to where the material went, and D13 already makes it load-bearing as v1's entire findability mechanism. The reverse pointer is curious history that may never be consulted.

**The deeper correction this exposed.** D13 argued that a branched document must record an origin date or it becomes "an undated object in a system organized by date." That argument assumed **date totality applies to every document**, and it does not — it is a property of *the stream*. A pinned list has no date; the events calendar has no date; neither ever did. Generalising the position's first component to a segment key removes the pretence, and it is a deletion rather than an addition: one concept where there were two.

**What it does not change.** D9 stands — within the stream, dates remain total, contiguous, non-overlapping, ordered and immutable. Date filters simply do not match documents outside the stream, which is the correct behaviour rather than a gap.

## D28: The journal is retained for 30 days, and deletion must reach it

> **SUPERSEDED by D32.** What was under review here resolved against it: versioned history moved to a local git repository from v1, the journal shrank to a seconds-long WAL, and the 30-day retention retired along with the ambiguity of one mechanism serving as both a durability device and a history. The destruction record now lives in the repository, where it is durable and versioned — which also makes T10 worse rather than better, since deleted text now survives permanently. Kept for its reasoning; the split-threshold half of the decision (256 KB → 1 MB) still stands.

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/format-spec.md`

**Decision.** `.tephra/journal/` retains serialised change records for **30 days** — machine-local, never synced, disposable. The day-file split threshold moves from 256 KB to **1 MB**.

**Why 30 days, and the reason is not undo.** Durability needs only the records since the last fold; restart-surviving undo needs a session. Retention costs roughly 15 MB and buys the thing that cannot be reconstructed later: **a record of what was destroyed.** "Losing anything, ever" is an explicit unacceptability criterion, and the case nothing else covers is accidental destruction noticed a week afterwards. This is the last-touched-timestamp pattern again — the mechanism may be deferred, the data may not.

**So the recovery affordance goes in the backlog, not nowhere.** Retaining records no one can ever read would be pointless.

**The consequence that must be stated rather than discovered (T10): deleting text from Tephra does not delete it from the journal for up to 30 days.** If something is deleted *because* it should not be recorded, that expectation is silently violated — and the corpus contains other people's information. A purge that clears journal records as well as text is a v1 obligation, not a nicety.

**1 MB is measured rather than guessed** — Spike A ran 1.05 MB at flat cost. Two notes. The split threshold and the **window extent** are different knobs, and it is the window extent that R1.1 depends on; Spike A bounds the window, not the file. And at roughly 100 KB a day a 1 MB threshold means splitting essentially never fires — **a path that fires once every few years is broken when it fires**, so it needs a test that forces it with a synthetic oversized day.

## D29: Generation is the rewind coordinate; rewind is non-destructive

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`

**Decision.** `Generation` is opaque and comparable, and it is the document's rewind coordinate. The primitive is **`rewindTo(generation)`**; `currentGeneration()` exposes the present one; **`undo` and `redo` become policy over `rewindTo` rather than primitives beside it**, rewinding to the generation at the previous history-group boundary. `history(since?)` enumerates what the retained journal can still reach.

**Why generalise now when only undo and redo get surfaced.** The implementation is the same either way, and the general form makes two later things free rather than structural: a recovery UI over the retained journal (D28), and any "what did this look like on the 3rd" affordance. Grouping stops being part of the primitive and becomes a policy over a character-granular log, which is also a more honest description of what a history actually is.

**Rewind is non-destructive, and this carries a Portal insight forward.** A rewind is emitted as a **new change**, so generations only ever increase and nothing is discarded — Portal's "rewind as a non-destructive new commit," which fits the journal model exactly. Rewinding and then typing does not destroy the abandoned future; it merely stops being reachable through the undo affordance. **"Losing anything, ever" then holds for history as well as for text**, which is a stronger guarantee than the usual linear-undo model gives.

**Generations are machine-local.** They are never written into the corpus, only into the journal, which does not sync — so two devices need not agree on them, and a sync pull is simply another change advancing the local counter. That removes a coordination problem before it exists.

**Retention bounds rewind.** `rewindTo` can reach any generation whose records survive; past 30 days (D28) the generation is known but unreachable, and the call fails loudly rather than approximating. The retention figure now has a second justification.

## D30: `.tephra/` contents are specified, and one requirement in it is unresolved

**Date:** 2026-08-12
**Status:** decided, with one item open
**Detail:** `solution/format-spec.md`

**Decision.** `.tephra/` holds `version`, `lock`, `journal/<doc-id>/`, `index/`, `issues.json`, `attachments.manifest` and `ui-state.json`. Never synced; deleting it costs a rebuild and nothing else.

**Two entries that exist for non-obvious reasons.**
- **`lock`** — two Tephra processes over one directory would fight over the journal and the fold, and the failure mode is corruption rather than an error.
- **`attachments.manifest`** — attachments are a cache and may be evicted while text is a replica and may not (D5), but **an evicted attachment and a deleted one look identical on disk.** That is precisely the replica/cache confusion D5 exists to prevent, reappearing one level down. The manifest is what keeps "evicted, refetchable" distinguishable from "gone."

**The open item: R1.2 asks that view state survive "device changes," which implies it should sync.** That contradicts `.tephra/` being machine-local. Both readings are plausible — resuming on the phone where the Mac left off, versus never losing your place on this machine — and they want different homes. **v1 keeps it machine-local**, since v1 has no sync; but if it is ever to sync it needs a place in the synced tree, which is a coverage decision rather than a mechanism, and therefore subject to the backfill rule.

## D31: The journal stays local; versioned history belongs to the hub

> **Under review (Q6).** D31 split the responsibilities correctly but did not examine the three points where the two histories actually touch — autosave, remote merge, hand-editing. See `solution/history-options.md`; the likely refinement is that the journal stops being a history at all.

**Date:** 2026-08-12
**Status:** decided
**Amends:** D23, D28, D29
**Narrows:** Q2

**The question.** Should the journal and generations be machine-local, or a logical part of the document — in which case undo, redo and rewind become ordinary document operations rather than local affordances? In a journal+digest *format* they would plainly be part of the document.

**There are three coherent positions, not two.**

- **A — journal local.** Files are truth; the journal is a write-ahead log and a local recovery window. Undo is per-device. Rewindable history has no home.
- **B — journal authoritative and synced**, files materialised from it. Undo and history are global.
- **C — files authoritative, journal synced alongside as supplementary history.**

**C is the tempting one and it is the worst of the three.** A synced journal that is not authoritative is also **not derivable**: given two versions of a file you can diff them, but you cannot reconstruct the change history, the grouping, or the intent. So it is neither the truth nor a projection of the truth — it is an independent second record that must be kept in agreement with the first, across devices. That is precisely what D7 refuses for indexes, and for the same reason.

**B deserved a better hearing than D23 gave it.** D23 rejected journal-as-truth on the grounds that it demotes plain files to an export. **Git is the counter-example**: its history is authoritative, its working tree is a checkout, and the exit is excellent because the files are always materialised as ordinary files on disk. So the exit objection is answerable.

**What actually kills B here is hand-editing.** It is a load-bearing discipline in this project — every format rule has a defined degradation for a human having been in the file. Under B, a hand-edit is invisible to the authoritative history: the next materialisation either overwrites it or diverges from it. Git survives this only because divergence between tree and history is *expected* and reconciled by an explicit ceremony (`git add`). Tephra has no ceremony and wants none. Synthesising a change record from a detected external edit is possible — the watcher and quiesce protocol already do the detection — but it makes "the journal is the truth" mean "the truth, reconciled against the files whenever they move," which is C wearing B's clothes.

**The decomposition that resolves it: these are two questions with two natural homes.**

| Question | Mechanism | Granularity | Scope |
|---|---|---|---|
| *Undo what I just did* | local journal | keystroke / edit-group | this device |
| *What did this look like in March — restore it* | **the hub's version history** | commit | any device |

Fine-grained cross-device undo is the only capability this forgoes, and under D12 — you do not switch devices mid-thought — it is close to worthless. Everything else is preserved, and **rewindable history gains a home it did not previously have**: it was sitting in the backlog with no mechanism behind it.

**This narrows Q2 substantially.** If versioned history is a property of the hub, **the hub must be a versioned store, not a file-sync service.** That rules out plain Dropbox/iCloud/S3-shaped answers and points hard at git or an equivalent — which is also where Portal's validated spike work already lives.

**The conceptual objection is real and has a cheap answer.** "Generation is machine-local" is ugly: a generation ought to be a property of the document. It can be, without syncing anything, by making it a **chained content hash** — `gen[n+1] = H(gen[n] ‖ change[n])`. Two devices that applied the same changes in the same order then agree on it by construction, staleness checking needs only equality, and ordering comes from the journal's own sequence. It costs a hash per change and would make sync reconciliation legible later ("do we share an ancestor generation?"). Not required for v1; recorded because it is cheap now and the chain re-establishes itself within one retention window if adopted later.

## D32: Volatile undo, a seconds-long WAL, and a git repository that is local from v1

**Date:** 2026-08-12
**Status:** decided
**Resolves:** Q6
**Amends:** D28, D29, D31
**Detail:** `solution/history-architecture.md`, options in `solution/history-options.md`

**Decision.** Four mechanisms, each with one job, and no two of them histories of the same thing: an **in-memory undo stack** on Document (session-scoped, fine-grained); a **write-ahead log** holding only the changes since the last file write (seconds); the **files**, which are the corpus; and a **git repository**, local from v1 and gaining a remote at v2a, which is the only durable history.

**Why it wins.** It is the only option that puts all three interaction points in one place or in none. The WAL is too short-lived to be a second history and so cannot disagree with one; the repository is the only history; **hand-editing needs no ceremony** because a hand-edit is just a file change; and remote merges touch only the volatile stack, where existing machinery handles them. Unbounded high-resolution undo is the single capability forgone, and it is not wanted.

**Why git rather than a store of our own.** A content-addressed snapshot store would be far less code. Git wins on a requirement instead: **it extends the exit to the history.** Abandoning Tephra leaves a git repository — plain files *and* readable history, usable with every tool on earth. A bespoke store leaves the files and holds the history hostage, failing R26 one level below where R26 is usually applied.

**M1 is the load-bearing modifier.** The repository is local from v1, so v2a adds *distribution*, not versioning. That gives v1 real recovery — v1 being exactly when a new application is most likely to eat a paragraph — validates the model against real data a year before sync ships, and makes both histories exist from day one so their interaction is exercised rather than deferred.

**The correction that came out of building it: every tier needs a quiescence trigger *and* a maximum interval.** Quiescence alone fails under precisely the condition this notebook exists for — writing continuously for an hour never reaches quiescence, so the file is never written and the WAL grows to hold the session. So: WAL batched at ~50 ms; file write on ~1 s quiescence **or every 5 s**; commit on ~5 min quiescence **or every 30 min, or session end**.

**Layering.** **History becomes its own X object** and Document stops owning durable history. `Document.undo`/`rewindTo` stay volatile and session-scoped — D29's generalisation survives, merely scoped — while `History.restore(version, doc, span?)` is durable and commit-grained. Two coordinates for two genuinely different things. `restore` taking an optional span is what allows "put this paragraph back" without reverting a file.

**What it retires.** D28's 30-day retention; the homeless "rewindable history" backlog item, which now has a mechanism and arrives in v1; and the ambiguity that started this thread, since nothing is now both a durability mechanism and a history.

**T10 gets worse and the earlier mitigation was wrong.** Deleted text used to survive 30 days locally. It now survives **forever in the repository, and from v2a on the hub.** Purging becomes a history rewrite and, after v2a, a force-push. This is inherent to having history at all rather than a flaw here — but "a purge action clears the journal" is no longer true, and the honest mitigation is **a documented procedure, not a button.**

**Still open, and small:** whether to shell out to system `git` or bundle `isomorphic-git`. And binary growth — twenty years of pasted images in history, never collected — is probably fine at this scale but should be measured rather than assumed.

## D33: Two version axes, made as explicit as the position types

**Date:** 2026-08-12
**Status:** decided
**Detail:** `solution/document-api.md`

**Decision.** `SessionGeneration` and `VersionId` are distinct types with distinct owners, and the API is structured so they cannot be confused — the same treatment `DocumentPosition` / `WindowPosition` / `StoragePosition` already get, for the same reason.

- **`SessionGeneration`** — volatile, in-memory, dies with the process. Owned by **Document**. Advanced by every change; the coordinate for `rewindTo`, `undo`, `redo`, and for staleness in `DocumentPosition`.
- **`VersionId`** — durable, a commit. Owned by **History**. Survives restarts, devices, and Tephra itself, being readable with `git log` after the application is gone.

**Four structural separations, not just two names.** Different underlying primitives (`number` versus `string`), so no cast bridges them. Different owning objects. **No conversion function in either direction**, and none should be added — the correspondence exists only within one session and only for commits made during it, so exposing it would invite treating a volatile coordinate as a durable one. And no method anywhere accepts both.

**The name carries the constraint.** `SessionGeneration` rather than `Generation` states the lifetime at every use site — and it reinforces something already true: a `DocumentPosition` stamped with one cannot outlive the session, which is exactly what D11 requires of it anyway.

**A correction to my own earlier sketch: `History.restore` takes whole documents, not spans.** Restoring part of an old version needs a span addressing text inside a version that was never loaded — so it carries no live `SessionGeneration` and cannot be a `DocumentPosition` at all. Making it work would require aligning two versions of a document, which is a real and hard feature. The honest v1 answer is `read` the old text and paste the part you want, which is what a person does anyway and needs no alignment machinery.

**A restore truncates the undo stack**, on the same rule as a divergence resolution: it is a large external change and mapping an undo through it is not well defined. If a restore was wrong, the recovery is another restore, not ⌘Z.

## D34: The git implementation is a bundled library, and `isomorphic-git` for v1

**Date:** 2026-08-12
**Status:** decided for v1; revisit at v2a
**Detail:** `solution/git-library.md`

**Decision.** **No dependency on system `git`.** The choice is among bundled libraries, and for v1 it is **`isomorphic-git`** — pure JavaScript, no native build, no Electron ABI coupling. Revisit at v2a, when network and merge requirements actually arrive.

**The distinction that matters is not "dependency or not" but which kind.** A *system* dependency risks presence, version skew and the user's environment — ruled out. A *native module* moves that fragility inside the bundle but adds per-platform, per-ABI builds and a rebuild on every Electron upgrade. A *pure-JS* dependency has the simplest build story and inherits the implementation's limits.

**Why the limits do not bite here.**
- v1 needs a small subset — init, add, commit, log, read a blob, checkout — and **no network at all**.
- The known weak spot is whole-tree status, which is O(files). **We never need it on the hot path**: the editor knows which files it wrote and the watcher reports external edits. A full scan is needed once, at startup after the app was closed, where seconds are acceptable.
- **Merge quality matters less than it appears**, which removes the strongest argument for libgit2: reconciliation is user-facing by design (D12 surfaces a picker rather than auto-merging), and append-union merge for day files is ours to implement regardless. Git is transport and storage here, not a merge engine.

**The real limitation to accept knowingly: no SSH transport.** Push and pull are HTTP(S) only, which constrains the v2a hub to an HTTPS endpoint with token auth. Fine for self-hosted or hosted git, but a conscious choice rather than a discovery.

**The alternatives, kept for the v2a revisit.** `nodegit` is real libgit2 with native-module fragility. **`napi-rs` over a Rust git crate is the closest thing to reusing Portal's validated work** — and the same Rust core could serve Android via UniFFI, which Portal proved end to end. `wasm-git` is libgit2 without a native build but with an awkward filesystem bridge.

**The decisive acceptance test, whichever is chosen: the on-disk repository must be readable by standard git tooling.** The entire reason for choosing git (D32) is that the exit extends to the history. A repository only Tephra can read defeats the point, and would fail the requirement that made git the answer.

**A caveat recorded honestly.** Library maintenance status and API completeness change faster than my knowledge of them, and library health is where I am least reliable. The structural analysis above is durable; the current state of any of these packages is worth thirty minutes of verification before committing.

## D35: Pane is the navigation view-model; Window is renamed DocumentWindow

**Date:** 2026-08-12
**Status:** decided
**Addresses:** Q7
**Detail:** `solution/pane-api.md`

**Decision.** A new **`Pane`** class in Z owns navigation and extent policy: where the user is, how they got there, and whether an extension blocks or happens quietly. **`Window` is renamed `DocumentWindow`** (`WindowPosition` → `BufferPosition`).

**Why it cannot be Window, and the reason is decisive: navigation crosses documents.** Jumping from the stream to a branched note to a fileset and back is the ordinary case, and a DocumentWindow is bound to one Document — so whatever holds a back stack must sit above it and replace DocumentWindows as it moves.

**Why the rename, and why `DocumentWindow` specifically.** The bare name `Window` collided three ways: a loaded region, an **OS window** (D10's "current window or a new window"), and a UI area. And there is a hard technical reason beyond readability — **`Window` is a DOM global in TypeScript's `lib.dom`**, so a bare `Window` type in a renderer process is a live footgun rather than merely a vague name. `DocumentWindow` is qualified and unambiguous. `Region` was considered and rejected as too vague to guess from.

**The position type is `BufferPosition`, not `DocumentWindowPosition`.** `WindowPosition` was rejected for a concrete reason: in an Electron codebase it reads as *screen coordinates*, which is an active hazard rather than an ambiguity. "Buffer" is the standard term for loaded editor text and cannot be misread that way; `DocumentWindowPosition` is merely long. The full set reads `DocumentPosition` (logical), `BufferPosition` (loaded), `StoragePosition` (internal), `DocumentWindow` (the region), `Pane` (navigation).

**The point of the class: Q7's four options become a policy object, not four implementations.**

```
initial · target · cap · autoExtendOnApproach · evict
```

Option 1 is `autoExtend: false`; option 2 is `autoExtend: true, cap: null`; option 4 is the same with a cap; option 3 sets `evict`. **Three of the four are flags; only eviction is new code**, because it is the one that makes scroll anchoring mandatory — and that code is isolated inside DocumentWindow. So the intended evolution is a sequence of default changes rather than rewrites. `initial` differing from `target` is what decouples "opens instantly" from "rarely reaches the boundary."

**A unification found on the way: `NavTarget` and the fileset entry type are one type.** D10's four entry kinds — bookmark, file, URL, external document — *are* navigation targets. Clicking a section entry works with no adapter because there is nothing to adapt.

**One rule stated carefully: the editor reports the viewport, the Pane decides.** `viewportChanged(visible)` keeps the dependency pointing from Z's view to Z's view-model rather than having X observe the editor, and it puts every scroll-policy decision in one place where it can be tuned by feel.

**Two things stay off the Pane.** Capture — `appendToToday` needs no navigation, no region, no pane, which is what makes a capture bar cheap later and is Portal's *the widget is the capture surface, not the editor*. And undo, which remains `document.undo()`; when it lands outside the current region the Pane is told to go there, which is an ordinary `goTo`.

**Z now has two tiers**, matching X's: a state-holding view-model (Pane) and a mechanism tier (the CodeMirror view). This is Portal's *model construction separate from view construction* with the model finally given a name and an owner. `ui-state.json` is Pane state serialised, which is what R1.2's "the open view survives" means concretely.

**It also defers Q7(c) correctly.** One pane or a privileged stream pane stops being architectural and becomes layout: the application owns a list of Panes, and pinning one to the stream is an afternoon's decision, remakeable.

## D36: The extent measurement and the failure analysis are deferred until after a first v1 cut

**Date:** 2026-08-12
**Status:** decided
**Defers:** Q7's measurement; the failure-brainstorming / failure-analysis process

**Decision.** Neither the editor-ceiling measurement nor a full failure analysis happens before v1 is first built. The remaining failure modes are sensitive to details that only appear while coding, and analysing them now would produce a document about an imagined implementation.

**Why the measurement deferral is safe, and it is not for a general reason.** It is safe *because v1 ships Q7 option 1* — `autoExtendOnApproach: false` (D35). A window that does not grow never approaches the unmeasured ceiling, so the number that measurement would produce (`ExtentPolicy.cap`) is not consulted. **The two decisions are coupled**: starting at option 2 instead, with unbounded growth, would walk straight into an untested region at an unknown corpus size.

**Reopening trigger, therefore precise:** *before `autoExtendOnApproach` is set true.* Not "later," and not "when it feels slow" — the flag flip is the moment the number starts to matter.

**Why the failure-analysis deferral holds, with one exception.** Checked against the current threat list: T1, T4 and T6 are v2a/v2b and depend on a sync implementation that does not exist; T2, T5 and T8 are already mitigated by design and coding is what will expose whether the mitigations hold; T9 is accepted. So the claim is accurate for almost all of it.

**The exception is T10, and it resolves cheaply rather than needing analysis.** Deleted text survives forever in the repository, the repository starts accumulating in **v1**, and the corpus holds other people's information — so the exposure begins at first commit, and no amount of coding will illuminate it. But **v1 has no remote**, which bounds the exposure to one machine and supplies a natural checkpoint: **the purge procedure must exist before the first push, not before the first commit.** That is a v2a obligation, which is where the rest of the failure work already sits.

**Reopening trigger:** *before v2a begins.* Sync, a hub holding third-party information, the divergence path and the first push all arrive together, and that is the point at which a threat list assembled from decisions rather than from the process stops being defensible.

**What this preserves.** `architecture.md`'s threat list stays marked preliminary rather than being quietly treated as complete, and `implementation-notes.md` §5 already carries the tests for the failure modes that *are* v1-relevant — the split path, crash recovery, atomic-rename watcher survival, the divergence path. Those are obligations on the first cut regardless.
