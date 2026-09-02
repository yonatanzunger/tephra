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

**Decision.** *(Timing revised by D52: the index arrived in M3, because the sidebar could not work without it. The reasoning below stands.)*  Tags, bookmarks and dates are represented in the markdown itself. Any index over them is **derived, machine-local, never synced, and disposable** — rebuildable from scratch at any time and never authoritative. **In v1 there is no index at all**; enumeration is by scan.

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

**Decision.** *(The default section is amended by D53: it dissolves into the top-level list, `sections/_index.fileset.md`.)* The left nav is a list of **sections**, each an expando, each one a fileset. Expanding shows its entries; clicking an entry goes to it, in the current window or a new one. An entry is one of four things: a **bookmark** (jump to a place in a file), a **file** (jump to its start), a **URL** (open in the browser), or a **document Tephra does not handle**, such as a PDF (open by OS intent). **The default section always exists** and holds the pinned items at the top.

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

**Decision.** `DocumentOffset` — named `Offset` until D48 — is an opaque branded type whose unit is **UTF-16 code units**. Arithmetic on two of them yields a plain number that cannot be assigned back without a deliberate cast, so accidental unit-dependence is a type error. Only two places may know the unit: the **window adapter** and the **position algebra**. Bytes appear only in file I/O, which takes no offsets at all.

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

### Verified — 2026-08-22

**Maintenance: healthy.** `isomorphic-git` 1.41.8, published the previous day.
474 releases in total and an accelerating cadence — 11 in 2023, 17 in 2024, 24 in
2025, 41 so far in 2026. MIT. Eleven dependencies, all pure JavaScript, nothing
native. The caveat above is answered in this library's favour.

**Function: verified in the environment that matters**, which is not plain Node
but the *bundled* main process — electron-vite emits CJS and Electron supplies
its own Node, and a pure-JS library is only pure-JS until a bundler disagrees.
init, add, commit, log, readBlob and checkout all work there.

**THE ACCEPTANCE TEST PASSES, in both directions.** `git fsck --strict` is clean,
`git log` and `git show` read our commits, and the working tree is clean
immediately after we commit — so a standard `git` reads what we write. And the
reverse, which matters just as much because a notebook is a visible directory
(D5) its owner may reasonably run git in: a commit made with the `git` binary is
read back correctly by us, blob and all. Text overwritten in a later commit is
recoverable from an earlier one, and `.tephra/` is honoured as ignored.

### A narrow library limitation, and a premise of this decision overturned — 2026-08-22

**First, a correction to a claim made here earlier today and now withdrawn.** It
was recorded that `isomorphic-git` "misses same-length edits", supposedly still
wrong more than a second later. That measurement was wrong: the delay was placed
*after* the write, which does not move a file's mtime, so it tested nothing.

**What is actually true is much narrower — the classic racy-timestamp window.**
A same-length edit landing in the *same filesystem second* as the previous `add`
reads as `unmodified`; the identical edit one second later reads as `*modified`,
correctly. Real git closes this window by re-reading content when the mtime ties
the index; `isomorphic-git` does not. A real limitation, an edge case, not a
broken library — a library with 474 releases would not survive the defect first
described.

**And it needs no guarding at all**, which took one more round to see.
`git.add({ filepath: '.' })` — the idiomatic call — **hashes as it walks**, so
the index's stat cache never enters into it and the window simply does not
apply. The hand-rolled content comparison, and the list of paths handed in to be
looked at, were an elaborate way of doing what `add` already does correctly.
Both are gone.

Confirmed by measurement rather than by reading: the same-length edit inside the
same second stages correctly through `add`, and `.gitignore` is honoured so
`.tephra/` stays out.

### D34's performance premise does not survive measurement

D34 argued that whole-tree status is O(files) and "we never need it on the hot
path", and prescribed tracking the paths the app writes instead. **That premise
was never measured. Measured now**, on a synthetic twenty-year corpus of 7 300
day files totalling 715 MB:

| operation | time |
|---|---|
| `statusMatrix`, whole tree | **0.19 s** |
| content hash, one known path | 0.004 s |
| `status()`, one known path | 0.005 s |

**190 ms, at a five-minute cadence.** The cost the design was avoiding does not
exist at this scale, and avoiding it bought real complexity: an accumulating
path set in the service, a writer obliged to report what it wrote, and the
watcher feeding the same set from the other side.

**And the simple version is more correct.** A tracked-path list silently omits
anything written by a code path that forgets to report itself; a scan has no
such gap. Simpler *and* safer is not a trade.

**So the commit is now literally `git add -A && git commit`** —
`Repository.commitAll(message)`, and nothing else. `add({filepath: '.'})`, then
`git.remove` for the deletions `add` leaves behind exactly as `git add .` does,
then commit if anything differs from HEAD. No path list, no hint parameter, no
hand-rolled hashing. `commitOutstanding` is gone too: startup reconciliation is
the same call as every other commit.

Measured on the twenty-year corpus: `add` 2.4 s cold, **1.4 s** warm, plus
0.19 s for the status pass. Slower than the 0.19 s of the clever version and
worth every millisecond at a five-minute cadence.

| version | repo.ts | machinery |
|---|---|---|
| tracked paths + hashing | 197 lines | path set in the service, writer reporting its writes, watcher feeding the set |
| `add -A` | **135 lines** | none |

**What survives of D34's reasoning:** the choice of library, its verification,
and the caveat about the v2a revisit. What does not is the prescription built on
an unmeasured performance claim. Recorded because the shape recurs: *a
performance argument that has not been measured is a design constraint invented
for free.*

**And a second lesson from the same thread, which took two rounds of pushback to
land.** Having decided the tracked-path design was wrong, the first replacement
still kept its hand-rolled hashing and a parameter to feed it paths — a stranger
API than the thing it replaced. The question that dissolved it was simply *"why
can't `statusMatrix` feed `add` directly?"*, which is the question anyone
familiar with git would ask first. **When an implementation of a well-worn
operation looks nothing like how that operation is normally written, the
unfamiliar shape is the bug report.**

**Kept as `main/w/verify-git.ts`, behind `TEPHRA_VERIFY_GIT`**, rather than
deleted — the question returns on every Electron upgrade and now costs one env
var to re-ask.

**One thing noted for packaging.** electron-vite *externalises* the library
rather than inlining it, so the built main process requires it from
`node_modules` at runtime. That is the ordinary arrangement for an Electron app
and not a problem, but real packaging must include the dependency, and packaging
is currently unscheduled (`milestones.md`).

## D35: Pane is the navigation view-model; Window is renamed DocumentWindow

**Date:** 2026-08-12
**Status:** decided
**Addresses:** Q7
**Detail:** `solution/pane-api.md`

**Decision.** A new **`Pane`** class in Z owns navigation and extent policy: where the user is, how they got there, and whether an extension blocks or happens quietly. **`Window` is renamed `DocumentWindow`** (`WindowPosition` → `BufferPosition`).

**Why it cannot be Window, and the reason is decisive: navigation crosses documents.** Jumping from the stream to a branched note to a fileset and back is the ordinary case, and a DocumentWindow is bound to one Document — so whatever holds a back stack must sit above it and replace DocumentWindows as it moves.

