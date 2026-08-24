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

**(c) One editor pane, or a privileged place for the stream? — PARTLY ANSWERED (D42, as amended).** The *frame* now has a place for it: an overlay pinned to the right edge, available at every width, landing on slack when there is any and covering the gutter when there is not. What remains open is the original question — whether it earns its width in use, or whether a one-key jump to today suffices. That is answered by living with it, not by measuring.

The original framing: One pane is simpler, but then jotting in today's stream while reading a note costs a navigation — friction on the highest-frequency gesture. Portal's answer was a separate capture surface: *"the widget is the capture surface, not the editor; capture is gesture, type, enter."* Probably deferrable: one pane plus a one-key "go to today", and a capture affordance only if that proves frictional.

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


---

## Q8: Where does a comment's body live?

**Status: ANSWERED — D47, option (a), fully inline.** The body is ordinary
markdown in the same file — a callout block placed immediately after the block
containing the closing marker — and the anchor is a marker pair carrying a short
file-local id. Design in `solution/comments.md`.

**The deciding argument was not the one this question anticipated.** It expected
to turn on whether a comment ever wants to be long. It turned instead on a line
between *metadata* and *content*: markers work as HTML comments because an anchor
is machine bookkeeping and a plain reader loses nothing, whereas R27 argues
commentary **is** content — so hiding a thread inside an HTML comment would make
the one part of the document invisible to every markdown renderer be exactly the
part just argued to be as much the document as the text. A contradiction, not a
tradeoff. The sidecar's remaining argument was Q9's, and Q9 dissolved.

*Original analysis, kept for its reasoning:*

**Raised by R27.** D11 already settles the *anchoring*: references are by identity,
never by stored offsets, because offsets rot the moment the text is edited by
hand. What it does not settle is where the comment's **text** goes.

**(a) Fully inline** — anchor and body both in the day file, in a marker the
renderer hides. Consistent with everything else in the format; one file is one
complete artifact; survives the tool's abandonment intact (R26). Costs: the base
text is now interleaved with commentary that a plain-text reader sees inline, and
a long comment sits in the middle of the passage it discusses.

**(b) Anchor inline, body in a sidecar** keyed by the anchor's name. The base text
gains only a short invisible marker; commentary accumulates in its own file, which
matches the Talmudic arrangement literally — one text, commentary alongside. Costs:
two files to keep together, and a sidecar whose anchors can go stale is a second
source of truth, which is exactly what D11 exists to prevent. Mitigated but not
eliminated by anchoring by identity.

**What decides it:** whether a comment ever wants to be long. Marginal notes of a
line or two argue for (a); a genuine commentary tradition — where the margin
outgrows the text — argues for (b). **Not urgent:** MV only needs the gutter
*reserved*, which neither option affects.

## Q9: Does an imported base text stay pristine?

**Status: DISSOLVED — D47.** The question's own text contains its answer, in the
clause that was written as an aside: *"for a `.docx` or `.pdf` that has been
converted, the pristine thing worth keeping may be the original file rather than
the markdown anyway."* That is not a special case — it is the general rule.

**For an imported document the pristine artifact is the original file, not the
conversion.** A rendering to markdown is already lossy and derived, so freezing
*it* protects nothing that matters; a citation points at the original.

**The uniform rule, across every inbound path:** import stores the original
untouched in `attachments/` and creates an annotatable markdown copy. Annotate
the copy freely.

This removes the sidecar's only remaining argument, so the coupling below runs
the other way from how it was written: **Q9 did not decide Q8; it stopped being
a question, and Q8 was decided on its own merits.**

*Original analysis, kept for its reasoning:*

**Raised by R28.** Annotating an imported document is different in kind from
annotating one's own writing: the base text is *someone else's*, it will not be
revised here, and its integrity may be the point.

If comments are inline (Q8a), commenting necessarily modifies the imported text.
If they are a sidecar (Q8b), the import can be left byte-identical to what came in
— and for a `.docx` or `.pdf` that has been *converted*, the pristine thing worth
keeping may be the original file rather than the markdown anyway.

**Note the coupling:** Q9 is not independent of Q8. If pristine-base turns out to
matter, it decides Q8 in favour of the sidecar. **Sequence:** answer Q9 first, by
importing one real document and trying to live with it.


## Q10: What is the mobile frame?

**Status: the layout half is ANSWERED**, on a Pixel 9, from
`design/phone-specimen.html`. What remains open is behaviour — see the end.

### What the device settled

