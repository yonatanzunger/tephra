# Open Questions

Five genuine unknowns, ordered by how much they constrain everything else. **Q1 and Q4 are now resolved by Spike 01** (`discovery/spike-01-findings.md`); Q2 should be resolved before any substantial building.

## Q1: Can one editing surface be vim-compatible *and* render figures, equations and tables inline?

**Status: RESOLVED — yes, CodeMirror 6.** See D16 and `discovery/spike-01-findings.md`.

Spike A confirmed it against a 1.05 MB corpus, on the desktop and on Android. The editor's own cost is 0.4 ms per keystroke at p99 and does not grow with document size, widget count or typing speed. Three constraints came with the answer and are now design inputs rather than open questions: block widgets must come from a state field rather than a view plugin; rendered constructs must unrender under the cursor, because the vim plugin ignores CodeMirror's atomic ranges; and block widgets must unrender from a neighbouring line, or vertical motion can never reach them.

Two things the spike changed that were not in the question. **Vim itself is now a setting** (D15) — it is unusable on a soft keyboard and subtly worse on the desktop. And the "p99 under 30 ms" bar turned out not to be scoreable: a plain `<textarea>` holding the same corpus measures 17.5 ms on the same machine, so most of that budget is the display pipeline.

The staging in the original analysis survives untouched: ship raw+vim and rendered-read first, add rendered-edit per node type, tables and equations last.

<details><summary>Original analysis, kept for its reasoning</summary>

**Status:** open, and narrower than it first looked
**Why it matters:** Decides the technology of the whole desktop app; R1.4 and R2.7 are both hard requirements pulling against each other.

