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
- **v1 fixes two things it cannot revisit:** where the date lives (filename or frontmatter; mtime does not survive sync, copy or git) and the subject-tag syntax, which v1 decides implicitly regardless.
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