**The type.** 20px, which yields about **35ch** at a phone's width. The 45-75ch
reading guidance does not transfer: it assumes a width you can choose, and a
phone's is fixed, so honouring it would mean 14px type. Legibility wins.

**The face and the palette carry over unchanged.** Aldine's Hoefler stack and its
warm paper were judged comfortable on the phone with no adjustment — which is a
better result than it sounds, because it means the phone needs its own *numbers*
and not its own *design*.

**The keyboard passes, which is what the sheet existed to find out.** On the real
device the caret slides gently up and down as the keyboard arrives and leaves,
and **nothing is concealed behind it** — the failure common enough on the web
that it was the first thing worth checking. The frame is sound to build from.

**Commentary: marker, with an open-all control.** Rejected: **apart**, because
separating the gloss from its text makes it hard to read — a real constraint on
Q9, since whatever keeps an imported document pristine cannot do it by putting
the commentary somewhere else. Folded and interleaved both work. The winner is
the shaded note box *plus* a visible anchor in the text; opened all at once it
becomes interleaving **with** the anchor, which is what plain interleaving loses.
So it is one arrangement with a collapse state, not two arrangements.

**Thumb reach: controls at the bottom.** The desktop's titlebar is unreachable
one-handed on a large phone; the frame is inverted rather than transplanted.

### One modelling gap this exposed

On a fixed-width screen **the measure is derived, not chosen** — size is the only
lever, and characters-per-line is the consequence. `Theme.measure` is an explicit
number, which is right for a desktop window and wrong for a phone. The mobile
milestone needs a measure that can say "whatever the width allows" rather than a
figure that happens to match one device. Small, and better known now than
discovered later.

### Still open, and deliberately

**(b) capture or reading on open** was excluded from the study's scope on purpose:
it is answered by unlocking a phone forty times over a week, not by looking at
two mocked states. It waits for v2b.

---

*Original framing, kept for the record:*

**Status:** open, deliberately unexamined, and **scheduled after MV** so the study has a real desktop implementation to be judged against.

**Why it is not a variant of D42.** D42 is an argument about horizontal budget from end to end — nav, measure, annotation gutter, capture stream, and which of them yields when the window narrows. A phone has no horizontal budget to allocate. Deriving the mobile frame from the desktop one would answer a question nobody asked.

### The three questions that actually matter

**(a) What becomes of marginal commentary when there is no margin?** R27 made commentary durable content, so the phone must at least be able to read it. The desktop's own narrow band already implements one answer — each note folded beneath the paragraph it belongs to, ruled rather than floated, giving up position and keeping legibility. That is a **starting hypothesis, not a finding**: it was designed for a 1000px window, not a 390px one, and it has never been read with a thumb.

**(b) Does the phone land on capture, or on reading?** On the desktop this tension resolved into a third column (D42). A phone cannot spend a column on it, so the same tension becomes a question about what the app *is* when opened — and R25's note that mobile must be *excellent at what it does* rather than complete argues for choosing one and doing it properly.

**(c) What does the keyboard do to all of this?** It covers something like half the screen whenever writing is happening, which is the majority of the time under (b)'s capture answer. Nothing in the desktop work has an analogue to this.

### How it must be judged, which is the part worth writing down

**On the phone, not in a narrow window on the Mac.** Proof sheets are URLs, so this costs nothing but remembering to do it. A phone layout evaluated in a resized desktop browser reproduces none of what makes a phone hard — thumb reach, one-handed use, no hover, the keyboard, and the fact that the screen is held at a different distance from the eye, which interacts directly with R1's legibility requirement.

This is the same failure the frame studies already produced once in another form: a readout that measured only the text column's left edge certified an arrangement as steady while its measure narrowed by 200px (D42). **An instrument that cannot see the failure it is pointed at converts an open question into a false answer**, and a desktop browser is exactly that instrument for a phone.

**One constraint is already settled** and does not need re-testing: vim is never used on mobile (Spike A′, D15).

### The study, as scoped

**Instrument: the keyboard transition.** On the desktop the question was whether
the text moved when the nav appeared, and the frame studies worked because a
readout measured it rather than asserting it. **The mobile equivalent is not the
nav — it is the keyboard.** It covers half the screen, it appears every time
anything is written, and whatever it does to the layout it does dozens of times
a day. D42's question, in a worse place. The sheet reports, live, on the real
device: viewport height before and after, lines of text lost, and whether the
caret's line moved.