**Why the rename, and why `DocumentWindow` specifically.** The bare name `Window` collided three ways: a loaded region, an **OS window** (D10's "current window or a new window"), and a UI area. And there is a hard technical reason beyond readability — **`Window` is a DOM global in TypeScript's `lib.dom`**, so a bare `Window` type in a renderer process is a live footgun rather than merely a vague name. `DocumentWindow` is qualified and unambiguous. `Region` was considered and rejected as too vague to guess from.

**The position type is `BufferPosition`, not `DocumentWindowPosition`.** *(Reversed by D48, which renamed it `WindowPosition` after all — see there for why the hazard below stopped applying.)* `WindowPosition` was rejected for a concrete reason: in an Electron codebase it reads as *screen coordinates*, which is an active hazard rather than an ambiguity. "Buffer" is the standard term for loaded editor text and cannot be misread that way; `DocumentWindowPosition` is merely long. The full set reads `DocumentPosition` (logical), `BufferPosition` (loaded), `StoragePosition` (internal), `DocumentWindow` (the region), `Pane` (navigation).

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

## D37: X lives in the main process; O(corpus) work goes to a utility process

**Date:** 2026-08-14
**Status:** decided
**Detail:** `solution/architecture.md`

**Decision.** The X layer — Document, Corpus, History, Search — runs in the **Electron main process**, alongside W. The renderer holds Z and the live CodeMirror buffer. Anything O(corpus) — the startup scan, search, git — runs in a `utilityProcess` from the start rather than being retrofitted after the first stall.

**Why one X at all.** X implements the concept of *a document*; if there is one document there should be one object for it. D10's "open in the current window or a new window" otherwise produces two renderers with two Documents, two undo stacks and two WALs over the same day file — which is the corruption the `lock` file exists to prevent, arriving through a door the lock does not cover, since it guards processes rather than BrowserWindows.

**Why main rather than a shared hidden renderer**, which was the other candidate:

- **A hidden renderer saves no hops.** It is a separate process from the visible renderer, so renderer-to-renderer traffic still routes through main; and it cannot touch the filesystem without either `nodeIntegration` — the posture Spike B was careful to avoid — or IPC to main. File I/O becomes two hops where main-hosted X has none.
- **It does not solve the crash problem it exists for.** The reason to move X out of the visible renderer is that a renderer is the component most likely to die. A hidden renderer is still a renderer.
- **Chromium throttles hidden renderers**, and that is the disqualifying one. Timers slow when a renderer is backgrounded or occluded, and the write tiers are timer-driven: the 5-second file-write ceiling and the 30-minute commit ceiling exist precisely because quiescence alone fails during long writing sessions (D32). Throttling them puts "a path that fires rarely is broken when it fires" directly on durability. `backgroundThrottling: false` exists, but it is a flag that must be remembered forever.

Main also wins on the properties actually wanted: it is a singleton by construction, so there is no election; it is where W already lives; and it is where the watcher and `isomorphic-git` naturally run.

**The cost, stated with its discipline.** Blocking main stalls window management, menus and IPC for every renderer. Hence the utility process for corpus-scale work — `utilityProcess` and `MessageChannelMain` are both available in the target Electron, and MessagePorts let a scan stream results to the renderer without transiting main at all.

**One API contract needs restating, and this is the consequence to watch.** `DocumentWindow.edit()` promised that in-memory state — *both the window's and the document's* — updates synchronously before returning. With Document in main that is not literally achievable. What is achievable and sufficient: **the window's buffer updates synchronously in the renderer**, the edit is posted to main, and per-channel IPC ordering guarantees any later call observes it. So `DocumentWindow` is genuinely two-part — a renderer-side facade holding `text` and the span list, which is what keeps `toDocument`, `spansAt`, `snap`, `advance` and `distance` synchronous as declared, over a main-side authority.

**What would reopen this.** Main-process contention that a utility process cannot relieve, which would mean moving X to a utility process wholesale rather than back to a renderer.

## D38: Dates are assigned in a fixed reference zone, UTC−8

**Date:** 2026-08-14, amended 2026-09-02
**Status:** decided
**Detail:** `solution/format-spec.md`, `solution/day-boundary.md`

**Decision.** *(Amended twice. **D62**: the filing date is the **writing day**, which advances to the calendar date only once writing has stopped — so a passage typed at 00:30 files under the evening it was written in. **D63**: the zone is no longer fixed at UTC−8 but chosen by the person and kept with the notebook; the diagnosis below is right about local time and wrong about the remedy, because what fails is a zone that changes *itself*, not one that is local. UTC−8 remains what an unset notebook means.)* The `date` a passage is filed under is computed in a **fixed UTC−8**, never in the device's local zone. Times are *displayed* locally; only the filing date is fixed. The practice is borrowed from Google, where a single reference zone removed exactly this class of problem.

**Why it has to be fixed rather than local.** Dates are the stream's ordering axis, they are assigned automatically (R8), and re-dating is corruption (D9) — so the zone in which a date is computed is a **format decision v1 cannot revisit**. Local time fails twice over: fly to Zurich and today's file already exists under a different calendar date, and every device disagrees about which day a passage belongs to. A fixed offset also has no DST discontinuity, so no hour is ever doubled or skipped.

**Two consequences, stated rather than discovered.**

- **The day rolls at 00:00 PST, which is 01:00 local during PDT** — about eight months of the year. A note typed at 00:30 in summer files under the previous day. This is the trade a fixed offset buys and is correct, not a bug. *(D62 goes further in the same direction: a note typed at 00:30 files under the previous day whatever the season, if you were still writing at the time.)*
- **The choice of −8 specifically is about where the writing happens.** UTC−8 is nine hours behind CET, so a European working day from 09:00 to midnight maps entirely onto the same-numbered date; only writing before about 09:00 local falls back a day. Choosing a reference zone near the usual place of work is what keeps boundary oddities rare.

**What would reopen this.** Effectively nothing — the corpus accumulates under this rule and re-dating is corruption. A different reference zone would have to be applied going forward, not retroactively.

## D39: TypeScript, React and electron-vite; CodeMirror stays outside React

**Date:** 2026-08-14
**Status:** decided

**Decision.** TypeScript throughout. Z is **React**, built with **electron-vite**. Not Next.js — there is no SSR and no routing in a desktop app.

**Why React is safe here despite owning none of the important surface.** CodeMirror owns its own DOM and its own update cycle, so it is mounted once into a ref'd container and React never renders into that subtree. React therefore does nothing for the editing surface, which is the point: it earns its keep on the chrome — nav sections, filtered views, pickers, settings — where a component model genuinely helps. The typing path never enters reconciliation, so R1.1 is unaffected.

**One binding rule that prevents a specific bug.** Pane already exposes exactly the shape `useSyncExternalStore` wants — `onWindowChanged`, `onLocationChanged`, `onBoundaryChanged`. Bind to those directly. **Mirroring Pane state into React state would create a second source of truth**, which is the thing this design refuses everywhere else and would refuse here for the same reason.

electron-vite gives renderer HMR, which is worth having for the phase this build is entering — iterate on Z rapidly once X is trustworthy.

## D40: Extent is measured in screens, converted to characters — never in days

**Date:** 2026-08-16
**Status:** decided
**Amends:** D35 (`ExtentPolicy`), and `DocumentWindow.extend` in the locked `solution/document-api.md`
**Detail:** `solution/pane-api.md`

**Decision.** `ExtentPolicy` is denominated in **screens**, converted to characters at the moment of use by a rate measured from the editor, and bounded by a hard character ceiling. `DocumentWindow.extend(direction, chars?)` takes characters rather than days. A loaded region need not begin or end on a day boundary.

**Why days were wrong, and it is a safety problem rather than a matter of taste.** A day file holds between roughly 100 KB and the 1 MB split threshold — a tenfold range. So a fortnight is anywhere from 1.4 MB to 14 MB, and `target: days(14)` asks for an amount nobody can predict. Spike A measured flat cost at **1.05 MB and nothing above it has been tested**, which is precisely the untested region D36's deferral depends on staying out of. A day-denominated target walks into it on a heavy fortnight, silently, with no flag flipped. **The deferral and the unit were coupled and nobody noticed.**

**Why not characters as the unit a policy is written in.** Nobody scrolls back two hundred thousand characters; they scroll back *a bit*. A policy written in characters cannot be tuned by feel, and tuning by feel is exactly what Q7 says settles the extent question.

**Screens resolve both, and the measurement is already in the API.** `Pane.viewportChanged(visible)` carries `from` and `to` in buffer positions, so `to - from` **is** the character extent of one screenful. The rate therefore needs no layout knowledge, no font metrics and no second signal: it is measured continuously from something the editor already reports, and it adapts to window size, font size and content density for free. Sparse and dense screens are handled by clamping samples and smoothing, so one full-page figure — about forty characters — cannot convince the policy that a screen holds forty characters.

**`maxChars` is the part that must not be dropped in a later simplification.** It is the hard bound the screen arithmetic may never exceed, set to Spike A's measured-flat 1.05 MB, and it is what keeps the D36 deferral honest under any policy. Raise it alongside that measurement, never by feel.

**What it costs.** A window boundary may fall mid-day, so the "earlier ▲" affordance names the date of the earliest loaded position rather than a whole day loaded. This is free: positions are already `(segment, offset)` and `read` already widens markdown-aware, so partial segments were always expressible — only `ExtentPolicy` imposed whole-day granularity, and it imposed it by accident.

**What would reopen this.** The D36 measurement, which should revisit `maxChars` and may make a cap in screens meaningful where today it is null.

## D41: Themes are named parameter sets, stored in `config/` and chosen per device

**Date:** 2026-08-21
**Status:** decided
**Extends:** R1.3, R1.5
**Touches:** D3 (three native types), D7 and D30 (`.tephra/` is disposable)

**Decision.** The visual system is a **theme**: a named set of parameters covering the font stack, size, measure, leading, paragraph and blank-line spacing, per-script size adjustments, the annotation gutter, antialiasing and the full colour set. Themes are plain files in **`config/themes/`** inside the notebook — synced, durable, hand-editable. Which theme is **active** lives in `.tephra/ui-state.json` and is therefore per device.

**Why a system rather than a choice.** Four complete arrangements were built and all four were pleasant. That is not indecision, it is the same finding the project keeps reaching: *the instrument of record is the person using it*, and the honest way to settle a number is to live with it and change it. A single fixed rendering would force the choice at the moment we know least, which is now. R1.3 already asks for tunable; this makes it tunable **and saveable**, which is the difference between an experiment and a setting.

**Why `config/` and not `.tephra/`.** `.tephra/` is machine-local and disposable — deleting it must cost nothing but a rebuild (D7, D30). **A theme somebody crafted is authored work, and losing it on a new machine would be a real loss.** It therefore belongs in the synced tree, in plain files, for the same reason the corpus does (R26): the exit has to cover it.

**Why this does not break D3.** D3 says the directory holds three native *content* types and that everything else is external or embedded. A theme is neither content nor an attachment — it is application configuration, and `config/` names it as such rather than smuggling a fourth content type into the corpus. The test D3 actually protects is that nothing is *inferred from context*; a directory called `config` infers nothing.

**Why the active theme is machine-local.** Which rendering suits depends on the screen and the light in the room, and a phone in daylight wants something a desk at night does not. Definitions are authored and durable; selection is soft state. That is the same split already drawn for cursor position, and drawing it the same way twice is worth more than the small convenience of syncing a preference.

**One thing this pulls forward.** The annotation gutter is a theme parameter, and it must be **reserved in every theme from the start**. Marginal notes arrive in a later milestone, but a gutter that appears on that day reflows every line in the corpus — the failure the user named first and most emphatically. Reserving space costs nothing now and cannot be retrofitted quietly.

**Per-script sizing is part of the parameter set.** Hebrew reads uncomfortably small beside Latin at the same nominal size: its letters all sit at x-height, so the eye gets no size cue, and several differ only in fine detail. The mechanism needs no markup and no language tagging — a `@font-face` whose `unicode-range` covers one script, with `size-adjust` scaling it, so the rest of the stack falls through untouched. Measured at 122%: Hebrew glyphs grow by exactly that, Latin is unchanged.

**What would reopen this.** Sync arriving (v2a) may make an active-theme-per-device feel wrong rather than right; that is the moment to revisit, alongside the same open question D30 already carries about `ui-state.json`.


---

## D42: The frame is Reserved, with the capture stream summoned on demand

**Scope: desktop only, and deliberately.** `requirements.md` already grants that desktop and mobile need not share a UI stack, the contract between them being the file format. This decision spends that grant. Every argument below is about **horizontal budget** — nav, measure, gutter, stream, and which yields to which — and horizontal budget is a quantity a phone does not have. Nothing here should be read as constraining the mobile design, and the mobile design should not be derived from it. See the note at the end for what the mobile question actually is.

**Decision.** The window is **Reserved**: the nav can be dismissed, but its column stays, so nothing moves when it goes. A **capture stream** — the end of today, always ready to type into — can be opened beside the document, in a column whose width is reserved the same way. Its natural moment is when the main pane is showing something *other* than the head of today, which is exactly when jotting would otherwise cost a navigation.

**Why not Fixed rail.** Reserved is Fixed plus the ability to dismiss, at no cost to the guarantee. Dismissal is wanted; there is nothing to trade for it.

**Why not Overlay.** Overlay also keeps the guarantee, and by a defensible route — but the nav covers the text while open, and being able to see the nav and the document at once won on use.

**Why not Stream beside as its own arrangement.** It is not a rival to Reserved; it *is* Reserved plus a third column. Treating them as alternatives was a mistake in how the studies were framed, and it hid that the real question — does today get a privileged permanent column — is independent of how the nav behaves.

**The measured constraint, which is what makes this a decision rather than a preference.** The measure (54ch) plus the annotation gutter (19ch) plus the nav needs about 1211px of window before the gutter overflows. Opening a 300px stream needs about 1512px — a 14″ MacBook at full screen, by one pixel. So the stream cannot simply be granted:

- **The stream is the elastic member, never the gutter.** A capture surface is a few lines wide by nature; the gutter holds durable commentary (R27) and has a typographic width. The stream clamps between 210px and 300px and yields first.
- **Below the point where even 210px fits, the toggle is refused** rather than honoured destructively. A control that declines is better than one that silently narrows the measure.
- **Availability and width are one calculation.** The first attempt asked "does the minimum fit?" in one place and let a CSS clamp choose the actual width in another; at 1440px they disagreed, the check waved it through at 210px, the clamp took 288px, and the gutter went 58px off the edge. Two computations of the same quantity is the bug, not the arithmetic.

**A band that had no treatment at all.** Between 861px and 1210px the layout did not fit and nothing handled it — the collapse rule fired only at 860px, so the gutter simply hung off the right edge in *every* arrangement, with or without the stream. It now folds each note beneath its paragraph, ruled rather than floated: commentary stays legible and attached, and only its position is given up, which is the right thing to give up first.

**What this cost to learn, and the standing lesson.** The readout originally measured the text column's left edge alone, and on that evidence certified Stream beside as "steady" while its measure narrowed from 54ch to 36ch. A slow jump is still a jump. **An instrument that cannot see the failure it is pointed at is worse than no instrument**, because it converts an open question into a false answer — the third time in this project that the deciding evidence turned out to be something the instrumentation could not observe. The readout now watches position *and* width, and 75 width/arrangement combinations pass with the stream opened wherever it is offered.

**What the mobile question is instead, so it is not confused with this one.** At a phone's width the gutter cannot exist, so the question is not *which arrangement* but **what becomes of marginal commentary when there is no margin** — and, separately, whether the phone lands on capture or on reading. Those are different questions with different evidence, and the evidence has to be gathered on the device: the desktop studies worked because the arrangements could be reacted to at full size with a real pointer, and a phone layout judged in a narrow desktop window reproduces none of what makes a phone hard. **A mobile study is therefore a thing to open on the phone**, not a column in this sheet. R27 makes it more pressing than it was, since commentary is now durable content that a phone must at minimum be able to read.

### Amendment — the capture stream overlays; it is never refused

**Superseded above:** "the stream is the elastic member", "below the point where even 210px fits, the toggle is refused", and the availability arithmetic that went with them. The stream is now an **overlay pinned to the frame's right edge**, always available, at every width.

**What the refusal rule got wrong.** It was protecting the annotation gutter, which is right, but it confused two different harms. The invariant this frame exists to keep is that **nothing moves**. The gutter yielding would have meant *reflow* — every line rewrapping — which is unrecoverable and is the thing that makes text unreadable. **Occlusion is not reflow.** An overlay covers pixels, moves nothing, and closing it restores the page exactly. Trading a recoverable harm to avoid an unrecoverable one was correct; refusing the feature outright to avoid a recoverable one was not.

**And it failed the use it exists for.** The surface is for typing almost blindly while reading something else. With the measure at 74ch it needed a 1577px window, so on a 1512px laptop it was unavailable at *every* width the screen can produce — unreachable exactly where the use case is strongest, and available only at a desk with an external monitor, where the friction it removes is smallest.

**Why pinning it to the right edge removes a mode rather than adding one.** On a wide window the overlay lands on the slack that already sits right of the gutter and covers nothing; on a laptop it covers the gutter and possibly some text. There is no threshold, no branch, and nothing that behaves differently on either side of a width — one mechanism, whose visible effect happens to vary. `streamOcclusion` reports how much is covered, which drives the shadow (a panel over empty paper should not claim a depth it does not have) and the control's tooltip.

**What survives unchanged.** Reserved: the nav's column is spent whether or not the nav is drawn. The measure is a fixed track with the slack to its right. The gutter never yields *width*, and the fold below ~1211px is untouched. The text's left edge and its measure are now provably independent of the stream, since an overlay cannot reflow what is under it — measured in the app at 900, 1200, 1400, 1700 and 2000px, with the nav and the stream toggled at each.

**What would reopen this.** Living with it. Q7(c) asks whether the capture surface earns its width at all, and the honest test is whether the one-key jump to today proves frictional in practice. The frame decision does not depend on that answer — the stream is additive to a frame that already reserves its columns.

## D43: Storage is an interface; git is one implementation of it

**Date:** 2026-08-22
**Status:** decided
**Refines:** D32, D34

**Decision.** `Repository` is an interface describing what Tephra needs from
durable versioned storage — `save`, `versions`, `versionsTouching`,
`contentAt`, `moveTo`, `latest` — and `GitRepository` is one implementation of
it. The vocabulary is the app's: **versions**, not commits; **reasons**, not
messages; `VersionId`, not `oid`.

**Why the naming mattered enough to redo.** The first cut called the method
`commitAll` and returned a forty-character string. That is an API describing its
mechanism rather than its purpose, and the cost is not aesthetic: the moment the
interface says *commit*, every layer above starts thinking in git, and the
choice of git stops being a decision and becomes an assumption. **D34 already
schedules a revisit at v2a, and that revisit is only cheap if the seam exists
before it is needed.**

**`moveTo(target)` takes `'latest'` as a magic target**, which is the case that
made the gap obvious: a second machine opening a notebook it has just received
wants the tip of the line and does not know a single version id. Resolving
`'latest'` to the branch rather than to HEAD is also what makes it correct after
a move to an earlier version, when HEAD is exactly the wrong answer.

**What did not change.** The store is still the notebook directory itself, still
readable by standard `git`, still verified as such in the tests. This is a
renaming and a seam, not a redesign — but it is the difference between "we chose
git" and "we assumed git".

### Three refinements from the same review

**Versions are a TREE, not a list.** `versions()` walks *ancestry* from a point;
it does not enumerate everything saved. Once branching exists there will be
versions no walk from `'latest'` ever reaches, and code written against "all
versions newest first" would look correct until the first branch existed. The
signature now takes the point to walk back from — `versions(from = 'latest')` —
so the linearity is visibly a property of the walk rather than of the store.

**Branching and merging belong to this interface**, and are documented in it
without being built. They are operations on the version tree, and the tree is
what this interface exists to own; a merge implemented above the seam would
require the layer above to understand how versions relate, which is precisely
the knowledge the seam contains. **The division of labour on merging is already
decided**: the *deep* part — three-way reconciliation, and append-union for day
files — is storage's, while the *policy* is not, because D12 says divergence is
surfaced and never auto-resolved. `merge` will report an outcome; it will never
decide what the reader meant. v2a work.

**The leak had spread past the store.** `DocumentService.commitNow`,
`#scheduleCommit`, `COMMIT_QUIESCE_MS` and the rest were the same mistake one
layer up — the *service* does not commit, it **records a version**, and the word
"commit" is one store's name for how. Renamed to `saveVersion`, `#scheduleVersion`,
`VERSION_QUIESCE_MS`; `#message()` became `#reason()`, matching the store's own
vocabulary. Renaming an interface without renaming its callers leaves the leak
in place and merely moves it.

**The fourth correction in one sitting, all the same shape.** A tracked-path set
that a measurement dissolved; a hand-rolled hash comparison that
`git add -A` dissolved; and now an API shaped like its implementation. Each was
found by someone asking why the code did not look like the obvious thing.
**The obvious thing is the null hypothesis, and departing from it needs a
reason that has been checked.**

## D44: Tephra's markers are annotations, not text — the buffer carries prose only

**Date:** 2026-08-23
**Status:** decided

**Decision.** A marker's bytes never reach the editor's buffer. The window hands
Z **prose**, plus the typed spans it already reports; the marks and the extent
of a tagged range are drawn from those spans. The file is unchanged — markers
are still HTML comments in the text, exactly as format-spec describes.

**Why, having tried the other thing first.** Markers were widgets over their own
document text, revealed when the caret came near. That produced, in order of
discovery: a line that reflowed by twenty-five characters every time the caret
passed a tag, which is D42's guarantee broken inside the line; comment
syntax on screen at exactly the moment a tag was applied, since the selection is
by definition touching it; markers carried into the clipboard by an ordinary
copy, where pasting one produced an unmatched `tag-start` that swallows the rest
of a day; and an ordinary deletion able to orphan a marker, with the same
consequence. Each has a patch. None of the patches is *reasons*, and they
compound.

**And one that has no patch.** Inline widgets are marked atomic, but
`@replit/codemirror-vim` does its own offset arithmetic and never consults
`atomicRanges` — measured in the M0 spike and recorded at the top of
`widgets.ts`. With vim on, the caret walks *inside* a hidden comment and `x`
cuts a character out of it. Unrendering under the cursor exists partly to make
that survivable. Markers that are not in the buffer cannot be walked into.

**The line this draws.** Tephra's syntax is not text; markdown is. Asterisks are
something a person types and may want to edit, so they stay, and Q11 remains
open about them. `<!--tephra:tag-start …-->` is machine syntax nobody should
ever edit by hand — the operation to remove a tag is a command, not a text edit
— so it leaves. Raw mode still shows the bytes, because that is a view of the
file rather than a place to write.

**A marker has a prose width, and this is what makes the gesture work.** A
marker that is a *handle* — a bookmark, the start of a tagged range — occupies
**one** character of prose, drawn as a small mark. A marker that is only a
*boundary* — the end of a tagged range — occupies **none** and cannot be
addressed at all: the caret never lands on it and no keystroke can reach it,
because the underline already shows where the range ends and a second glyph
would be redundant twice over.

So the handle **is a character**, in the buffer, for motion, selection and
deletion — not a widget pretending to be one. Which means the removal gesture
lives in the WINDOW, not in a keymap: an edit that removes a handle is turned
into `untag` or `removeAnchor` rather than applied as text. Backspace, `x`,
`dd`, a selection dragged over it and overtyped, and any keymap that arrives
later all get the gesture for free, and vim gets it identically because vim sees
exactly one character where the mark is.

**Generalisable, which is the reason to build it as its own layer.** Comments
(R27) want the same treatment: an anchor in the prose that is a handle, a body
that is not text. Building the prose/raw mapping as a tested object of its own
means comments inherit it rather than re-inventing it.

**Cost, stated plainly.** `StreamWindow` gains a coordinate mapping in both
directions, and every edit crossing a marker has to map through it correctly.
That is where the bugs will be, so it is built and tested on its own before
anything is drawn on top of it.

## D45: A window's announcement carries its whole state; edits say how the text moved, not whether anything moved

**Date:** 2026-08-23
**Status:** decided

**Decision.** Every change touching a window produces **exactly one
announcement**, carrying the window's complete state — text, generation, spans,
placement, boundaries. The edit list describes *how the text got from the old
state to the new one*. It is not a signal about whether the announcement is
worth sending, and an empty list is a legitimate, meaningful message.

Recipients hold a mirror and are responsible for noticing what changed in it.
They may not infer "nothing changed" from "no edits".

**Why this needed saying.** Four bugs in one milestone, all the same shape, each
looking different enough to be fixed on its own terms:

| symptom | what was actually wrong |
|---|---|
| tag underlines drawn in the wrong place | the renderer recomputed the mapping instead of sharing it |
| underline outlived the tag it belonged to | the acknowledgement replaced the spans silently |
| a day loaded by growth showed raw markers | growth sent bytes where prose was owed |
| a renamed tag kept its old name in the UI | **no announcement at all**, because the prose was identical |

The last one is the clearest. Renaming a span rewrites marker *names*, which are
invisible in prose — same handle, same character, identical buffer — so the diff
came back null and an early return sent nothing. The file was correct and the
renderer went on reporting the old subject when its mark was clicked.

**The underlying error is treating derived state as a side effect of text.** The
renderer holds four things that main also holds, and three of them were being
refreshed only when the fourth happened to change. That is not a bug in any one
of them; it is a rule that was never stated, so nothing could be checked against
it.

**What this costs.** Nothing on the typing path: a window is never told about a
change it originated (echo suppression), so ordinary typing does not reach this
path at all. Changes that do reach it — an operation, an undo, an external edit
— happen a few times an hour, and an announcement carrying no edits is a
no-op for the buffer and a no-op for the span comparison.

**The stronger version of this, not yet taken.** The mirror could be one value
sent whole rather than five fields updated in step, which would make a partial
update unrepresentable instead of merely forbidden. That is a larger change than
this milestone wants, and the rule above is what makes it unnecessary for now —
but if a fifth instance appears, the answer is the type, not another fix.

## D46: A second notebook whose storage is shreddable, with per-file keys

**Date:** 2026-08-23
**Status:** decided
**Answers:** Q12
**Refines:** D43, D32, D7, D8
**Deliberately gives up:** cross-device access and hand-editing, for this notebook only

**Decision.** Tephra opens more than one notebook. The primary one is unchanged —
git-backed, rewindable, plain files, hand-editable. A second **shreddable**
notebook holds writing that must be genuinely deletable: the same app, the same
editor, the same typography, and different storage underneath. Its files are
**encrypted at rest under per-file keys held in the system keychain**, so
deleting content destroys a key rather than overwriting bytes. It keeps no
version history and no write-ahead log.

*The name `shreddable` is provisional. "Ephemeral" was rejected because it
conflates duration with deletability, and nothing here expires on its own —
content stays exactly as long as it is left alone.*

### Why a second notebook rather than a protected class inside one

A class distinction inside the corpus has to be enforced by every mechanism that
can cross it — tags over ranges, fileset entries, anchors, search, the index —
and each of those is a separate place to get it wrong. A second notebook makes
the boundary **a directory**, which is the coarsest and most verifiable boundary
available and one the OS, git and the backup software already understand. It
deletes the entire in-corpus classification design rather than implementing it.

**The zero-routing requirement does not block this, and the reason matters.**
That requirement was derived from routing *by subject*, which `problem.md` shows
is intolerable because subject is **retrospective** — the realisation that a
passage belongs to project X arrives after writing it. **Sensitivity is
prospective**: it is known before the session starts, there are two destinations
rather than seven, and the decision is made once on opening rather than per
passage. The premise does not transfer, and the requirement should not be cited
against this at its original strength.

### Why crypto-shredding rather than secure deletion

**Overwrite-based erasure does not work on this hardware.** Wear levelling and
over-provisioning mean a logical overwrite need not touch the physical page;
APFS is copy-on-write, so a rewrite orphans the old blocks rather than replacing
them; and local snapshots pin exactly those orphans. Apple withdrew Secure Empty
Trash and `srm` rather than keep shipping a guarantee they could not make.

Deletion is not an operation on data — it is an operation on **every copy** of
the data, and the hard part is enumerating the copy set. Locally that set spans
the file, snapshots, Time Machine, Spotlight, swap and the raw NAND, and the
application cannot enumerate it. **Crypto-shredding makes the enumeration
problem irrelevant instead of solving it**: destroy the key and every copy
becomes noise, wherever it is and however many there are. This is the same
technique, and the same reasoning, that large-scale storage systems use to make
deletion a binding commitment.

### Why per-file keys rather than one volume key

An encrypted volume was the cheaper first proposal and was rejected on
granularity: one key means the only available deletion is *shred everything*.
The product this needs is deletion of **individual days and individual files**,
manually or eventually on a schedule.

So each file carries its own data key, wrapped by a master key in the keychain.
Shredding a file deletes its key entry and unlinks the ciphertext. **The key
table must never be a plain file that gets rewritten in place**, because that
recurses the original problem onto a smaller file; keys live in the keychain,
where destruction is the OS's job and is hardware-backed.

### Finer granularity comes free from an existing mechanism

**Splitting a day is already built** — M1 ships prefix-stable splitting at 1 MB,
`part:` in frontmatter, and D20's rule that adjacent parts coalesce above the
storage layer so the split is invisible to the API. Making "split here" an
**explicit authored action** as well as a length-triggered one therefore adds a
trigger, not a mechanism, and it buys deletion granularity finer than a day.

The split point becomes a marker in the text rather than a computed boundary,
which is *more* prefix-stable than the current rule and consistent with D11 —
it travels with the text instead of being an offset.

### Encryption is a wrapper at the W boundary, not a second wire format

**The format does not fork.** The markdown, the frontmatter, the markers and the
degradation table are all unchanged; only the bytes at rest are transformed. So
this is an encrypting variant of `Notebook.read`/`write` at the bottom of W, and
**nothing above W changes at all** — X and Z cannot tell the difference.

This matters for scope. Treating encryption as a parallel `Document` storage
implementation would produce a 2×2 matrix against the existing
segmented/single-file split; a wrapper keeps the two concerns orthogonal. It
also makes the export path trivial, because decrypting yields exactly the
ordinary format.

**Two existing rules pay off here.** D43's `Repository` interface means "no
history" is a null implementation rather than surgery. And architecture.md's
rule 4 — *search is an X-level component, never a W-level scan* — is what lets
search work over encrypted files at all: it reads through the Document API,
which decrypts, rather than grepping the directory, which could not.

### Filenames leak the shape of the corpus, so they change

Encrypting contents while leaving `stream/2026/08/2026-08-21.md` in place
discloses which days have writing, how much, and — through gaps after a shred —
that something was deleted and roughly when. **In the shreddable notebook,
filenames are opaque** and the date moves inside the encrypted frontmatter.
Enumeration costs an index, which is acceptable because this notebook is small
by construction.

### What is deliberately given up, and by choice rather than by accident

**Cross-device access.** Remote storage unlocks two independent things —
rewindable history and multi-device sync — and this notebook wants neither the
first nor, for now, the second. It is desktop-only and single-machine. **This is
a real loss, accepted explicitly**, and it is the reason the primary notebook
remains where most writing happens.

**It is also likely temporary, and this choice makes it cheaper rather than
dearer.** Per-file encryption is precisely the construction end-to-end sync
needs: ciphertext can rest on a hub that is not trusted, and only key material
requires a trusted channel. Choosing this today moves E2E sync closer.

**Hand-editing, and part of the exit.** R26 requires the archive stay readable
without the tool — but **this notebook is definitionally not the archive**, so
the requirement it trades away was never load-bearing here. The exit is still
owed in spirit: a decrypt-and-export command must exist, so that "encrypted"
never means "hostage".

### Deferred: automatic expiry

TTL deletion is *not* built now. Its failure mode is losing something that
mattered, silently and by design, and Q3 already decided that review rhythms are
found by living with them rather than designed up front. File-level granularity
makes a future rule comprehensible — *"days older than N are shredded"* — so
nothing is foreclosed. Manual deletion first.

### The risk that most needs managing

**The app is engineered to make the writer stop thinking about saving** — R1.2
treats any moment of "I should save this carefully" as a defect. A second
notebook wearing that same interface inherits the trust and removes the
guarantee. The mitigation is not a dialog, which is read once: the shreddable
notebook must be **continuously and unmistakably different to look at**, which
D41's per-notebook parameter sets already make cheap.

### Reconsideration triggers

- **Before sync is designed (v2a).** If E2E sync lands, the cross-device
  sacrifice above should be revisited — the architecture was chosen to permit it.
- **If manual deletion proves too frictional in use**, which is the evidence that
  would promote TTL.
- **If the shreddable notebook starts holding the majority of real writing.**
  That would mean the primary notebook is failing at something, and the answer is
  probably not more shreddable storage.
- **If keychain-backed key destruction turns out not to be verifiable.** The
  whole construction rests on it, and per this project's standing rule, it must
  be **broken on purpose and seen to report the failure** before it is trusted.

### Where it is built

**M6, after M5 — by choice rather than by dependency.** Because encryption sits
at the bottom of W, nothing above it changes and nothing else in the plan waits
on it; it could move earlier, later, or past v2 at no cost to anything else.
The design is `solution/shreddable-notebook.md`.

**It passes the deferral rule** (`goal/scope.md`: *data cannot be backfilled;
mechanisms can be deferred*). The notebook is a new directory with its own
storage, so it needs nothing recorded in the primary corpus beforehand, and the
one format addition — the explicit split marker — applies to files that will not
exist until it does. **No coverage obligation falls on M0–M5**, which is what
makes this deferral safe rather than merely convenient.

The interim policy is unchanged: material that must be genuinely deletable goes
to paper or the typewriter until this exists.

### What this makes stale

Updated already: `goal/scope.md` (the one-directory rule),
`solution/format-spec.md` (layout and filenames), `solution/milestones.md` (M6),
and `Q12`, which this answers.

Still owed, and safely deferrable to M6 since nothing before then depends on
them: `goal/requirements.md` (R26's reach, and the zero-routing framing recorded
above) and `solution/architecture.md` (the W wrapper, and a trust boundary that
now has a second shape).

## D47: Comments are a range-anchored thread whose body is content, and is not in the buffer

**Date:** 2026-08-23, revised 2026-08-24
**Status:** decided
**Answers:** Q8; dissolves Q9; constrains Q11
**Detail:** `solution/comments.md`

**Decision.** A comment is a **thread anchored to a range** by a marker pair
carrying a short file-local id. Its **body is ordinary markdown in the same
file** — plain blockquotes with a parseable byline, placed immediately after the
block containing the closing marker — and is **elided from the editor's prose**
exactly as markers are (D44), so the editor never holds it and the margin renders
it. `SpanKind` gains `'comment'`.

### The line that decides the encoding

**The anchor is bookkeeping and stays hidden; the body is content and stays
visible.** HTML-comment markers are right for anchors because a plain reader
loses nothing by not seeing one. R27 argues the opposite about commentary —
*commentary is durable content, and R26 applies to it exactly as it does to the
base text* — so encoding a thread in an HTML comment would make the one part of
the document invisible to every markdown renderer be precisely the part just
argued to be as much the document as the text. That is a contradiction rather
than a tradeoff.

### And the line D44 draws, sharpened

The first version of this decision put the body **in the editor's buffer**, and
left "how is a comment body edited" open in consequence: a block hidden mid-prose
and revealed by moving the cursor into it, which reflows the text the note is
anchored beside. That is Q11's complaint landing on the construct least able to
afford it.

D44 says *Tephra's syntax is not text; markdown is.* Commentary sharpens it:
**what is not the passage is not in the passage's buffer.** A gloss is durable,
printable, readable content and is still not part of the text it glosses. The
file is unchanged by this — R26 and R27 are about the file — and three things
follow: the open question disappears, nothing reflows, and `ProseMap` already
does the work, since a comment block is a marker of width 0 that happens to be
two hundred characters long.

### The body is a blockquote, not a callout

`> [!comment id]` renders as a styled box in Obsidian and GitHub and as the
literal text `[!comment id]` everywhere else. A blockquote with a byline reads
correctly in **every** renderer and never shows a machine token to a human, which
is what the Talmudic arrangement is asking for. The id lives in an HTML comment
at the END of the byline — not the start, because a comment beginning a block
turns the block into an HTML block and kills its formatting.

**One representation of every fact.** The byline is what a person reads *and*
what Tephra parses; a human line plus parallel machine attributes would be the
fault this codebase met four times in M2 (D45). Unrecognised tokens are preserved
verbatim, which is what lets the grammar grow without a format break.

**Ids are short random tokens rather than counters**, because a counter collides
the first time a commented range is pasted between files.

### Reactions are an ordered map from emoji to reactors

Not a list of emoji. **The view is the common case and the edit is the rare
one** — rendering wants `👍 ×3` with the names available, which a flat list makes
you group first, and a grouping computed in the renderer is a derived value that
will be computed in two places as soon as there are two renderers. Finding your
own reaction in order to toggle it is far rarer, and is a scan over three keys.

**Order is content.** People spell things with emoji: three in a row are a
sentence, not a set. So insertion order is preserved in the file (left to right
along the byline) and in the API — a plain object, since JavaScript preserves
insertion order for string keys that are not array indices, which emoji never
are, and unlike a `Map` it survives JSON and both IPC hops.

### Author, assignee and reactions are built, not reserved

The earlier version reserved them: a single user with two devices needs none of
them, which is true and beside the point. **They are cheap now and expensive
later** — one token each in a line already being parsed and written — and
deferring buys a second pass over the same grammar, a migration for files written
in between, and a UI built twice.

### The API knows about threads, and can edit

`SpanKind` gains a member; it is a union in this codebase, not a contract with
anyone else. **`MarkerKind` (formerly `RawSpanKind`) stays separate**, because
the two are different vocabularies rather than raw and cooked forms of one: the
scanner finds a `tag-start` and a `tag-end`, the API exposes one span, and
`SpanKind` also contains `date`, which no marker produces. The name was the whole
problem and is fixed.

Seven operations — start, add, edit, delete, resolve, assign, react — each
compiling to one `replace()` and therefore one undo step. **`editComment` exists**,
and the earlier argument that it need not — the body is prose in the buffer,
so it is edited like any prose — was true only while the body was in the buffer.

### Editing happens where the note is rendered

In the rail on the desktop, in the expanded box on the phone. **This is the same
complaint as reflow in a different register:** reflow is bad because the text
moves under the eye, and relocating a construct to edit it is bad because the eye
must move to reach it. The cost is identical — you lose your place.

Stated generally, since it is not about comments: **a construct is edited where it
is rendered.** That is a constraint on any answer to Q11, and it eliminates the
whole family of answers that reveal markup somewhere other than where the
rendered form sits.

### Printing is an option, and the question is not only about comments

Every piece of apparatus Tephra adds — tags, bookmarks, comments — carries the
same question to the printer, and the answer is a choice made when printing
rather than one made once in the code. For comments it is three-way: **without**
(the passage alone), **in the margin** (the Talmudic page, which narrows the
measure and is therefore a second layout rather than a stylesheet toggle), or
**inline** (each note after the block it is anchored to — the arrangement the
folded gutter and the mobile open-all state already produce, so it is nearly
free). Tephra's print dialog therefore has to be Tephra's own, which is a further
argument for the PDF-preview route M2.4 took.

### Q9 is dissolved rather than answered

Q9 asked whether an imported base text stays pristine, and was recorded as
deciding Q8 in favour of a sidecar. **The premise is wrong: for an imported
document the pristine artifact is the original file, not the conversion.** A
`.docx` or `.pdf` rendered to markdown is already lossy and derived, so freezing
it protects nothing.

**Uniform rule:** import stores the original untouched in `attachments/` and
creates an annotatable markdown copy. This removes the sidecar's only real
argument, and Q8 resolves to inline.

### What this reuses rather than adds

`comment-start` is a handle (width 1), `comment-end` a boundary (0), the thread
block width 0 — so `partnerRemovals()` supplies the removal gesture with no
keymap, `ProseMap.carve()` protects the boundary, `HandleWidget` is the template
for the mark, and `tagExtents` for the range rule. The rail draws over the
**already reserved** gutter band, so D42 holds by construction; `gutterFits`
computes the narrow fold; Q10 settled the mobile arrangement.

### Reconsideration triggers

- **If partial overlap never occurs in a year's use**, the ids buy nothing and
  nesting becomes the cheaper design.
- **If bodies routinely grow long enough to dominate the file**, the sidecar
  argument returns on different grounds — readability of the raw text rather
  than pristineness.
- **If margin printing proves to be the one people always want**, the measure
  should narrow for it by default rather than on request.

### What this makes stale

`solution/format-spec.md` (marker verbs, the degradation table), 
`solution/document-api.md` (`SpanKind`, `TypedSpan`, the comment methods),
`goal/open-questions.md` (Q8 answered, Q9 dissolved, Q11 constrained),
`solution/milestones.md` (M2 items 5–7).

---

## D48: Every layer has its own branded text and coordinate types, and the names say which layer

**Date:** 2026-08-25
**Status:** decided
**Detail:** the layer map at the top of `src/shared/document-api.ts`

**Decision.** Where two things are semantically related, of the same wire type,
and belong to different logical layers — the document's text and the prose a
person edits; an offset into a segment and a position in a window — **they get
different branded types, and the only way between them is a named conversion
function.** No layer's value may be assigned into another's, and no cast may
stand in for a conversion.

**The names follow the layers, in two axes.** A text type says which CONTENT it
is; an offset type says which content it indexes and at what SCOPE:

|  | document — markers present | prose — handles instead |
|---|---|---|
| in one segment | `DocumentOffset` → `DocumentText` | `ProseOffset` → `ProseText` |
| across a window | *never exists* | `WindowPosition` → `ProseText` |

The empty cell is a design property rather than an omission: a window never
holds document text, because markers are not text (D44). And `Position` versus
`Offset` is the other half of the rule — a Position is a COMPLETE address at its
layer, an Offset is one component of one, which is why a `DocumentPosition`
carries a segment key and a generation beside its offset and a `WindowPosition`
is a bare number.

### Why, in the only currency that counts here

Every one of these layers is "a string and a number" at runtime, so a mistake
between two of them is invisible to the compiler, invisible to a reader, and
invisible to any test written against text with no markers — which is most text
while a feature is being built. Five bugs in M2 were exactly this:

- growth handed the editor a segment's **body** where prose was owed, putting
  `<!--tephra:…-->` on screen;
- a change announcement handed it the document's **payload**, the same way;
- `RemoteWindow.toDocument` subtracted a segment start from a window position
  and returned it as a document offset, so tagging a phrase wrote its markers
  twenty-seven characters early;
- `extend` inserted a segment's body rather than its prose;
- `StreamWindow.spans()` mapped a second time over an already-mapped list.

All five compiled. All five would have been type errors under this rule, and
three of them were found only by a person looking at the screen.

### What it costs, and why that is the right trade

A brand makes literals inconvenient: a test that wants document text must say
so, and `tests/support/text.ts` exists for exactly that. That inconvenience is
the mechanism working — the place where a plain string becomes a layer's value
is a claim, and the rule forces it to be written down where someone can check it.

### What it reverses, deliberately

**D39 rejected `WindowPosition`** on the ground that in an Electron codebase it
reads as *screen coordinates* — an active hazard, not a mere ambiguity — and
chose `BufferPosition` because "buffer" is the standard word for loaded editor
text. That reasoning was sound when the layers were three deep and unnamed. Two
things changed it:

- **"Buffer" turned out to name the layer above, not this one.** The editor's
  buffer is CodeMirror's, and once the editor became a layer with coordinates of
  its own — pixels, a height map, widgets with no address below — using its word
  for the window's coordinate was the exact confusion this rule exists to stop.
- **The screen-coordinate hazard never materialised, and now cannot.** The OS
  window appears in this codebase only as Electron's `BrowserWindow`, in main,
  and nothing anywhere carries a screen position as a type. The layer map at the
  top of `document-api.ts` says what "window" means here, in the one place a
  reader looks it up.

If the hazard ever does appear — a saved window geometry, a multi-monitor
placement — the answer is to name that type after the screen, not to give this
one the editor's word back.

### The rule generalises past text

It applies to any two logical layers with different coordinates and the same
wire type — a version id and a session generation (already D33), a file path and
a document id, a pixel and a position. When a new pair appears, brand it before
the first bug rather than after the third.

### What this makes stale

`solution/document-api.md` (every coordinate name, the three-coordinate table).

---

## D49: Layout may not change during a pointer gesture, and space that must be counted lives inside the box

**Date:** 2026-08-25
**Status:** decided
**Detail:** `solution/implementation-notes.md`, "A block widget's margins are not measured"

**Decision.** Two rules about the editor layer, both learned the same way:

1. **Nothing may add, remove or resize a decoration while a pointer gesture is
   in progress.** A reveal, a widget swap, a growth-driven prepend: if it
   changes where anything is drawn, it waits for the gesture to end.
2. **Any space the editor must account for goes inside the measured box** —
   `padding`, never `margin`, on a block widget.

**And the property is asserted, not merely believed**: `npm run m2` measures
`posAtCoords(coordsAtPos(p)) === p` across every rendered position outside an
atomic range, and that the append position is on screen once the region settles.

### Why these two and not a longer list

CodeMirror answers "where is this position" two ways: `coordsAtPos` measures the
DOM, `posAtCoords` consults the height map. Everything in this family is those
two disagreeing. A margin on the day seam put them a line apart for the whole
document below it, so a press inside a URL selected the row beneath; a decoration
appearing mid-drag moved the text out from under the pointer, which is the same
disagreement introduced deliberately.

Neither is a bug in the editor. Both are the consequence of treating a layer's
geometry as if it were the layer below's coordinates — D48 applied to pixels,
where the compiler cannot help because pixels are not our type to brand.

---

## D50: Prose is the document as displayed — text and annotations, with one presentation policy over it

**Date:** 2026-08-26, revised 2026-08-26
**Status:** decided
**Constrains:** Q11; raises Q13 and Q14
**Detail:** `solution/prose.md`

**Decision.** **`Prose` is one value: the text a person sees, and every
annotation anchored into it.** The annotations are a single union — a day, a
heading, a bookmark, a tagged range, a comment thread — carrying their payloads,
in prose coordinates, generic over which prose (`Prose<ProseOffset>` for a
segment, `Prose<WindowPosition>` for a window).

**REVISED, one day in: the map is not part of it.** As first written this said
Prose was text, map and annotations. Implementing the window found that wrong. A
`ProseMap` relates ONE prose to ONE document text, so it belongs to whatever
owns both — a `Segment` does, and a **window does not**: a window is several
segments joined, and on the document side there is no single string to map to,
because a document position is segment + offset (D48). A `map` field on a
window's prose could only have been a lie (one segment's map standing for all,
which is the tag-27-characters-early bug in new clothes), a fake (a map into an
offset space that does not exist), or dead. So `Prose` is `{ text, annotations }`
at both scopes, `SegmentProse` adds the map where a map is meaningful, and the
window crosses to the document through its placement, as it always did.

