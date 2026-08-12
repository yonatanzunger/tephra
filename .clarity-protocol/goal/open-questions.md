# Open Questions

Five genuine unknowns, ordered by how much they constrain everything else. Q1 and Q2 should be resolved before any substantial building.

## Q1: Can one editing surface be vim-compatible *and* render figures, equations and tables inline?

**Status:** open, and narrower than it first looked
**Why it matters:** Decides the technology of the whole desktop app; R1.4 and R2.7 are both hard requirements pulling against each other.

**The intended model is two modes over one document** — raw markdown edited with vim, and rendered markdown viewed *and edited* visually, switched between rapidly. That is a well-trodden shape (Obsidian's source/live-preview/reading modes, Typora, Zettlr), and the foundation it rests on is a plain-text editor with a genuine vim mode that also supports **inline widget decorations**. CodeMirror 6 is exactly that combination, which is why Obsidian can offer both at once; mode switching becomes a decoration toggle rather than two editors.

**The cost is concentrated in one place: editing in the rendered view.** Rendered *reading* is nearly free. Rendered *editing* means the markup must be managed on the user's behalf — cursor enters a node, markup reveals; cursor leaves, it re-renders. That works well for inline constructs (emphasis, links, headings) and poorly for tables and equations, which usually want a dedicated editing affordance instead. So this decomposes: ship raw+vim and rendered-read first, then add rendered-edit per node type in order of value. **Tables and equations are the expensive ones and can wait.**

**Strategy:** prototyping. The experiment is defined in `goal/discovery/spike-01-experiment.md` — **Spike A**, a plain browser page, which answers this at zero platform cost. Its sharp edge is not rendering but **vim operating over widgets**: what `dd` does to a line holding a rendered equation, whether motion, visual selection and undo behave across one.

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

**Strategy:** confirm, then prototype narrowly — aimed at the divergence picker and atomic writes, which are the parts that still have to work.

## Q3: What replaces the filling page?

**Status:** open — but half of it resolved, and the two halves turn out to be different jobs

**Resolved: due dates are genuinely needed, and the era-2 failure tells us what the feature must do.** They existed in era 2, hand-implemented as `DUE 5/4` in a drawn box, relying on the visual to catch the eye. That worked at small scale and **degraded as the number of dated tasks rose** — a scanning mechanism that fails when there is too much to scan. So the digital requirement is not merely to *store* due dates but to **rank and surface by urgency so the eye never has to scan**, which is what R16 asks for and now has a reason and a known failure mode behind it.

**Still open: the forced review**, confirmed as a real feature rather than an artifact. Era 2's full spread compelled live items to be transcribed forward; everything else died by omission — cheaply, visibly, by decision rather than by neglect. Digital lists never fill, so that never happens. The two mechanisms do **different jobs**: a due date answers *"this has a deadline,"* a forced review answers *"is this still alive at all."* Building both is right; the question is only what the second one looks like.

**The intent is to experiment as the tool evolves**, which makes this a design constraint rather than a design: nothing should foreclose a review rhythm later. **One cheap thing to do now:** record a *last-touched* timestamp on every TODO item from the start. No mechanism can ask "what has gone stale" without it, and adding it retroactively means every existing item looks equally fresh. Marker now, mechanism later.

**Strategy:** thinking, then experimentation in use.

## Q4: What stack, given that OS integration is a real cost?

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

## Q5: How much does mobile actually need to do?

**Status:** open
**Why it matters:** Bounds the most expensive part of the build. "Hard to think of functionalities I wouldn't want" is a maximal answer, but era 3's mobile failure was that it was *barely functional* rather than incomplete — so the requirement may be **excellent at less** rather than equal. Vim is desktop-only by nature; screen real estate makes range selection, fileset browsing and long-form writing genuinely different problems on a phone.
**Strategy:** thinking. Probably resolved by listing what is actually done on the phone in a typical fortnight, rather than in the abstract.
