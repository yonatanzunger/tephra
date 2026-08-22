# Notes

The project is **Tephra** (D2) — volcanic ash fall, and tephrochronology is the dating of strata by their ash layers. A continuous accumulation of deposited fragments, readable in order, datable by position.

## Where this came from

This project was extracted from **Portal** (`../portal`), a Mac+Android tool for jumping between projects: Space switching, launch manifests, git-backed storage, a dashboard against project neglect. Portal's design is complete through architecture and 53 recorded decisions. Working through its open items, the notebook — originally one integration among six — turned out to be where nearly all the value was: *"if I had this sort of high-powered notebook app, it would actually solve more than 90% of my problems, even without the rest of Portal."*

Portal is **paused, not abandoned**, and a large amount of its design carries over. See `carried-over.md` for the inventory.

## The idea that made this a different project

**Subjects replace projects, and they are tags on ranges rather than containers.** In Portal a project contained a notebook; here one notebook stream is marked up with subjects. Three things fall out, and they are why this is a smaller and better design:

- **Capture stops having a routing decision.** "Which notebook does this go in?" was the friction Portal's entire Space-inference machinery existed to answer.
- **"Move a range between notebooks" evaporates** — the most demanding requirement in Portal's notebook design (cross-project writes, copy-verify-delete, travelling images, breaking links) becomes retagging.
- **Overlap becomes natural.** A range that is both "house deal" and "legal" is trivial for tags and impossible for containers.

A model that *deletes* the hardest requirement rather than solving it is usually the right model.

## What this reprioritizes

**Search and filtering move from deferred to load-bearing.** If a subject is a filtered view over one stream, then finding and filtering *is* the product. Portal deferred search to v2; here it is the bet the whole design rests on — a single undifferentiated stream with weak filtering is worse than several small notebooks, and much better with good filtering.

**TODO stops being hard.** Lists with state, due dates and urgency are a text feature. The genuinely difficult part in Portal — the cross-project unified view — was what forced ambient mode, cross-project writes and the `extract` argument, and it is simply not needed.

**The integration architecture mostly evaporates**, since this is one app over one folder rather than a shell hosting six typed plugins.

## Open at the moment of the split

- **Storage is undecided and should stay that way until requirements are written.** Git is not sacred, but it was meeting four requirements that do not go away: multi-device sync, offline operation, non-lossy reconciliation, and rewindable history. "Strong consistency" and "keep working on the flight" are in direct tension — the real requirement is *local-first with deterministic reconciliation*.
- **Plain files and excellent automatic merge pull against each other.** CRDT sync merges without conflicts by construction, but then the CRDT is the source of truth and plain files are an export — which cuts against "in case one day I decide this isn't the tool for me." Files-as-truth keeps the exit and makes merge your problem. A real fork, and it deserves to be a decision rather than a default.
- **"Extend markdown" and "generic format so I can leave" also pull against each other.** The resolution is presumably that extensions degrade gracefully to something a plain reader finds sensible — but that is a constraint on every extension, easier to adopt now than to retrofit.
- **Native on two platforms, or web-based?** This changes the size of the project by an order of magnitude. The user's macOS experience is decades old and their Android experience slight; platform scaffolding was already flagged as Portal's real risk, and a rich cross-platform editor concentrates it. There is a hint of a web path — the Clarity Agent UX is named as something to extend.

## Design principles established here

- **This is a tool, not a companion.** The reason *paredra* was rejected as a name (D2), and it generalizes well past naming: nothing in the interface should acquire a persona — not copy, not error messages, not any assistive or generative feature. The register is "substance," not "someone."
- **The visual reference is the Clarity app's styling**, not the user's custom VSCode themes. Those were designed for reading and editing *code*; long-form prose is a different visual problem. `[for: prototype]`
- **Check which era a claim comes from before resting an argument on it.** The events calendar was attributed to era 2 (the excellent one) when it actually came from era 3 (the failed one) — which inverted the conclusion, since era 3's version was an Excel sheet and therefore evidence for *less* machinery, not more.

## Carried discipline

Portal's `notes.md` accumulated design lessons that were expensive to learn and are not project-specific. The most load-bearing ones:

- **Take a generalization exactly as far as it deletes concepts, and no further.**
- **Don't contort a file format to suit a generic algorithm when you can teach the algorithm about the format.** Ask what the file is *for* before optimizing any property of it.
- **Hand-editing is a feature**, so every format and every merge rule must degrade gracefully when a human has been in there — parse leniently, serialize precisely, round-trip untouched lines byte-for-byte.
- **Size a safety margin against the failure's visibility, not just its probability.** Silent failures deserve margin well past what their rate justifies.
- **Confirm a load-bearing capability by exercising it, not by finding vocabulary that names it.**
- **A rationale can expire when a later decision changes the substrate underneath it.** Periodically re-read old rationales and ask which premise each rests on.

## Rules established while sequencing