Two things confirm it rather than merely permitting it: **nothing downstream
missed the map** — the printer never converts a coordinate and the renderer
builds its own from the markers in the snapshot — and removing it deleted the
`ProseWire`/`toWire`/`fromWire` machinery whole, which existed only because
`ProseMap` is a class and structured clone drops prototypes. With the map out,
prose crosses a process boundary as itself.

The general lesson is D48's, pointed at a value rather than a name: **a map
between two layers is not part of either layer.** It belongs to the thing that
holds both sides.

**How it is drawn is a policy, not a feature.** A `Presentation` names a
treatment per kind — a day is `absent | seam | pageHeader`, a comment is
`absent | inline | margin | footnote | endOfSection` — and `place(prose, how)`
turns annotations into slots. **Screen and paper share the placement and not the
drawing**, which is the right seam: a CodeMirror decoration and an `<aside>`
have nothing in common, but *which annotations go in the margin, which become
notes, and how notes are numbered* is one decision.

### The evidence, which was already written down

The layer map in `document-api.ts` says of a window: **"THREE THINGS TRAVEL, and
only the first is text"** — text, mapping, meaning. Three values, assembled
together everywhere, meaningful apart nowhere. That is an unnamed struct, and
the cost arrived the first time something outside the editor asked for the
document: `proseIn`, written for printing, drops every annotation, because
dropping them was the only thing the shape allowed.