**Scope: layout only.** The frame, what replaces the margin, navigation without
a rail, and what the keyboard does to each. Deliberately excluded is anything
that can only be judged over days rather than in a session — *does landing on
capture feel right* is answered by unlocking the phone forty times, not by
looking at two mocked states, so it waits for the real app in v2b.

**Three further questions folded in beyond (a)–(c):**

1. **Thumb reach inverts the desktop.** Our chrome is a titlebar at the top; the
   top of a large phone is unreachable one-handed. Controls belong at the bottom,
   which is not a small change — it is a different frame.
2. **Navigation with no rail.** 248px of nav is impossible, and "a hamburger that
   opens the desktop nav" is the answer to avoid.
3. **Non-Latin at small sizes.** Hebrew, Greek and Cyrillic are used heavily, and
   per-script sizing matters *more* on a small screen. A sheet with only Latin
   text is testing the easy case.

### Judged on a Pixel 9

**(a) What replaces the margin — largely answered.**

- **"Apart" is rejected.** Separating commentary into its own view makes it hard
  to read: the gloss loses the thing it is a gloss *on*. This is the strongest
  result of the study, and it is a real constraint on Q8/Q9 — whatever keeps an
  imported document pristine cannot do it by putting the commentary somewhere
  else to look at.
- **The other three all work.** Folded, marker and interleaved were all judged
  good on the device.
- **"Marker" is the preferred one, with an open-all control.** The combination
  that won is the shaded note box *plus* a visible anchor in the text showing
  which passage it belongs to. With every note opened at once it becomes
  interleaving — but interleaving *with* the anchor, which is precisely what
  plain interleaving loses. So the arrangement is not "marker versus
  interleaved"; it is one arrangement with a collapse state.

**(b) Type size beats the reading-length guidance.** The 45-75ch range assumes a
width you can choose, and a phone's is fixed, so honouring it means 14px type.
Judged on the device: **legible type at ~30ch wins.** The sheet now reports
characters per line rather than scoring against a floor.

**A finding the sheet produced before it was even opened on a phone.** On a
fixed-width screen the measure is *determined by the size* — they are one
control wearing two names — and at 412px the numbers are:

| size | measure |
|---|---|
| 14px | 45ch |
| 16px | 39ch |
| 18px | 35ch |
| 20px | 32ch |
| 24px | 26ch |

**Only 14px reaches the 45ch floor**, and 14px on a phone fights R1's legibility
requirement directly — the requirement that produced "more legible large type
sizes" in the first place. So the phone accepts a short measure; that is not a
fault to fix but a constraint to design around, and it means the desktop's
reading-length guidance simply does not transfer. What a short measure does to
prose over a long read is one of the things to notice on the device.

**One simplification.** The theme system already makes typography per-device —
the active theme is machine-local by design (D41) — so the phone needs no new
mechanism, only a `phone.json` with its own measure, size and leading. The
sheet's job is to find those numbers, not to reopen how themes work.


## Q11: What should revealing markup do to the line under it?

**Status:** open, and **more consequential than it looks**. Raised on seeing the
first construct that conceals its own delimiters.

**The tension, in one sentence.** D42 spent a whole design study establishing
that *nothing moves* — the frame reserves the nav's column and the annotation
gutter so that showing or hiding either reflows nothing. Reveal-on-cursor
violates exactly that principle **inside the line**: put the caret in a bold
word and four characters appear, the line rewraps, and everything after it
shifts. The rule the frame obeys, the text does not.

It is not hypothetical: concealing `**` is two characters at each end, an image
is an entire widget collapsing to a URL, and a table is a rendered block turning
back into pipes. The larger the construct, the larger the jump, and the jump
happens on *cursor motion* — the highest-frequency thing that occurs.

### The options, none yet chosen

**(a) Reveal on cursor — what is built now.** Simple, honest about the fact that
the document is markdown, and it is what makes the text editable at all without
a separate mode. It reflows.

**(b) Never conceal; quiet the marks instead** — the delimiters stay in the text
at reduced opacity or size, present but recessive. **Zero reflow, ever.** Costs
some visual noise, and small type at low contrast fights R1's legibility
requirement directly.

**(c) Conceal always; edit emphasis by command** rather than by typing marks.
No reflow, but it breaks the promise that this is a markdown file you can type
into, and R26's exit depends on that promise being real.

**(d) Reveal at line granularity** — the whole line the caret is on shows its
source, always, rather than the construct under the caret. Still reflows, but
once per line and predictably, and the eye is already on that line.