- **Data cannot be backfilled; mechanisms can be deferred.** A deferral is safe when what is deferred is a *mechanism* over data already being recorded, and unsafe when the data itself only begins existing at the later stage. The test for any staging: *if this is built in v3, will the corpus from v1 and v2 support it?* `[for: architecture-design]`
- **A cache may be discarded and refilled from truth; a replica may not.** Whenever local storage is described as a cache, check whether there is a window in which the local copy is the only copy. If there is, the word is wrong, and the recovery paths built on it will lose data.
- **Distinguish a file's declared type from its syntax.** Three UXes need not mean three formats. Explicit typing is required for merge correctness; a bespoke syntax is a separate and much more expensive choice.
- **Before putting something in a spike, ask whether it is empirically uncertain or merely unbuilt.** A windowed-document task sat in the spike plan until the user pointed out it was construction, not discovery — every part of it was reachable by reasoning, and its one real unknown was already covered by another spike. The complement of "confirm a load-bearing capability by exercising it" is: don't exercise what you can reason about, because a prototype carried into production is debt from day one.
- **Choose reference-maintenance policy by cardinality.** Few referrers that must resolve instantly get updated on write; many referrers that tolerate ambiguity resolve on read and surface a picker. A uniform rule is wrong in one direction or the other.
- **Three times now, the deciding evidence was a person typing, and three times the instruments saw nothing.** Vim against non-vim, WebKit against Chromium, and the fluidity hunt in between. For this project's editing surface, measurement exists to catch a disaster, not to choose between good options — so build the thing that can be typed in early, and do not wait for a number to justify a preference. `[for: architecture-design]`
- **Check whether a question's premise still holds before answering it.** Q4 was framed as "which stack makes OS integration affordable," and the honest answer was that OS integration was never expensive — the evidence behind the framing was about Tauri specifically. A spike that only compares the candidates would have missed that; the one that measured the absolute cost found it.
- **When a surface "feels off" but measures fine, bisect the surface rather than the number.** Spike A's fluidity problem never appeared in keystroke-to-paint, in the insertion path, or in any of seven candidate subsystems measured individually — it appeared the moment the user could toggle one feature at a time and type. Build the toggles; the instrument that matters is the person.
- **A criterion with a threshold needs a control before it can be scored.** "p99 under 30 ms" looked decisive until the same measurement over a plain `<textarea>` came back at 17.5 ms — most of the budget was the display pipeline, not the editor. Measure the floor on the same machine before reading a number as pass or fail. `[for: requirements]`
- **Before granting a layering exception for performance, check whether the problem arrives before its own fix does.** A rule letting search grep the directory directly was written to avoid re-reading the corpus — but v1 scans in milliseconds, and by the time scanning is slow the index has arrived on its own merits. The optimization bought nothing and would have relocated format knowledge into a layer that cannot hold it.
- **Every rule in an implementation note must carry the failure it prevents.** A rule without a reason reads as an oddity and gets optimised away by whoever touches the code next — who is usually the same person, later.
- **A path that fires once every few years is broken when it fires.** Rare paths need a test that forces them; waiting for the condition to occur naturally means discovering the bug at the worst moment.
- **"Don't depend on anything" is really a question about which kind of dependency.** A *system* dependency risks presence, version skew and the user's environment. A *bundled native* one moves that fragility inside the build. A *pure-language* one has the simplest build story and inherits the library's limits. Only the first is categorically bad. `[for: architecture-design]`


## The instrument gap, fourth instance — and what closed it

Building the frame (D42) produced four failures in a row that no assertion in
this project could have caught, and each was found by a different accident:

1. **The measure was never applied.** CodeMirror lays its scroller out as a flex
   row and gives `.cm-content` `flex-grow`, so a plain `width` was stretched away
   and the measure silently became "whatever is available" — the exact failure
   the frame exists to prevent, arriving through the back door. Found by dumping
   the computed geometry, not by any test.
2. **The folded column collapsed to zero.** With `flex: 0 0 auto` and `width:
   auto`, shrink-to-fit around an empty document is 0px. Every steady/steady
   check passed while the text column had no width at all.
3. **A build that failed and a harness that ran anyway.** A duplicate binding
   broke the renderer build; `npm run build --silent` swallowed it, the app
   launched the previous bundle, and the measurements looked plausible. This is
   the second time a silently stale harness has produced confident wrong answers.
4. **The heading size compounded.** `1.85em` on the line *and* `1.85em` on the
   inline mark rendered at 3.4em. It looked like a display face rather than like
   a bug, and no test asserts font sizes.

**Two patches that were themselves instruments, not fixes.** `TEPHRA_WINDOW_WIDTH`
exists because this desk's display is 1512px and D42's rules change at widths it
cannot produce — a rule only ever exercised on its refusing branch is a rule
nobody has tested. It needs `enableLargerThanScreen`, because macOS silently
clamped a 2000px request to 1512 and the harness dutifully reported the refusal
as though it had been checked.

**`TEPHRA_SHOT` is the standing answer.** It writes a PNG of the window and
quits. Every test here checks state, which is why hand-testing — not the suite —
found the invisible selection, the cut-off proof sheet, the sans-serif Hebrew,
and now the compounded heading. A visual milestone needs an instrument that
looks at pixels, and looking at one screenshot found in a second what 140 passing
tests could not see.