### What it unifies that had drifted apart

Comments have a rail, tags have an underline, days have a block widget, and none
of that was decided — three mechanisms grew a fortnight apart. Under one policy,
**desktop and mobile are the same renderer with different defaults** (D42's
reserved gutter is what a margin treatment needs; Q10's mobile arrangement is
the inline one), and printing is that same policy with a third default.

### Two mechanisms this settles

- **Footnotes in print use `paged.js`.** Chromium's print path has no CSS
  footnotes, and a note at the foot of *the page its anchor fell on* requires
  knowing where pages break. It is confined to the print path — the editor never
  loads it.
- **The on-screen cousin of a footnote is `endOfSection`**, notes closing the
  day. A scrolling document has no page to sit at the foot of, so a screen asked
  for `foot` falls back to it. Endnotes for a whole document are not on the list.

### What is genuinely hard, and stays hard

Margin annotations collide and need the rail's stacking rather than a second
implementation of it; a tag in the margin is a RANGE and needs a rule with an
extent, not a note aligned to a line; and no treatment carries every payload — a
thread in a footnote cannot show its reactions or its assignee. **What a
treatment drops belongs in the design, not in the discovery on paper.**

### Reconsideration triggers

- **If paged.js proves heavier than footnotes are worth**, `endOfSection` is
  already the fallback and the policy needs no change.