**The intended model is two modes over one document** — raw markdown edited with vim, and rendered markdown viewed *and edited* visually, switched between rapidly. That is a well-trodden shape (Obsidian's source/live-preview/reading modes, Typora, Zettlr), and the foundation it rests on is a plain-text editor with a genuine vim mode that also supports **inline widget decorations**. CodeMirror 6 is exactly that combination, which is why Obsidian can offer both at once; mode switching becomes a decoration toggle rather than two editors.

**The cost is concentrated in one place: editing in the rendered view.** Rendered *reading* is nearly free. Rendered *editing* means the markup must be managed on the user's behalf — cursor enters a node, markup reveals; cursor leaves, it re-renders. That works well for inline constructs (emphasis, links, headings) and poorly for tables and equations, which usually want a dedicated editing affordance instead. So this decomposes: ship raw+vim and rendered-read first, then add rendered-edit per node type in order of value. **Tables and equations are the expensive ones and can wait.**

**Strategy:** prototyping. The experiment is defined in `goal/discovery/spike-01-experiment.md` — **Spike A**, a plain browser page, which answers this at zero platform cost. Its sharp edge is not rendering but **vim operating over widgets**: what `dd` does to a line holding a rendered equation, whether motion, visual selection and undo behave across one.

</details>

## Q2: What is the storage and sync substrate?

**Status:** open, but strongly indicated
**Why it matters:** Load-bearing for offline operation, multi-device use, conflict behaviour, and the departer's exit.
**What is already known**, which narrows it considerably:

- The real requirement is **local-first with deterministic reconciliation**, not strong consistency — "strongly consistent" and "works on a plane" cannot both hold during a partition.
- **The steady state is continuous invisible sync; explicit resync is the reconnection ceremony** (D5, R25). Conflicts may be *surfaced* rather than silently resolved, and a great deal of merge machinery becomes optional.
- **Concurrent multi-device editing is not an expected workflow** (D12), which removes the convergence requirement that most merge machinery exists to satisfy.
- Git meets all four underlying needs — sync, offline, non-lossy reconciliation, rewindable history — and Portal validated it end to end including cross-compilation and mobile bindings. Its one unresolved hole was **TLS trust on Android**.
- The genuine fork was: **plain files as source of truth** (keeps the exit, makes merge your problem) versus **a CRDT document as source of truth** (merges without conflict by construction, but plain files become an export and R26 weakens).

**The fork is no longer balanced.** A CRDT's entire value proposition is conflict-free concurrent editing. With that case rare (D12) and reconnection ceremony acceptable, the benefit is small while the cost — files demoted to an export — is large. **Plain files as source of truth is the expected answer**; what remains is confirming it rather than deciding it.

**A new constraint on the answer (D31): the hub must be a *versioned* store, not a file-sync service.** Rewindable history is a real requirement with no other home — the local journal is a durability window, not a history — so the hub is where "what did this look like in March" has to live. That rules out Dropbox/iCloud/S3-shaped answers and points hard at git or an equivalent, which is also where Portal's validated spike work already sits.

**Strategy:** confirm, then prototype narrowly — aimed at the divergence picker and atomic writes, which are the parts that still have to work.

## Q3: What replaces the filling page?

**Status:** open — but half of it resolved, and the two halves turn out to be different jobs

**Resolved: due dates are genuinely needed, and the era-2 failure tells us what the feature must do.** They existed in era 2, hand-implemented as `DUE 5/4` in a drawn box, relying on the visual to catch the eye. That worked at small scale and **degraded as the number of dated tasks rose** — a scanning mechanism that fails when there is too much to scan. So the digital requirement is not merely to *store* due dates but to **rank and surface by urgency so the eye never has to scan**, which is what R16 asks for and now has a reason and a known failure mode behind it.

**Still open: the forced review**, confirmed as a real feature rather than an artifact. Era 2's full spread compelled live items to be transcribed forward; everything else died by omission — cheaply, visibly, by decision rather than by neglect. Digital lists never fill, so that never happens. The two mechanisms do **different jobs**: a due date answers *"this has a deadline,"* a forced review answers *"is this still alive at all."* Building both is right; the question is only what the second one looks like.

**The intent is to experiment as the tool evolves**, which makes this a design constraint rather than a design: nothing should foreclose a review rhythm later. **One cheap thing to do now:** record a *last-touched* timestamp on every TODO item from the start. No mechanism can ask "what has gone stale" without it, and adding it retroactively means every existing item looks equally fresh. Marker now, mechanism later.

**Strategy:** thinking, then experimentation in use.

## Q4: What stack, given that OS integration is a real cost?

**Status: RESOLVED — candidate 3, an Electron shell.** See D17 and `discovery/spike-01-findings.md`.

**The premise the question rested on turned out to be false.** OS integration is not intrinsically expensive for a web-shelled app: printing a selected range and pasting an image were built twice, and both are a paragraph of shell code in either shell. The Tauri finding was about Tauri.

With the deciding cost gone, the choice fell to the primary requirement. **Typing felt better in Electron than in the Swift shell** — the same subtle, unnameable difference as vim against non-vim. On macOS that is not separable from the shell: a native shell gets WKWebView, Electron is Chromium, and there is no third arrangement this project can afford. The one thing the Swift shell did better — a print panel with a document preview — closes in eleven lines in Electron. The thing Electron does better cannot be closed in Swift at all.

Candidate 1 (fully native) stays where D1 and the spike plan left it: reopened only if the surface had failed, and it did not.

<details><summary>Original analysis, kept for its reasoning</summary>

**Status:** open, and reframed by firsthand evidence

**The evidence.** The Clarity app is React rendered inside a Mac app via **Tauri**. Rendering quality: *acceptable* — which retires the main worry about R1.3. **OS integration: painful** — "things as simple as printing have required a *lot* of work."

That matters more here than it would for most apps, because **OS integration is not incidental to these requirements**: printing a range (R11), opening fileset documents individually or en masse (R21), pasting images in situ (R7), and drag-and-drop into filesets are all OS conversations. A stack that makes them expensive taxes four requirements, not one.

**But the counter-evidence is sitting on the desk.** The user has been running **VSCode with vim plugins** as a stopgap, at 130 WPM, and finds it *pleasant* — markedly so after writing custom themes for it. VSCode is Electron — web tech in a native shell — which is an existence proof that R1.1 (typing latency), R1.4 (vim) and R1.3 (rendering) are all jointly satisfiable in a web-based stack. The Tauri finding is therefore evidence about *Tauri's OS bridge*, not about web rendering. **The rendering-quality worry is retired; the OS-integration worry is the whole of what remains.**

**Three candidate shapes** (a fourth — building this as an editor extension — was eliminated in **D1**, on measured mobile grounds):

1. **Fully native (SwiftUI/AppKit).** Best OS integration; requires building or porting vim behaviour and markdown rendering. Very expensive, and squarely on the maintainer's weakest ground.
2. **Native shell, web view for the editor surface only.** Native menus, printing, file handling and paste; web tech confined to where it is strongest (text rendering plus CodeMirror). Middle cost, and it directly targets the Tauri failure.
3. **Full web shell (Electron or Tauri).** Most code shared; OS integration is work, and with Tauri specifically that work is now measured rather than guessed.

**A structural point that widens the space: desktop and mobile need not share a UI stack.** The contract between them is the *file format*, which R26 requires be plain and durable anyway. Two purpose-built apps sharing no code is a legitimate architecture here, and it lets the desktop optimise for vim and screen area while the phone optimises for touch and small screens — which Q5 suggests are different problems regardless.

**Strategy:** prototyping, as **Spike B** in `goal/discovery/spike-01-experiment.md` — printing a range and pasting an image, implemented in a native Swift shell and in Electron. Tauri needs no third implementation; its result is already measured. Rendering quality no longer needs proving.

</details>

## Q5: How much does mobile actually need to do?

**Status:** open
**Why it matters:** Bounds the most expensive part of the build. "Hard to think of functionalities I wouldn't want" is a maximal answer, but era 3's mobile failure was that it was *barely functional* rather than incomplete — so the requirement may be **excellent at less** rather than equal. Vim is desktop-only by nature; screen real estate makes range selection, fileset browsing and long-form writing genuinely different problems on a phone.

**Narrowed by Spike A′.** The editing surface itself ports — the same page runs well in Android Chrome and a system WebView, so mobile is not a separate build. What does *not* port is vim, which is unusable on a soft keyboard (D15). That makes the non-vim keymap the phone's permanent surface rather than a fallback, and it is the part of this question now worth answering first: what the phone's editing gestures are when modal editing is off the table.
**Strategy:** thinking. Probably resolved by listing what is actually done on the phone in a typical fortnight, rather than in the abstract.

## Q6: How do local undo and versioned history interact?

**Status: RESOLVED — D32.** Options in `solution/history-options.md`; architecture in `solution/history-architecture.md`.
**Why it matters:** It is a v1 question (how undo works) and a v2/v3 question (the sync architecture) that must be answered together, because answering them separately misaligns them. It also currently has **three decisions resting on an unexamined assumption** — D28's 30-day journal retention, D29's rewind semantics, and D31's split of responsibilities — all of which were written before the interaction was examined directly.

**The shape of it.** Two histories want to exist: fine-grained edit history (undo) and versioned history (rewind, cross-device). The difficulty is entirely in three places where they touch — **autosave** (no discrete save event to anchor a version to), **remote merge** (what does undo mean over text someone else changed), and **hand-editing** (a change with no record of intent). A good option puts all three in one place or in none; a bad one spreads them across two mechanisms that must agree.

**Resolution.** Option 4 with all three modifiers: volatile in-memory undo, a seconds-long WAL, and a git repository local from v1. The deciding argument was that it is the only option putting all three interaction points in one place or in none — and that git extends the exit to the history, which a bespoke store would not.

## Q7: What is the shape of the stream view, and how far does continuity reach?

**Status:** open. Partly measurable, partly judgement — and the two halves are separable.
**Why it matters:** It decides how the editor binds to `Window`, which is structural rather than iterable. It is also the first thing that will be built and the first thing that will be felt.

### The question in current terms

R6 asks for "one continuous chronological stream." The corpus is 0.4–0.9 GB over twenty years and cannot be resident, so the stream is presented through a `Window` (D8, D23). **"Window extent" and "the stream UX" turn out to be one question, not two**: how much is loaded *is* how far you can scroll before something else has to happen, and what that something else is.

The stream is **oldest-first, appended at the end** — the paper-notebook order, and the one the project's own metaphor describes. Opening Tephra should land at the end of today with the cursor ready, since appending to today is by far the highest-frequency gesture.

### Four things are undetermined; one of them is structural

**(a) Where does continuous scrolling stop and jumping take over? — STRUCTURAL.** This decides whether `Window.extend` is exercised constantly or rarely, and whether scroll-anchoring-on-prepend has to be solved at all. Prepending content above the viewport shifts every position and the scroll offset with it; correcting for that requires measuring inserted height after layout, and it is the fiddly part of every upward-infinite-scroll implementation ever written.

**(b) Does a jump move the current window, or open another?** D10 already has "current window or new window" as an entry-activation choice, so the likely answer is: a jump moves this window and keeps a back stack, browser-fashion, with open-in-new-window as an explicit gesture.

**(c) One editor pane, or a privileged place for the stream?** One pane is simpler, but then jotting in today's stream while reading a note costs a navigation — friction on the highest-frequency gesture. Portal's answer was a separate capture surface: *"the widget is the capture surface, not the editor; capture is gesture, type, enter."* Probably deferrable: one pane plus a one-key "go to today", and a capture affordance only if that proves frictional.

**(d) What does a first launch against an empty directory do?** Small, but it is the first thing built and the first thing seen.

### Options for (a)

1. **Fixed window, explicit extend.** An "earlier ▲" affordance at the boundary. Simplest; honest; a visible seam where the requirement asks for continuity.
2. **Auto-extending, no eviction.** Grows as you scroll up. Memory grows without bound and performance degrades somewhere unmeasured.
3. **Sliding window with eviction.** Constant memory, but scroll anchoring becomes mandatory and editing near an evicted boundary is fiddly.
4. **Continuous within a generous window, date-jump beyond it.** Continuity where continuity is actually used — the last few weeks, where you are re-reading context — and a different affordance for distance, which is what a person reaches for anyway.

**2-with-a-cap and 4 converge**, since a generous auto-extending window that stops growing at a cap *is* option 4. That is the likely answer.

### The idea that decouples the tension

A large window is slow to open and rarely needs extending; a small one opens instantly and extends often. **Both, in sequence:** open a few days' worth immediately, then extend backwards in the background toward a larger target while the reader is still orienting. Opening stays instant and the boundary is rarely reached.

### What is measurable, and what is not

**Measurable, and currently unknown: where the editor actually degrades.** Spike A measured flat cost at 1.05 MB — about a fortnight. A *month* is already extrapolation, and nothing above that has been tested. **One hour's work** settles it: synthetic corpora at 2, 5, 10 and 25 MB, with realistic widget density, loaded and typed into. Widget density matters as much as byte count, so prose-only figures would mislead.

**Judgement, not measurable: how far back continuous scrolling should reach** before a jump is the better gesture. That is a question about how the notebook is used, and the honest way to settle it is to live with a number and change it.

**Strategy:** measure the ceiling, choose the extent well inside it, and treat the extent as a tunable rather than a constant.

**Deferred (D36).** The measurement waits until after a first v1 cut — safely, and for a specific reason: **v1 ships option 1**, `autoExtendOnApproach: false`, and a window that does not grow never approaches the unmeasured ceiling. The reopening trigger is therefore precise: **before that flag is set true.**

**Update (D35).** Q7's option space is now **configuration rather than architecture**: `Pane.policy` has `initial`, `target`, `cap`, `autoExtendOnApproach` and `evict`, and options 1, 2 and 4 are settings of it. Only eviction is new code. What remains genuinely open is the *measurement* — where the editor degrades above 1.05 MB — and the *judgement* about how far continuous scrolling should reach, which is answered by living with a number.