**(e) Reserve the marks' width** — conceal them but keep their advance width, so
revealing changes glyphs rather than metrics. Works for delimiters, does not
generalise to widgets, and produces odd-looking gaps.

### Every option above has been rejected, and why

Reviewed and **none of the five is satisfactory**. The reasons are worth keeping,
because they narrow what a sixth option has to do:

- **(a) and (d) do not solve the problem**, they only change its grain. The
  visual jump is still there; (d) merely makes it happen per line instead of per
  construct.
- **(e) reserving the marks' width looks terrible.** Rejected on sight.
- **(b) quieting the marks is the best-looking of the five and still fails two
  ways.** It is a *display* trick, so it goes wrong the moment the display is
  not the screen: **printing** a range (R11) would put the delimiters on paper.
  And it does not generalise — there is no "quiet" rendering of a table or a
  block of TeX, which are the constructs where the jump is largest.
- **(c) conceal always, edit by command** works for bold and italic, where the
  markup is two characters, and not for anything else.

**The common failure:** all five were framed around *delimiters*, and the hard
cases are the block constructs — tables, display equations, images — where
"reveal the source" means replacing a rendered object with several lines of
text. A solution that only handles emphasis has not addressed the question.

**Held open deliberately.** There are likely approaches not in this list; the
five here are the obvious ones and the obvious ones are not good enough. What is
built now is (a), which is honest and reflows, and it stays until something
better is found rather than being replaced by the least-bad of a bad set.

### What constrains the answer

**Vim, which has already forced one decision here.** Spike A found that vim
ignores `atomicRanges` — the cursor froze at a widget edge — and reveal-on-cursor
was made *mandatory* as the fix (D15, D16). Option (c) is therefore probably
unavailable while vim is on, which may mean the answer differs by mode, which is
its own kind of surprise.

**And it interacts with the gutter.** Once marginal commentary exists (R27), a
reflow does not merely move text — it moves text away from the note anchored
beside it. Whatever this settles on has to still be true when the margin is full.

**How to settle it:** not from this list. Live with (a) meanwhile — it is built
and it is honest — and treat the printing case and the block constructs as the
two tests any candidate has to pass, since those are what killed the best of the
five. The frame studies are the precedent for *how*: build the candidates and
react to them rather than argue.

## Q12: What does a purge actually promise, and what is the threat model it serves?

**Status: ANSWERED — D46**, and the answer is that the primary notebook promises
*durability*, not deletion, and stops pretending otherwise. Genuine deletion
moves to a second notebook whose storage is shreddable by construction. The
threat model that drove the question is recorded below and has substantially
decayed; what survives is not an adversary but a need — somewhere to think
without the thinking becoming permanent.

Raised on completing the purge procedure (T10, `purge-procedure.md`), which
works and is not enough. The material below is kept for its reasoning.

### Why the procedure is not the answer

**It is manual.** Eight steps, several of them irreversible, run by hand while
upset. Step 2 instructs you to make a backup containing exactly the thing you
are destroying, and then to remember to destroy the backup.

**It does not survive the mobile client.** v2b multiplies clones. A rewrite is
local to one repository, so every device needs the same procedure run on it, and
a force-push does not reach into a clone. The current document assumes roughly
one machine, which stops being true at exactly the milestone that makes the
notebook genuinely useful.

**On a hosted remote the last step is a support ticket.** GitHub's own guidance
for fully removing sensitive data ends by asking you to contact support to have
cached views and references garbage-collected. That is a request, not an
operation — its execution depends on someone else's willingness and ability, and
neither is verifiable from here. **A purge whose final step is "file a ticket
and hope" should not be described as a purge.**

### What the question actually is

Not "how do we make the procedure better" — incremental improvement to a
procedure with these properties produces a longer procedure with the same
properties. The question underneath is:

- **What is the threat model?** Who is the adversary, what do they have access
  to, and what is the notebook actually protecting against? The corpus holds
  other people's information, which is what makes this more than hygiene.
- **What can this architecture honestly promise?** Durable history and reliable
  deletion are in tension by construction (D32 says so plainly). Naming which
  side wins, and where, is a design decision that has not been made.
- **Does some content need never to enter the history at all?** A separate class
  of note, excluded from versioning by design, is one possible answer and has
  consequences everywhere — sync, search, the format.
- **Does the choice of remote become a requirement?** Self-hosted storage where
  `gc` is ours to run is a materially different guarantee from a hosted service.

### Why it is deferred rather than answered now