- **If a fifth annotation kind does not fit the union**, the union is wrong
  rather than the kind, and this is the moment to find out.

### What this makes stale

`solution/document-api.md` (the window's three parallel values), 
`solution/comments.md` (the rail as a comment-specific mechanism),
`solution/marker-roadmap.md` (tags as an inline-only treatment).

---

## D51: Every row in the sidebar names a set of places, and clicking one goes to the next

**Date:** 2026-08-26
**Status:** decided
**Detail:** `solution/navigation.md`
**Builds on:** D10 (sections), D11 (reference by identity), D50 (annotations)

**Decision.** The left nav is a list of rows, and **a row names a set of places
in the corpus. Clicking it goes to the next one, wrapping.** A bookmark's set has
one element; a day's has one; a heading's has one; a subject's has as many as it
has been applied to. There is no second interaction and no row where a click
means something other than *take me there*.

A set with more than one element earns **apparatus, not a different verb**: the
active row shows `3 of 7`, gets `◂ ▸`, and marks its occurrences in the scroll
track. Clicking it again is `▸`. **At most one row is active**, and it owns all
three of those.

**Headings become ranges** — to the next heading of equal or greater precedence,
or the end of the day — which makes days and headings one containment tree and
lets the outline highlight a section exactly as a subject does. That is a change
to `Segment.spans()`, not a new mechanism.

**The built-in sections are Outline, Subjects, Bookmarks and Comments**, plus
`Where you are`: the annotations covering the caret, which `spansAt` already
answers and which is the line a person looks at most.

### Why one verb, and what the first draft got wrong

The first draft had clicking a PLACE go to it and clicking a SET reveal
controls. It fails the plainest test there is: **a person cannot tell, before
clicking, which kind of row they are looking at.** Counting instead of branching
removes the distinction from the interaction and leaves it where it belongs — in
what the row shows about itself.

### What this makes pinning

A **`Reference` is an annotation's identity without its location** — D11 as a
type. A curated section is an ordered list of references, which is what D10
already said a fileset index is; and **a pinned row and a built-in row are the
same row**, because both resolve into a set of places and both have the one verb.
Pinning becomes copying a reference into a list: no new rendering, no second
interaction, no second code path to keep in step.

### Left to use rather than to argument

The order subjects are listed in, how much outline is open by default, and what
the view filter offers are all **late-bound on purpose** (`navigation.md`). Each
is a guess until there is a sidebar over a real corpus, and a wrong guess in a
decision record is harder to undo than a wrong default in a component.

---

## D52: The corpus has a span index; it is a cache of the scan, and never a source of truth

**Date:** 2026-08-26
**Status:** decided
**Revises:** D7 (an index was a v3 concern)
**Detail:** `solution/navigation.md`

**Decision.** A machine-local **index of spans over the whole corpus**, so that
corpus-wide questions stop being answered by loading every segment. It is
**keyed by file and mirrors the corpus's directory tree — one index file per
directory** — with `size` and `mtime` as the staleness check, so verifying it is
one `stat` per file and no reads.

**It is a cache. Deleting `.tephra/index` must cost nothing but time**, and that
is the test the implementation has to pass. The files are authoritative (D23,
Q2); any disagreement is settled by rescanning.

**It indexes spans, not text.** Retrieval (M4) wants a text index, which is a
different structure with different tradeoffs; building one here because we happen
to be walking the files would be the fancy answer to a problem nobody has yet.

### Why now, when D7 said v3

**The sidebar is the first feature that cannot work without it.**
`Document.spans()` answers about the corpus by loading every segment and
scanning it — instant at a fortnight, a gigabyte through memory at twenty years
(D8's measured scale). D7's estimate was not wrong about when scanning stops
being instant; it was wrong about which feature would arrive first.

### The two rules that keep it honest

- **A loaded segment answers for itself; the index answers for everything else**,
  and the document prefers memory. Without this the sidebar lags the flush, and a
  subject applied thirty seconds ago is missing from the list of subjects — which
  reads as a bug in tagging rather than as a stale cache.
- **`Segment.spans()` always scans**, and is what the builder calls. So no caller
  ever asks the document to please not use its cache: the layer that has no cache
  is the layer the builder talks to. A consistency check is a different question
  and gets its own name, `verify()`.

### One entry point for repair

`rebuild(under?)` builds from a fresh scan and swaps it in, a directory at a time,
each written to a temporary file and renamed over its predecessor. Because every
entry carries its own stamp, **a half-finished rebuild is incomplete and never
wrong** — which is what makes it safe to run in the background at any moment: on
open, on a timer, after a history restore (D32 rewrites whole days), after crash
recovery, when a month fails to parse, and when a person asks. **A cache with no
visible repair becomes folklore.**

It is chunked and yields, because the writing path may not stutter (R1.1), and it
skips days that are loaded and dirty, which answer from memory anyway.

### What this makes stale

`solution/document-api.md` (`spans()` is no longer a scan), 
`decisions.md` D7 (the timing, not the reasoning).

---

## D53: A curated section is a fileset of typed references, and the nav's top level is one of them

**Date:** 2026-08-26
**Status:** decided
**Amends:** D10 (the default section dissolves into the top-level list)
**Detail:** `solution/navigation.md`, `solution/format-spec.md`

**Decision.** A section is a fileset at `sections/<name>.fileset.md`, exactly as
the v1 format draft describes it: frontmatter says `kind: fileset`, the entries
are an ordered markdown list, **the entry's type is inferred from its link
target**, and the trailing text is a human-authored summary regeneration must
never clobber (R20). Three things are settled on top of that:

**One URI host per reference kind** — `tephra:mark/…`, `tephra:tag/…`,
`tephra:day/…`, `tephra:section/…` — while **the entries that are paths stay
paths**. Only what resolves by identity (D11) takes the scheme. Three of the six
kinds are therefore ordinary markdown links, and the other three read as what
they are even in a tool that cannot follow them, which is R26 applied to the one
file whose whole content is references.

**The nav's top level is `sections/_index.fileset.md`**, a fileset whose entries
are mostly other filesets, in the order the panel shows them. The leading
underscore is a collision guard rather than a convention: a person may
reasonably name a section "index".

**Pinning is an ordinary edit.** The gesture appends `- [Label](uri)` to a
section file — so it is undoable by the ordinary undo, versioned by the ordinary
commit, hand-editable afterwards, and requires no new storage of any kind. The
label defaults to the reference's own name and is what survives when a target
moves.

### What it amends in D10

D10 said **the default section always exists and holds the pins**. Under this
shape the top-level list IS that place: an entry may be any reference and not
only a section, so a pin with no stated destination lands there. **One file, one
order, and no distinguished second file whose only job is to be where things
go.** D10's reasoning is untouched — membership in a fileset beats a flag
scattered through the corpus, because it is one file to read and it has an
explicit order — this is that argument applied once more, to the list of lists.

### Why a curated row costs no new rendering

A `Reference` is an annotation's identity without its location (D51), and a
built-in row already resolves one into a set of places. A curated entry is the
same reference written down, so **a pinned row and a built-in row are the same
row**: same verb, same steppers, same scroll-track marks. What the format adds
is a label and a summary, which are the two things a person wants to write and
the index cannot know.

### Two rules that keep it finite and honest

- **A broken entry stays visible**, dimmed and marked *not found*. The corpus is
  hand-edited and synced, so a dangling reference is ordinary rather than
  exceptional — and hiding it would make an edit look like data loss, when the
  entry is the only remaining record of what was meant.
- **Recursion is capped**: a section already open above renders as a plain entry
  rather than expanding again, and depth stops at three.

### What this makes stale

`solution/format-spec.md` (amended in place — the URI table, `_index`, two
degradation rows), `decisions.md` D10 (the default section).

---

## D54: Documents come in kinds, windows are views of them, and every write goes through the document

**Date:** 2026-08-27
**Status:** decided
**Implements:** D10's "in the current window or a new one"
**Detail:** `solution/file-documents.md`

**Decision.** **A document has a KIND, and the stream is one of them.** "An
infinite stream chopped into days" is a file format sitting beside plain
markdown and the fileset, not a privileged thing — `DocumentMeta.kind`, which
the format already declares by filename suffix and mirrors in frontmatter (D3),
is what says which. `Document` is what every kind can answer; what a kind can do
beyond that lives on the kind:

| Kind | Adds beyond `Document` |
|---|---|
| markdown | nothing |
| fileset | `entries`, `pin`, `unpin`, `reorder`, `remove` |
| stream | `today`, `dates`, `extent`, `dateAt`, growth |

**An `AppWindow` is a view onto a document**, several may look at one, and
**main is the synchroniser**: one representation there, N in the front ends,
which is D37 restated for the plural case. Naming is deliberate — `Window` is a
DOM global (D35) and `WindowId` already means a loaded region, so a third
meaning of one word is a coordinate bug waiting to be written.

**Every write goes through the document, and main acquires it.** A front end
asking to pin does not write a file; it asks main, which gets the document — the
one already open, or one opened for the purpose — and edits it. **Any other
arrangement puts two writers on one file**, which works until the day somebody
has that fileset open in a window.

### Three properties, and the test they give

1. one representation in main, N in the front ends, main as synchroniser;
2. a window is a view of a document, and nothing else;
3. **a new kind changes the verbs and nothing else.**

The third is the design's own test, and it is worth applying before the code
rather than after: **if adding a kind would need a new registry, a second
synchroniser, or a window that is not a view of a document, this shape is
wrong.** A PDF kind would have its own verbs and would still be one authority
with N views.

### What it fixes that is already broken

- **`extent()` and `dateAt()` are day-shaped and live on the shared interface.**
  A fileset implements them by returning null forever, which is a type saying
  "not applicable" in the one vocabulary that cannot say it. They move to the
  stream.
- **`pin` and `unpin` write files behind the document layer's back**, so D53's
  claim that a pin is undoable by the ordinary undo is false. As fileset verbs
  they become ordinary `replace` calls and inherit undo, the write tiers, the
  WAL, divergence and versioning without new machinery. *(Done in MC4: the
  claim is now true of the document. Reaching it from the keyboard waits on a
  fileset being focusable, which is MC6.)*
- **`Reference{kind:'file'}` cannot be followed.** The sidebar names documents
  it has no way to open. *(Done in MC5. Two things were wrong, not one: the
  renderer had a single hard-coded document handle, AND a relative link in a
  section file was resolved from a day file's depth, so it failed containment
  and the row said "not found". A link is relative to the document it is
  written in.)*

### One access path, and no second answerer

**X reaches a document only through the table, and a file only through a
document.** No "unless it is not open" clause: opening is cheap, so there is
nothing for a second path to do. The version of this rule with a hole in it —
*an open document answers for itself; the disk answers otherwise* — is two
implementations of one question, and the hedge is where they drift.

Three things follow:

- **Eviction stops being optional.** A corpus sweep borrows seven thousand
  documents through the table, so the table must let go: never what is dirty,
  never what a window is pointed at, otherwise least-recently-used within a
  bound. The memory ceiling becomes the cache's size rather than the corpus's.
- **The index stops being a peer of documents.** Today `Document.spans()`
  consults the index while the index reads days through the document — two
  arrows in opposite directions. Now a document answers about ITSELF from its
  own segments and never consults a cache, and the index answers about the
  CORPUS from a cache it refreshes by borrowing. Neither needs to know the other
  exists.
- **The repository manages the table, not only the files.** A commit flushes
  every dirty document first, because the table knows which those are; a restore
  reloads the documents it rewrote, because a restore that left a stale document
  in memory is a version that took and was then overwritten by a buffer.

### Two file systems, which is the pattern underneath all of this

**W has a file system and X has a different one.** W's files are bytes in a
store — stat, read, write, watch, commit, restore — and X's are *logical
documents*, borrowed rather than opened, returning an object that speaks its
kind's language. The map between them is deliberately not one-to-one: a logical
document may be one physical file (a note), many (the stream's days and their
split parts), or **none at all** (a filtered view, a saved query, a day
navigated to and never written in).

An X file system that returned byte handles would be W with extra steps. What
makes it X is that what comes back knows its own kind. This is written up at the
front of `architecture.md`, where it should have been from the start.

### X has a floor, and it is a directory

`x/documents/` holds the `Corpus` and the per-kind implementations, and is the
only X code permitted to see the corpus's file system. Everything else in `x/`
is built on documents. **Not `X1`/`X2`** — those name a position rather than a
thing, and this project has twice paid for a name that did not say what it was.
Enforced by a test over the import graph, which needs no allowlist and survives
new kinds.

Two exceptions, named in the test: **machinery** (`.tephra/` — the index cache,
the WAL, the lock) is not corpus content and never becomes a document; and the
**version store** is a different W service that `History` legitimately reaches
for the log and for commits — while anything writing corpus CONTENT still goes
back through a document.

### A kind arrives in four parts, in four predictable places

`shared/kinds/<kind>.ts` (the API), `main/x/documents/kinds/<kind>.ts` (the real
implementation), `renderer/src/x/kinds/<kind>.ts` (the IPC forwarder),
`renderer/src/editor/kinds/<Kind>.tsx` (the surface), plus one registry line per
process. **Adding a kind should be adding files, never finding them.**

**Split by process first, kind second.** All four files in one directory reads
better and would let main-only code into the renderer bundle by an
ordinary-looking import — this project has broken three suites exactly that way
and keeps a test whose only job is to catch it. The process boundary stays
physical; the kind axis lives inside it.

### The `Corpus`: the file system as X is allowed to see it

One structure underneath, and it is not merely a table of open documents — it is
**W's whole surface, presented to X as documents**: borrowing, listing,
existence, creation, renaming, removal. `Notebook` becomes reachable only from
here, which is the layering W/X was drawn for and which every X object taking a
`Notebook` in its constructor has quietly violated.

**Not called `Repository`**: that names the version store already (D32, D43),
and a third meaning of one word is how the coordinate bugs started. `Corpus` is
what the design documents have always called the body of text, and this is its
face.

`use(id, work, how?)` — **two callers asking for one id get the same object, and
it stays valid while the work runs.**

**A borrow declares what kind of access it is**: `{ mode: 'read' | 'write',
retain: boolean }`. This is what storage systems learned about buffer caches —
a batch pass and an interactive open want opposite things from a cache, and only
the caller knows which it is. **The index sweeping the corpus borrows
`{ mode: 'read', retain: false }`**, so it cannot displace the documents a
person has open, however large the corpus grows. Interactive is the default,
because the safe answer should be what you get by not thinking.

**A scoped borrow, not a handle to keep.** The alternative — a front end opening
a handle per window and closing it later — makes correctness depend on a message
arriving, and **a close dropped on its way to main is a document held forever**.
A borrow cannot leak: it ends when the work does, returned or thrown. Main takes
one per operation and lets it go before answering the IPC, so a lost message
costs nothing.

**What keeps a document alive is the table, not the borrows.** A `Document`
holds what no file holds — the undo stack, the generation, unflushed edits, its
place in the WAL — so releasing it because the last borrow ended would discard
all of that silently. The table keeps what it opens and may evict only what is
clean, unwatched, and holding no history a window could still reach. **Evicting
nothing is a correct implementation**, and the one to start from. Flushing
before evicting is not optional.

**And it must cache the OPENING, not only the opened.** One event loop means
"simultaneous" is two async operations interleaving at an await — which is
precisely how the segment cache once did check-then-act and raced two reads of
one day. `use` has the same shape and inherits the same bug written the obvious
way.

### What this makes stale

`solution/document-api.md` (`extent` and `dateAt` on the common interface),
`shared/ui-state.ts` (one location and cursor becomes a SET of windows),
`decisions.md` D53 (pinning becomes a document edit, as it claimed to be).

## D55: TODO is a text kind; days are segments and the working set is carried forward

**Date:** 2026-09-01, revised 2026-09-01
**Status:** decided
**Detail:** `solution/todo.md`, `goal/todo.md`

**Decision.** `TodoDocument extends SegmentedDocument`, segments keyed by
`DateKey`, one list per directory: `<name>.todo/YYYY/MM/YYYY-MM-DD.md` (D59),
with the `.todo` directory at the notebook root distinguished by position rather
than by any special case in the layout. **Each day's file holds that day's
working set in full**, carried forward automatically. All TODO lists share one
format; there is no lightweight second form.

**Revised the same day, on two points.**

**The carry is automatic; the walk reviews it.** As first written, the morning
walk carried items forward and thereby wrote the day's file. But `goal/todo.md`
also holds the walk to be offered and never compelled, and those cannot both be
true — a skipped walk leaves the day with no file, so an item added on Thursday
goes either into a file dated Monday, making ctime a lie, or into a Thursday
file holding one item, making the invariant a lie. So the first touch of a day
materialises that day's set from the last day that has one, and the walk becomes
a review pass over a file that already exists. **The carry protects the data;
the walk protects the attention.** Era 2 could not tell them apart because
copying the list by hand *was* reading it.

**ctime and mtime are stored, not derived** (see below, and D56).

**This reverses `file-documents.md`'s prediction and the M3 deferral built on
it.** Todo was predicted to be "record-shaped: an edit is a field, and history
is per item," which made it an expensive first test of the four-artifact shape
and sent it back to the backlog on 2026-08-31. Reading the twenty-year record
closely (`notes/03 the todo feature.md`) says otherwise: an item is a line, tags
and dates are inline markers, and none of the three interactions a list actually
serves asks when one item's status last flipped — they ask what the *list*
looked like. History is per day.

**Copy-forward is era 2's morning ritual minus the retyping, and it pays for
itself four times.** The designated working set needs no representation because
it *is* the day's file — persistence, standing across skipped days, and
idempotence on a second carry all fall out. Scrubbing to a past day is opening a
file. Nothing evicts resolved items because nothing carries them. And every verb
is a `replace()` on a body, so undo, the WAL, divergence and versioning arrive
free.

**It was originally credited with a fifth, and that one is withdrawn.** Copy-
forward does make ctime and mtime facts about the corpus — first day a line
appears, last day it changed — but at one-day resolution, and recovering either
means finding the earliest or latest file holding an id, which is a corpus scan
without an index. The timestamps are stored in the item instead (D56). The other
four stand, so the choice is unaffected; the argument for it is one item
shorter.

**The cost is duplication and it is negligible**: a ~30-line working set copied
daily is ~220k lines over twenty years, ~15 MB, against the stream's own
0.4–0.9 GB. The duplication *is* the history.

**What this makes stale.** `solution/file-documents.md` (the record-shaped
prediction, and the claim that the first non-text kind forks `Document`);
`solution/milestones.md` (the M3 rejection's second reason); D4 (below).

## D56: TODO items carry ids, which D20 already permits

**Date:** 2026-09-01, revised 2026-09-01
**Status:** decided
**Detail:** `solution/todo.md` §3

**Decision.** Every TODO item carries a machine-minted id, corpus-unique,
written inline as a trailing marker and carried forward with the item. Identity
is what makes copy-forward work at all — text-matching breaks the moment an item
is reworded — and it is also what the link directory points back at and what
backlog resurfacing would track.

**The marker carries the timestamps with the id**, because T3 stores them rather
than deriving them from which files the item appears in:

```
- [ ] Call the surveyor #house DUE 2026-09-14 <!--tephra:item 7f3a1b2c 1756684800 1756771200-->
```

**Eight base-36 characters, minted against the index.** `unusedCommentId` mints
four against one body, which is right there and wrong here: corpus uniqueness
over a few thousand items collides at four characters with probability near one.
Eight suffices alone, and checking the mint against the index — which holds
every id anyway, since that is how `tephra:todo/<id>` resolves — makes it
certain.

**mtime is stamped by operations, never by typing.** Status, tag, due date and a
committed row edit each rewrite the line as one `replace()`, so the stamp is
free. Keeping it exact through free-text typing would mean main injecting a
marker rewrite into the line the cursor is in, on every keystroke, against a
renderer holding the buffer optimistically — the situation `DesyncError` exists
for. The surface makes this moot rather than a compromise: **a row is edited by
a gesture that commits once**, so a text change *is* an operation. Raw-text
edits to the file escape the stamp and are picked up by the next carry.

**This was drafted as a departure from the "no ids" rule and is not one.** The
rule is D20's, and D20 forbids storing spans *beside* the text. An id in the
text is not beside it: the document stays a pure function of its bytes, and
hand-editing stays satisfied structurally rather than by care. **Comment threads
already do exactly this** — machine-minted ids living inline, issued by
`unusedCommentId` — so the mechanism exists and has a year of precedent. The only
new constraint is that an item's id is mandatory and unique across the corpus
rather than within one document.

**Addressing follows D53's vocabulary directly.** `tephra:todo/<id>` names one
item and opens at its **newest** instance, which is its current state — the
inverse of `tephra:mark/<name>`, which resolves to the first in date order,
because a bookmark means where something was first said and an item means what
it is now.

**An unasked-for capability falls out.** The instances sharing an id *are* the
item's day-by-day history. `goal/todo.md` explicitly did not ask for per-item
history and `file-documents.md` predicted it would have to be built; it is a
by-product of the storage. Worth a view eventually, worth building nothing for.

**One rule about hand-editing has to be stated rather than left emergent.** A
line with no id marker is adopted on the next read and given one, which is how a
hand-written item joins the list at all — so a line whose marker is lost to a
retype or a paste silently becomes a *new* item, with today's ctime and no
history. It is the one place in this app where hand-editing loses something
invisibly. Accepted: refusing to adopt unmarked lines would break the flow the
leniency exists for, and hand-editing is rare enough to earn no more than this.

**The hazard is sequencing, not principle.** Ids are cheap from day one and
expensive to retrofit onto a year of carried-forward lines — R15's class.

## D57: The link directory is a corpus capability, not a TODO feature

**Date:** 2026-09-01
**Status:** decided
**Detail:** `solution/todo.md` §5, R10a

**Decision.** One index over **every link in the corpus**, whatever file it was
found in — reverse-chronological by last appearance, searchable, each entry
carrying enough surrounding text to recognise it and a reference back to where
it was written. Links from completed and abandoned work are retained. The TODO
surface's link mode is a filter over it; the stream gets the same view free.

**It arrived scoped to the TODO list, and the scoping was wrong.** *"Where is
that doc I was working on Tuesday?"* is the second most common thing a task list
is asked (`goal/todo.md`), which is why it surfaced there — but it is asked of
the notebook at least as often, and the machinery does not care which file a
link came from. `CorpusIndex` already sweeps every file by `stat` stamp;
`Reference` already has a `url` variant; `architecture.md` already reserves the
pattern. Building it TODO-only is the same work aimed at less.

**Its sibling is search, not the TODO list**: search finds text you remember
writing, this finds documents you remember opening. Hence R10a's placement.

**It is separable, and it is scheduled after MT3** *(settled 2026-09-01; this
first read "should probably ship first")*. Separable is right: it needs no item
ids, no walk, and nothing from the TODO storage. But "ship first" was argued
from two premises that turned out to be about M4 rather than about MT — that it
is the read-only fork of D9's filtered view, and that it de-risks search. Both
hold; neither says anything about the TODO list. **The two share exactly one
piece of code** — the link scanner, which MT3 delivers because its rows need it
(D61) — so nothing structural drives the order, and it goes on urgency.
`solution/link-roadmap.md`.

**And "no surface beyond a list" was understated.** Nothing scans links today;
`TypedSpan` has no link variant and `shared/fileset.ts` parses links only in
list-item position. It is a scanner, an index payload, and a pane that makes a
window's location *a document or a query* — the last of which is M4's spine and
the reason this is worth building early.

## D58: The TODO promotion gate is met by the historical record, not by a stand-in failure

**Date:** 2026-09-01
**Status:** decided — supersedes D4's gate for TODO; D6 reopened
**Detail:** `goal/todo.md`

**Decision.** D4 held that v1 would deliberately run a plain checkbox file so
that promotion answered a recorded failure rather than an argument. That gate is
**not met and is superseded anyway.** The stand-in was never really used — notes
went into Tephra much as they had gone into M365 — so no failure was recorded
against it. What replaced it is stronger: a close reading of twenty years across
three eras, which produced the three interactions, the entry-cost finding, and
the walk/cap split, none of which a few weeks of a checkbox file would have
produced.

**D6 is reopened as intended, and answers differently than it expected.** D6
named YAML as the likely bespoke syntax at promotion time. The notation chosen
instead is inline and visible — `#tag` and `DUE <date>`, left in the line — which
keeps one parser, one merge story, and a file that is what it appears to be.

**The general lesson is worth more than the decision.** An evidence gate is only
as good as the instrument behind it, and this one was never switched on. **A gate
that was never exercised has not returned a negative result** — it has returned
nothing, and treating silence as evidence would have deferred the work
indefinitely for no reason. This is the instruments discipline in `notes.md`
applied to a process control rather than to a measurement.

## D59: A multi-file document is a directory named by its kind

**Date:** 2026-09-01
**Status:** decided
**Detail:** `solution/todo.md` §6

**Decision.** A document made of many files is a **directory whose name carries
its kind as an extension**, exactly as a single-file document's name does:
`notebook.stream/`, `main.todo/`. Day files inside lose their own extension,
because the directory carries it — `notebook.stream/2026/08/2026-08-31.md`. A
`DocumentId` for such a document is its directory path.

**This turns an existing special case into a rule rather than adding one.**
`kindOf` already answers `'stream'` for anything under `stream/`, so the
containing directory already decides a file's kind; what it lacked was a way to
say so for a second directory. With the suffix, `kindOf` is one function over
files and directories both, and `STREAM_ID` stops being a magic string meaning
"the one document whose id is not a file path" — it becomes "the `.stream`
directory at the root". The distinguished TODO list then falls out of T1 instead
of being named: the `.todo` directory at the notebook root is *the* list, and
two at the root is an anomaly, which this app already has a place to report.

**The stream migrates, and the pre-migration restore seam is accepted.**
`STREAM_DIR` has ten uses, all behind the constant, so the code is a small
change. The consequence is not: the notebook is git-versioned and
`StreamHistory` reads past versions *by path*, so versions committed before the
rename are unreachable through Tephra's own restore. Teaching the two history
call sites both names would close the seam and is deliberately not being done —
there is nothing critical behind it, and a permanent compatibility branch is a
worse thing to carry than a dated paragraph. **Versions before the migration are
readable through git and not through restore.**

## D60: The link directory indexes the corpus as it stands, and groups by a canonical form it never stores alone

**Date:** 2026-09-01
**Status:** decided
**Detail:** `solution/link-roadmap.md`, R10a

**Decision.** The link index is a cache of a scan of the corpus **as it stands**
— D52's rule, unweakened. A link whose text no longer appears in any file leaves
the directory. Rows are grouped by a **canonical form**, produced by
`canonicalizeLink()`; what the index *stores* is the raw target as written, and
the canonical form is a derived grouping key.

**The retention narrows, and it turns out to narrow almost nothing.** R10a asks
that links from completed and abandoned work be kept — "which is most of the
value: the document you want is usually attached to something you already
finished." An index that accumulated would deliver that, and would make itself a
source of truth: deleting `.tephra/index` would then lose every link whose line
is gone, which is precisely what D52 forbids. **The corpus's own shape delivers
the requirement instead.** A TODO item is never destroyed, only restatused (T2),
and past day files keep every line that ever stood in them, so a link attached
to work finished last March is still in the corpus and still in the directory.
What falls out is only a link whose text was genuinely deleted — and git still
has that.

**The canonical form is a grouping key, not the datum, and this is the
load-bearing half.** Canonicalization is expected to change repeatedly — which
query parameters are noise, whether a fragment distinguishes a page, how two
spellings of one document relate. Every change invalidates every existing key.
If the index stores the raw target, that is a rebuild, which D52 makes free. If
it stores only the canonical form, it is a reindex of the corpus to recover
information that was thrown away. Same discipline as D47's keeping the original
bytes on import rather than the conversion: **the derived thing is never allowed
to be the only thing.**

**`canonicalizeLink` is isolated and independently testable on purpose.** It is
its own module with its own tests, pure `(target) => CanonicalLink` to begin
with, doing no more than stripping known tracking parameters and fragments and
resolving corpus-relative paths to one corpus path. It is expected to grow, and
to take the existing index as an input when it does; keeping it behind one seam
is what makes that a two-call-site change rather than a redesign.

## D61: One link scanner, complete and unopinionated; what counts as a link is a separate predicate

**Date:** 2026-09-01
**Status:** decided
**Detail:** `solution/link-roadmap.md`

**Decision.** `shared/links.ts` finds every markdown link in a body — both legal
spellings of a destination — and classifies each through `referenceOf`. It has
**no opinion about which links matter.** A separate `indexable(reference)`
predicate decides what enters the directory: URLs, and files inside or outside
the corpus. Not `tephra:` navigation references, which the sidebar already
serves and which would bury the documents under them. Not images: an embedded
picture is not a document you were reading.

**The split is what makes the module reusable rather than a bundle.** The TODO
list's rows need to find links in an item's text (MT3) and the editor needs to
decorate them; neither should inherit the directory's policy about what is
interesting. And the policy is one function, so changing it is changing that
function and rebuilding a cache — which D52 makes free.

**There are two link parsers today and they already disagree.** `ITEM` in
`shared/fileset.ts` handles both spellings, including `(<http://a b>)`; `LINK` in
`renderer/src/editor/kinds/markdown/widgets.ts` is `\(([^)\s]+)\)` and cannot
match an angle-bracket destination. `App.tsx`'s Insert Link writes exactly that
form, via `destination()`, whenever the URL contains a space — **so inserting a
link with a space in it produces something the app's own renderer will not
render as a link.** One scanner with three consumers retires the disagreement
along with the bug, and the bug is what the scanner's first test should be.

## D62: The day boundary is a computed signal with one owner, and three days have three names

**Date:** 2026-09-02
**Status:** decided
**Detail:** `solution/day-boundary.md`. Amends D38.

**Decision.** Three names, for three questions that were all called "today":

- **`clockDay`** — what the calendar says now, in the reference zone (D38).
  What the interface means by today.
- **`writingDay`** — the day the notebook is writing into. Advances to
  `clockDay` only once writing has stopped long enough that the person has
  plainly got up. **This is the filing date**, which is what amends D38.
- **`openDay`** — one document's own: the day it currently has open.

`openDay < writingDay` is a document saying it has a boundary to cross.
`DayClock`, in main, owns both of the first two and publishes them; the renderer
consumes and computes neither.

**A level, not an edge, and that is the whole of why this shape works.** The
first sketch was an event — `dayRolled` — which has to reach everyone exactly
once and then be reset, and is simply lost for any window that was not open when
it fired. A comparison of two published dates is idempotent: nothing is
delivered, consumed, acknowledged or reset, and a window that was closed asks
the same question on the way back in and gets the same answer. It is also why
three windows cannot race: they can all evaluate it and the work happens once,
in main, before the values change.

**Derived, not timed.** The app being closed overnight is the ordinary case, so
a live timer covers the rare one. `writingDay` is stateful — it cannot be a
function of `(lastWrite, now)` alone, since writing at 00:15 having been up
since yesterday makes the last write's date say Tuesday when the answer is
Monday — but its **seed is read from the corpus** on startup: the newest day
with content, and when it was last written. That makes it correct after a close,
a crash, a sleeping laptop or a week away, which no timer is.

**What forced it.** The day separator disappears — silently — when a day ends
mid-line, because `days.ts` skips a block widget it cannot place. The rule is
that a day which has ended ends with a newline, and until now nothing knew where
a day ended.

*(Revised on building it: this first read "defended twice, enforced nowhere",
naming the `days.ts` skip and the `branch` clamp as compensation to be deleted.
Both stay. The skip is how a deliberate cross-midnight join renders — joining
two days is a thing a person can mean, and a joined pair has no seam — and the
clamp guards a different cause, since `branch` removes text after a day has been
closed. What this decision supplies is the owner, not the removal of two
defences that turned out to have jobs.)*

**Three consequences, decided rather than discovered.**

- **Terminating a day is a write caused by opening the app**: yesterday's file
  is modified because time passed and you launched. That is what terminating
  means, and it must not read as divergence.
- **An empty today stays in memory** until something lands in it. The seam needs
  a day below it to be a seam, but an empty segment with no file currently
  counts as dirty — which would put a file on disk for every day the app is
  opened and nothing written, against "days with nothing in them have no file".
- **The terminating newline is not in anybody's undo stack.** A day terminator
  you can undo into a mid-line day is a control with no meaning.

**`writingDay` is monotonic, and it does double duty.** It never goes backwards
and its seed is the newest day in the corpus with content — which is what stops
a zone change from re-dating going forward (D63), and *also* what makes two
devices converge: whichever crosses the boundary first writes day N+1, and the
other moves forward to meet it on its next seed and cannot move back. Without
it the pair would flap, each pulling the other's day back to its own. The price
is that a device with a fast clock pulls the rest forward by at most a day,
which is the right way round — a boundary in an odd place, rather than
corruption.

**Accepted, not solved.** A day that never ends — forty hours of continuous
writing gives one file dated Monday holding Wednesday — is judged not worth a
rule.

## D63: The day's zone is chosen and kept with the notebook, not fixed and not detected

**Date:** 2026-09-02
**Status:** decided — supersedes D38's fixed offset; D38's writing-day amendment (D62) stands
**Detail:** `solution/day-boundary.md`

**Decision.** `clockDay` is computed in an IANA zone the person chose, stored in
`config/` with the notebook. When the system's zone differs, the interface says
so and **offers** to change it; nothing detects and applies on its own. An unset
notebook means UTC−8, so a corpus written under D38 is unaffected until somebody
chooses. A new notebook is created with the system's zone.

**D38 diagnosed this correctly and prescribed the wrong remedy.** It rejected
local time because "fly to Zurich and today's file already exists under a
different calendar date, and every device disagrees about which day a passage
belongs to" — both true, and both failures of a zone that **changes itself**.
The damaging word was never *local*, it was *automatic*. A fixed offset is one
way to stop a zone changing itself; letting the person say where they are is a
better one, because it is also right for somebody who moves. **The product is
used by one person, who is in one place at a time** — that is what stabilises
this, and it is a fact about the product that the fixed offset was standing in
for.

**`config/`, not `.tephra/`, and the distinction is load-bearing.** `.tephra/`
is machine-local and never synced (D7, D52), so a zone kept there gives every
device its own and reinstates D38's second failure exactly. The zone decides
which date a passage is filed under; two devices must agree or one evening lands
under two dates. `config/` is where authored configuration already lives, for
the reason themes do (D41).

**A real zone rather than an offset.** `America/Los_Angeles` survives a change
to a country's rules; `UTC−8` does not. D38 avoided real zones partly for DST —
"no hour is ever doubled or skipped" — which is true of hours and **irrelevant
to dates**: every instant maps to exactly one calendar date in every zone,
including zones that transition at midnight. A DST day is 23 or 25 hours long
and is still one day with one name.

**`writingDay` is monotonic, and this is what forces it.** Moving east pushes
`clockDay` forward: one short day, harmless. Moving west pulls it backwards, and
a writing day that went back would file new passages into a day already holding
later content — re-dating going forward, which is D9's corruption arriving
through the side door. So it never goes back; after a westward change it waits
for the calendar, at a cost of one long day.

**What this costs.** `shared/dates.ts` currently computes from a module
constant, and every function in it has to take a zone instead — including in the
renderer, which formats labels. The zone therefore travels with `clockDay` and
`writingDay` as something main publishes, so that neither side computes its own.
That is the same rule as D62's and for the same reason.

**What would reopen it.** Multi-user, which this is not. The whole argument
rests on one person being in one place at a time.