It needs to be thought about **end to end**, not patched. And the exposure is
bounded meanwhile: v1 has no remote, so the corpus lives on one machine, and
D36 already sets the deadline at the first *push* rather than the first commit.

**Recorded so the next design cycle inherits the reasoning rather than
rediscovering it.**

### The adversary, supplied 2026-08-22 (`notes/02 next steps.md`)

The question above asks "what is the threat model?" and left it blank. It is now
named: **politically sensitive writing, against an adversary who can compel a
hosting provider to produce data.** GitHub is the named example. The stated want
is to write *truly privately*, in a way not easily subject to seizure.

**This retires the deferral's safety argument, and that is the first consequence
to face.** "v1 has no remote, so exposure is bounded to one machine" was written
against an adversary who is a *hosting provider*. Against one who can compel, a
laptop is not a bound — it can be seized, imaged at a border, or copied wholesale
by a backup the corpus never sees. `purge-procedure.md` already lists Time
Machine first among the things a purge cannot reach; under this adversary that
line stops being a caveat and becomes the main exposure. **The premise behind the
deferral no longer holds, even though the deferral of the full cycle may still be
right.**

**Two things follow immediately, before the cycle runs.**

- **Step 2 of the purge procedure is now actively dangerous advice.** It
  instructs the operator to make a complete plaintext copy of exactly the thing
  they are destroying, and to remember to destroy it later. That is defensible
  against fat fingers and indefensible against seizure.
- **One sub-question is format-visible and therefore cannot wait for the rest.**
  "Does some content need never to enter the history at all?" implies a *class*
  distinction in the corpus. Classification cannot be backfilled — content
  written before the class exists is already in the history, and the only way out
  is a purge. Every day until it is answered is a day of unclassifiable
  accumulation. See the sequencing note in `notes.md`.

**A structural rhyme worth carrying into the cycle, so it is not re-derived.**
Encrypt-at-rest versus plain files is the same fork as Q2's CRDT versus plain
files: encrypted blobs do not diff or merge, search needs decryption, and R26's
exit weakens to "readable if you still hold the key." Q2 resolved by refusing the
whole-corpus answer. The likely resolution here has the same shape — separate the
sensitive class rather than encrypting everything — but it should be *argued*,
not assumed.

**And encryption does not reach the metadata.** A hosted remote knows the account,
the commit times, the sizes and the cadence, whatever the blobs contain. That is a
stronger argument for self-hosting than the `gc`-control one recorded above.

### Refined 2026-08-23 — and most of it retires

The adversary above was stated broadly. Examined properly it separates into two,
**both of which have substantially decayed**, and the content at issue turns out
not to be what the first framing assumed.

**What is actually at risk is not operational material.** Nothing that could
expose a name or an identity was ever going to be written down anywhere; that is
settled and is not a design input. The category of concern is narrower and more
particular: **sitting down to work through a complex idea and, in the course of
it, directly broaching facts that are not normally discussable.** The value is in
the working-through, which is exactly the activity this project exists to
support, so the material cannot simply be characterised as regrettable.

**Adversary 1 — civil discovery, and it is gone.** As an officer of a major
corporation, private views were routinely subpoenable across a range of suits
against the company, and an officer on record calling a direction harmful or
merely useless was a serious liability. This was the dominant risk by expected
value precisely because it was *routine*: broad, automatic, frequent, and
requiring nobody to have targeted the writer at all. **The officer role has
ended, and with it this threat.**

**Adversary 2 — political targeting, and the evidence is already public.** The
writer is publicly and widely known as a political undesirable. Adversaries who
act on that do not need evidence and are not gathering it; the notebook is not in
their attack chain, though it was a few years ago. **The trajectory is judged
decreasing rather than increasing.**

**What follows.** The expensive answers lose their justification. Encryption at
rest cannot pay for the merge story, the exit and twenty years of key custody
against a threat at this level, and self-hosting is not load-bearing either. The
cheap answer — **do not use this system for these subjects** — becomes the
primary control rather than a counsel of despair.

**Three things survive the retirement, and only the third needs design.** They
are recorded in the brainstorming pool: confidentiality obligations that run with
the information rather than with either adversary; the difference between public
*facts* and private *texture*; and the question that decides whether scoping
works at all — **scoped to where?** A rule excluding a subject from Tephra is
viable only if the thinking has somewhere else to happen. If it does not, the
rule is self-censorship wearing a policy hat, and that is the failure this whole
question exists to avoid.
