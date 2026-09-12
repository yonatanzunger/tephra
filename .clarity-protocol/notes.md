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

> **Half-retracted (`goal/todo.md`).** The *storage* is indeed a text feature, and the prediction that it would be record-shaped was wrong. What is hard is nothing to do with representation: a list must make its owner think twice before adding, and must never let an item it holds go unseen, and those two pull opposite ways. That is the design problem, and it was invisible until the eras were read closely.

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


## `npm run typecheck` was doing nothing at all

Moving the vim toggle into a menu broke the app at runtime — `CHANNEL is not
defined` in the main process, from an import I forgot to add. `npm run typecheck`
had reported success moments earlier.

The script was `tsc --noEmit -p tsconfig.json`, and that root config is
`{ "files": [], "references": [...] }`. **`tsc -p` does not build referenced
projects** — only `tsc --build` does. So it compiled the empty file list, found
nothing wrong, and exited zero. Every green typecheck in this project's history
meant nothing.

Switching to `tsc --build --force` exposed why it had never been noticed: both
referenced configs use `baseUrl`, removed in TypeScript 7, so they would have
failed *immediately* if they had ever run. The no-op hid its own cause.

Underneath were **25 real errors**, none of which broke anything at runtime:
`allowImportingTsExtensions` never set although the codebase imports `.ts`
extensions throughout; `@types/react` never installed; no declaration for
side-effect `.css` imports; `buildBlocks` annotated as returning `Decoration[]`
when it returns `Range<Decoration>[]`; a stand-in interface in `verify.ts`
narrower than the code using it; and — mine, from an hour earlier — `measureCh`
sitting in a module whose header says it touches no DOM.

**The lesson is not "check the config".** It is that *a passing check is
evidence of nothing until the check has been seen to fail.* Every instrument in
this project that has misled us shares that shape: the left-edge readout that
had no arrangement to catch until a deliberately broken one was added; the
window-width harness that reported a refusal because macOS silently clamped the
window; the build whose failure `--silent` swallowed while the app ran a stale
bundle. **Before trusting an instrument, break something on purpose and confirm
it says so.**

## The app was scrolling as a page

Found in the same sweep, by looking at a screenshot and asking why the titlebar
was missing rather than assuming the editor had scrolled.

`.frame` is a grid whose single implicit row was `auto`, so it sized to its
tallest content — the whole document — and the reading column grew to 1270px
inside a 914px frame. `#root` became a scroll container, and CodeMirror's
`scrollIntoView`, walking up for a scrollable ancestor when restoring the caret,
scrolled the entire application and carried the chrome off the top of the
window. The row needs `minmax(0, 1fr)`; `overflow: hidden` on the document is a
second line of defence, not the fix.

It had been visible in *four* consecutive screenshots, read each time as "the
cursor was restored a bit low."


## Redo has never worked for a typed run

Found by wiring Edit ▸ Redo and insisting on watching it work rather than
watching it not throw.

`#push` groups consecutive `user` edits so that a typed sentence is one undo
step. It merges the two entries' `inverse` maps — correctly, which is why undo
of a grouped run is right — but keeps only the **newest** entry's `change`. Redo
replays `entry.change.edits`, so it replays the last edit alone, at offsets
belonging to a state that no longer exists once the undo has run.

The existing `redo puts it back` test passes because it uses a single
`operation` edit, and operations never group. **The one shape a person actually
produces — typing — was the one shape untested.**

**Fixed.** In use it did not fail quietly, it threw:
`OverlappingEditsError: span 141..141 outside text of 135` — a stored offset
pointing past the end of a text that had shrunk back under it.

`#stepBack` now derives **both** directions while it is holding the two texts:
the undo edits as `minimalReplacement(before, after)`, and the redo edits as
`minimalReplacement(after, before)`, each in the coordinates the other side will
actually see. The redo entry carries those instead of the original forward
edits; `inverse` is passed through unchanged, since after a redo the body is
back to exactly the state that map transforms. Redo is now symmetric with undo
by construction rather than by the hope that old offsets still apply. The test
is promoted from `todo` to passing, and the app does it end to end.

**Two process notes, both about the cost of a bad first measurement.** The scene
that found this originally inserted both strings at the same offset, because it
read the caret rather than the buffer end, and the caret had not advanced. That
produced overlapping inverse deletes, a shape typing never makes, and for a
while it looked as though *undo* were broken too. An unrepresentative test is
worse than no test: it sends you after a bug that is not there.

And `python3 - <<'PY'` patch scripts print their success message whether or not
the target string matched, so a silently-skipped edit reads as a completed one.
They now exit non-zero when a target is missing. This is the third variant of
the same failure in one session — a stale build behind `--silent`, a typecheck
that compiled nothing, and now a patch that did nothing while saying it had.


## The application menu says "Electron", and `app.setName` cannot fix it

macOS takes the bold application-menu title from the **bundle's**
`CFBundleName`, not from anything the process sets at runtime. `app.setName`
does work — Electron's own menu model reports `About Tephra` and `Quit Tephra`,
which was worth measuring before concluding anything — but unpackaged we run
inside `node_modules/electron/dist/Electron.app`, and that bundle is called
Electron.

Real packaging (electron-builder, `productName`) is the proper fix and is
unscheduled (`milestones.md`). Until then `run.sh` renames the development
bundle in place with PlistBuddy: idempotent, undone by any reinstall of
electron, harmless if the plist moves. `productName` is set in `package.json`
so packaging will do the right thing when it arrives.

Worth noting as its own small lesson: the first instinct was to conclude
`app.setName` had not run. It had. **Two different things were both called "the
app name", and only measuring which one the OS reads told them apart.**

## The harness supplied a tag the published page did not

The phone sheet measured correctly on the desktop and rendered wrong on a real
Pixel: type set at 24px displayed at roughly a third of that, and the measure
read ~80ch instead of ~30ch. Both symptoms have one cause. **Without
`<meta name="viewport" content="width=device-width">`, mobile Chrome lays a page
out at a notional ~980px and scales the result down** — and the artifact wrapper
supplies the `<head>`, so the file could not declare one.

The reason it was invisible for a whole build cycle is the part worth keeping:
**my puppeteer harness injected the viewport tag itself**, in the string it wrapped
the file with. So the instrument was measuring a page that did not exist. Every
number it reported — 35ch at 18px, 25 visible lines, tap targets passing — was
true of the harness's page and false of the published one.

Fixed by appending the meta from script before layout, and the harness now wraps
with a bare `<head>` so it can only measure what the artifact actually is.

**Same shape as the doctype incident earlier in this project**, where local
screenshots rendered in quirks mode and the published page did not. Both are the
same rule: **a test rig that constructs a slightly friendlier environment than
production is not a test rig.**

## Non-ASCII in a file whose encoding you do not control

Em dashes and Hebrew arrived as mojibake on the phone. A `charset` declaration
has to be in the first 1024 bytes and cannot be added later by script — so with
the `<head>` outside our control, the only robust answer is **not to depend on
the declared encoding at all**: the source is now pure ASCII, with numeric
character references in HTML, `\NNNN` escapes in CSS and `\uNNNN` in JS. 671
characters converted, verified by asserting zero bytes above 127 remain.

Worth remembering for anything else published this way: **portable means ASCII
when the wrapper owns the head.**

# Two principles, and the evidence for them

Stated by the author after a review in which both were violated three times in
one sitting. Recorded here rather than in a decision because they are not about
this project.

## 1. Start from the simple and stupid solution. Get fancier only for a specific reason.

The storage layer was built three times in an afternoon:

| version | what it was | why it went |
|---|---|---|
| tracked paths | a set accumulating what the app wrote, fed by the writer and the watcher | the performance claim behind it had never been measured — whole-tree status is **0.19 s** on a twenty-year corpus |
| hand-rolled hashing | comparing blob ids by hand, plus a parameter for feeding it paths | `git add -A` already does this, correctly, because `add` hashes as it walks |
| `add -A` | eleven lines | — |

197 lines became 135, an accumulating set in the service disappeared, and the
writer stopped having to report what it wrote. **The simple version was also the
more correct one**: a tracked-path list silently omits anything written by a
code path that forgets to report itself, and a scan has no such gap. That is the
part worth remembering — the fancy version was not a trade of simplicity for
safety. It was worse at both.

## 2. Each subsystem's API uses the nouns and verbs native to *it*, never to its implementation.

`Repository.commitAll()` returning a forty-character string is an API describing
its mechanism. The cost is not aesthetic: **the moment the interface says
*commit*, every layer above starts thinking in git, and the choice of git stops
being a decision and becomes an assumption.** D34 already schedules a revisit at
v2a; that revisit is only cheap if the seam exists before it is needed.

It became `save(reason) -> VersionId | null`, with `versions`, `contentAt` and
`moveTo`. And the leak had already spread one layer up — `DocumentService`
had `commitNow`, `#scheduleCommit`, `COMMIT_QUIESCE_MS`. **Renaming an interface
without renaming its callers relocates a leak rather than removing it.**

## What actually caught them, which is the useful part

Both principles are easy to agree with in the abstract and hard to apply to your
own code in the moment — because when you write the complex version you have a
reason in your head, and the reason feels sufficient. "Whole-tree status is
O(files)" is a real sentence about a real property. It was just never checked
against a clock.

Every one of these was found by an outside reader asking a version of the same
question: **"why doesn't this look like the way that is normally done?"**

- *"Why aren't we just doing `git add`, `git commit`?"*
- *"I've never seen a call to `git add` have this problem."*
- *"`commitAll` leaks an implementation detail into the API."*

So the operational form of both principles is a review question rather than a
design rule: **the ordinary way is the null hypothesis, and departing from it
requires a reason that has been checked, not merely held.** An unfamiliar shape
in a well-worn operation is a bug report about the code, not evidence of care.

## Three items raised at M1, and how the coupling dissolved

From `notes/02 next steps.md`: a comment extension to markdown, an
import-and-annotate flow, and the inadequacy of purging. The third looked
upstream of the other two, because Q12's "does some content need never to enter
the history at all?" implied a **class** distinction the comment format and the
import path would both have to carry — and a class cannot be backfilled.

**D46 removed the coupling instead of resolving it.** The boundary became a
separate notebook with different storage rather than a class within one corpus,
so no format work is owed and M2 was never actually blocked. Recorded because the
*shape* recurs: when a distinction threatens to propagate into every mechanism
that can cross it, moving the boundary out to a coarser container may delete the
propagation entirely. The directory was a boundary the OS, git and the backup
software already understood; the class would have had to be taught to each of
them.

**Two lessons kept from getting there.**

**Check which premise a requirement was derived from before citing it.** "Zero
routing" looked fatal to a second notebook until it turned out to have been
derived from routing *by subject*, which is intolerable because subject is
**retrospective**. Sensitivity is prospective — known before the session, two
destinations, decided once on opening. The requirement did not transfer, and
would have killed a good design if quoted at its original strength.

**A destination with friction is not a destination.** The paper-and-typewriter
answer was opsec-perfect and access-poor, which is precisely how eras 1 and 2
failed in `precedent.md`. Any "just use the other thing" mitigation should be
checked against that record before it is believed.

## The harness was eating the operator's keystrokes

One M1 acceptance run reported three failures that never reproduced across eight
subsequent runs. The explanation was not nondeterminism in the app: **the
acceptance run opens real, focusable editor windows, they take focus as they
appear, and notes being typed elsewhere went into the notebook under test** —
changing the thing being asserted about, mid-assertion.

Fixed by showing verification windows with `showInactive()` rather than
`show()`. Everything still passes without focus, including the selection scene,
which was the one that looked most likely to depend on it.

**The general form is worth keeping.** A test rig is a program that runs on a
machine somebody is using. If it can take focus, grab input, write outside its
sandbox or pop a dialog, then its results are conditional on the operator
sitting still — and "it failed once and never again" gets filed as flakiness
rather than as the rig reaching outside its own boundaries.

This is the same family as the earlier instrument failures, and the fourth
entry in it: **an instrument that perturbs what it measures is not measuring.**
Previously the perturbation was the harness giving the page a viewport tag the
real artifact lacked, or `--silent` hiding a failed build. Here it was the rig
competing with a human for the keyboard.

## Packaging: three failures, and only one of them was the app

Packaging is where "works in dev" and "works shipped" come apart, and it took
three rounds to tell those apart from each other.

**1. A real bug, mine.** `VERIFY_MODE` was a module-scope `const` reading
`app.isPackaged`. Reading Electron's runtime while modules are still being
evaluated throws — `Cannot read properties of undefined (reading 'isPackaged')` —
and in a packaged build that killed the app before it wrote a single line: exit
0, no window, no crash report. Now computed on first call and memoised, so it is
still decided once and can still not be switched on mid-session.

**2. Ad-hoc signing is not optional on Apple Silicon.** arm64 macOS will not
execute a binary with no valid signature. A packaged Electron app inherits
Electron's own ad-hoc signature and then invalidates it, because packager renames
the executable and rewrites `Resources`. `spctl -a -vv` says so plainly —
*"code has no resources but signature indicates they must be present"* — and
nothing else does. `codesign --force --deep --sign -` fixes it, free and without
an Apple account. **I had told the author unsigned was fine; on this hardware
there is no such thing.**

**3. The one that wasted the most time was the environment, again.**
`ELECTRON_RUN_AS_NODE=1` is set in this shell. My launches of the packaged
binary inherited it, so Electron ran as plain Node: exit 0, no window, and
`Cannot find module 'electron'`. Identical symptoms to (1), and entirely a
property of how I invoked it. `run.sh` has unset this since M0 and every test
harness deletes it; **the one path that had never been given the same treatment
was the one I invented that afternoon.**

Also lost and recovered along the way: `package.json`'s entire `scripts` block,
clobbered by editing the file in the same shell command as `npm install`. Two
writers, one file. Restored from the committed copy, which is the argument for
committing early rather than for editing carefully.

### The instrument lesson, one more time

Both of my "the gate holds, no back doors" results were taken from runs where
**the app had never started**. Empty output read as "nothing leaked" when it
meant "nothing happened". The check that finally meant something asserted the
app *had* started — `.tephra/` exists — before asserting what it did not do.

**A negative result is only evidence if the positive control fired.**

## A post-mortem beats a log when the fault is a race

The comment-in-the-margin intermittent could not be watched: every `console.log`
placed on the path changed the timing enough to make it stop happening, twice in
a row, which cost two rounds of investigation to a heisenbug.

What worked was asking **after** the failure instead of during it. A verify-only
`diagnose()` returns what each window is holding — lengths, and whether its
segment is the same object the document has cached — and the scene calls it only
when the note fails to appear. One line of output named the fault:

```
diagnose: [{ id: 1, text: 258, segments: [{ date: '2026-08-24', raw: 258, prose: 258, same: false }] }]
```

The general form, worth reaching for next time: **when observing changes the
outcome, stop observing the event and interrogate the wreckage.**

This is also the sixth entry in the instruments list, and the second where the
instrument's own presence was the problem rather than its honesty.

## A ritual can have a job other than the one it looks like

Era 2's morning copy-and-trim of the TODO list looked like a review — prune the
dead, carry the living. It was read that way for the whole life of this project,
and R16a and Q3 were both built on that reading.

It was wrong, and the evidence was sitting in the same record. Era 2 groomed
**daily**; era 1 groomed only when a two-page spread filled, which was far less
often. Era 2's list grew much larger. A more frequent review produced a longer
list, so the review was not what kept era 1 short — *entry cost* was. Review
kills stale items; it does not prevent accumulation.

And the ritual's real value turned out to be something else again: it is how the
list gets loaded into the head at the start of a day, which is worth doing when
the list is short and nothing needs pruning at all.

**Before designing a mechanism to replace a practice that worked, ask what job
it was doing — the practice's stated purpose is often not the load-bearing one.**
The corollary bit here twice: the same finding also says a stated requirement
("nothing may foreclose a periodic forced review") can encode a misreading, and
inherit false authority from being written down early.

## Two mechanisms that conflict may be a pair, not a choice

`goal/todo.md` needs a soft cap (items past N are not in front of you) and needs
never to let an item on the list be forgotten. Those contradict.

The resolution was not to weaken either one. It was to notice that the daily
walk — introduced for an unrelated reason — is exactly what makes the cap safe,
because it guarantees the whole list is seen regardless of what the working view
shows. Two features that each looked optional turn out to be one mechanism with
two halves, and shipping either alone is worse than shipping neither.

**When two requirements conflict, check whether some third thing already in the
design reconciles them before trading one away.**

## Scope note: the graveyard problem is a separate project

`problem.md` names project neglect as the larger cost, and the TODO list has
been carrying that weight by association since Portal. They are distinct: the
graveyard is about *projects* dying, and no flat item list has addressed it in
three eras of evidence. Splitting them let the TODO design get sharp.

`[for: problem-clarification]` The graveyard problem — "projects die by decision,
not neglect; I always know which threads are alive" — is unstarted and wants its
own clarification. It descends from Portal's "projects as concepts" and from
era 1's third failure ("no way to represent a project with its own milestones,
so no way to see the list of projects or their status"). Expect the TODO design
to teach it something, and check era 1's failure 3 against it first.

**Evidence arrived 2026-09-10, and it names the hottest instance**
(`notes/04 events.md`). Managing multiple physical households produces era 1's
failure 3 exactly: routine maintenance that recurs, and *major projects with
their own milestones* — a garden, a floor — where "the collection of all related
items is itself an artifact I need to work on." It arrived inside the events
feature and is not the events feature. The same conflation cost the TODO design
once already, and splitting it is what let that design get sharp.

**And it adds something the record has never had: a second person.** The
household list is worked on *jointly with the user's wife*, and the era-3 events
spreadsheet turns out to have been co-owned with an exec assistant — *"a
communication channel with someone who helped me plan and manage things."* Two of
the hottest wants in this project are shared surfaces, against a constraint that
reads *"two devices, both trusted, single user. No multi-tenancy, no sharing
model."* **Settled by D70, and cheaply**: the need is two people in one room
reading one screen, not two people with accounts — a legibility requirement, not
an architecture. Same shape as D46, where moving a boundary out to a coarser
container deleted the propagation entirely.

**Two corrections to the item above, from working the household case through
(2026-09-10).** The household case turned out **not** to be the graveyard problem
at all — managing the projects is adequately served by docs and TODO items today,
and the gap was the *meta-problem* of regathering "not now" items, which is Q3a
and is answered by D71. So the graveyard problem is narrower than it looked and
still concerns solitary threads going quiet: the book, the research, the
standards push.

**And its deferral has just become legitimate, which it was not before.** By the
standing rule, deferring a *mechanism* is safe only when its data is already
being recorded — and nothing recorded what died, since an abandoned thread simply
stops appearing in day files. *"Not enough information yet"* was therefore a
permanent condition. **D71's graveyard docket is the instrument**, and the number
to watch when this clarification is finally run is the **resurrection rate**.
Expect to run it after living with dockets for a while, and check these against
it first: whether the problem is threads dying or simply too many being started
(the trap Q3 fell into once), and what the tools tried over the years actually
failed at.

## A gate that was never opened has not returned a negative

D4 held the TODO UX behind an evidence gate: run a plain checkbox file in v1, and
promote only against a recorded failure of it. Reasonable, and it quietly stopped
working — the stand-in was never really used, so no failure was ever recorded,
and the gate would have deferred the work forever while looking principled.

This is the instruments discipline (`notes.md`, six entries) applied to a
*process control* rather than to a measurement: **a negative result is only
evidence if the positive control fired.** An unexercised gate returns nothing,
not a "no", and the two are easy to confuse because they look identical from
outside — no evidence has arrived either way.

**When a gate has been closed for a while, check whether the thing behind it was
ever actually run.**

## Enumerate what the user does, not what the record contains

`file-documents.md` predicted four future kinds and got the first one it met
wrong. Todo was filed as record-shaped — "an edit is a field, and history is per
item" — which is exactly what you conclude from listing an item's attributes:
text, status, due date, tags, timestamps. Six fields, so: records.

Asking instead what anyone *does* with a task list gives three motions, none of
which asks about a single item's field history; they all ask what the **list**
looked like. So it is text, history is per day, and it inherits the whole
`SegmentedDocument` machinery rather than forking `Document`.

**A kind looks record-shaped when you enumerate the fields an item has, and
text-shaped when you ask what the user does with it.** Enumerating fields is the
easier exercise and the misleading one. The same test has not yet been applied to
calendar, which is still sitting in that row.

## An object's identity is taken while it is alive, not in its teardown

`registerDocumentIpc` closed a window's running searches on `closed`, and read
`created.webContents.id` *inside* that handler — where the WebContents is already
destroyed and the property access throws. The window that found it was the hidden
one **printing** makes, so the symptom was a PDF that came out perfectly and a
main process that fell over on the way back: m2's print scene simply stopped
reporting three lines from the end, with no error anywhere.

The rule is small and general. **A teardown handler may use only what was
captured before teardown began.** `const owner = created.webContents.id` at
creation time, then close against `owner`. This applies to every Electron object
with a destroyed state — WebContents, BrowserWindow, the view behind a handle —
and to anything else whose accessors throw after disposal.

**And the diagnostic lesson is worth as much as the fix**: three plausible
theories about the cause were all wrong, and the bug was found in four minutes by
`git stash`-ing the change and bisecting the diff by hand. When a suite that was
green goes red after a change, bisect the change. Do not reason about it.

## `npx tsc --noEmit -p .` does not typecheck this project

It silently skips the main process. The real check is **`npm run typecheck`**
(`tsc --build --force tsconfig.json`), which walks the project references — and
it found a bad import in `main/` the moment it was finally run, after two phases
of work had been "typechecking clean" against a command that was not looking.

**A verification command that cannot fail is not verifying.** Worth a suspicion
whenever a check has never once complained: try breaking something on purpose and
confirm it notices.

## A floating surface's ink comes from that surface, not from the page

Twice now. `.theme-panel` already carries the note — *"an input whose ground came
from the page put light text on cream"* — and the search panel repeated it in
three places at once: the lead took `--text`, the date pills took `.pill.label`'s
`--text`-derived ink, and the field took `--surface` for its ground. In every
built-in theme the page and the panel happen to be on the same side of light, so
all three looked fine; in a theme with a dark panel over a light page they were
dark on dark.

**The rule: a token pair must come from one surface.** If the background is
`--surface-panel` then the ink is `--panel-text` and a control's ground is
`--panel-field` — never a mixture, and never `--text` on a panel.

**And this is worth a check rather than a memory**, because reading it back is
cheap: `getComputedStyle` on the panel's own elements, asserting the ink equals
the panel token and *differs* from the page token. m4 does that now. A rule that
has been broken twice will be broken a third time.

**The second bug underneath it is worth its own line: a CSS block that was
rewritten in place left its predecessor further down the file**, and the stale
copy won on order alone. The symptom was a colour that ignored the rule the
visible source obeyed. When a style refuses to apply and the rule looks right,
grep for a second copy of the selector before doubting the cascade.

## A verify scene with no runner asserts nothing

The `docket` scene was written during MH1, printed twenty-odd `VERIFY` lines, and
was read by **no script**: there was no `mh1-acceptance.mjs` and no `mh1` in
`package.json`, so nothing in `test:full` ever looked at its output. The scene was
being *run* by hand and eyeballed, which is not the same as being checked, and it
would have gone on printing correct-looking lines about a broken app indefinitely.

This is the same family as `npx tsc --noEmit -p .` above — **a verification that
cannot fail is not verifying** — and it has now appeared as a missing flag and as
a missing consumer. The general form: *something produces evidence; establish that
something reads it and can say no.*

**The instrument found two of its own defects on first run**, both mine and both
in the measurement rather than the app: `rows` was sampled after the *first*
matter was added and then asserted as though it were the total, and the run-up
count used `.docket-runup-when`, which the still-open *add* row also carries (the
word *before* between its two fields). A selector that matches the thing under
test plus the form for making another one silently over-counts by exactly one.

## One throw in a verify scene silently drops every assertion after it

The docket scene called `window.tephra.doc.text()`, which does not exist on the
bridge. It threw, the scene's remaining half never ran, and the effect was not an
error but **twelve checks failing for absent evidence** — `offered=undefined`,
`field=undefined`, `appError=undefined`. The shape on the terminal looks exactly
like a broken feature, and the first instinct is to go and debug the feature.

**The tell is `appError: undefined` rather than a value.** That say is the last
line of every scene, so if it is missing the scene did not reach the end, and the
fault is in the scene rather than in the app. Read the failures top-down and find
the first one whose evidence is *missing* rather than *wrong*; everything below it
is noise. The three wrong theories that preceded the print-window fix were the
same mistake made without this rule.

## Shape is not validity, and the docket grammar got it wrong in every form

`parseWhen` validated dates with `/\d{4}-\d{2}-\d{2}/` and never called
`asDateKey`, so a matter could be scheduled for **the thirtieth of February** —
parsed, stored, displayed, and impossible. Every form had it: a day, both ends of
a range, both months of a season, and the new recurrence anchors. A backwards
range was accepted too.

**What makes this worth recording is that the sibling module got it right.**
`shared/query-text.ts` was careful about exactly this and reports a `Problem` for
an impossible date. The second grammar was written from the first one's *shape*
and inherited its regexes without its checking — which is the predictable failure
of copying a pattern rather than a principle.

**The rule: a regex that matches a date establishes that somebody typed something
date-shaped, and nothing else.** Anywhere a string becomes a `DateKey`, the
conversion is the validation, and the answer to a date nobody could have meant is
to say so rather than to file it.

## A reading form that cannot be typed back is a trap, not a convenience

Reported from use, one day after it was built: the docket row read **every 90
days** and the field it was read out of accepted only `every 90d`. The reading
form was added for legibility — the row was switching languages halfway across,
notation beside a run-up that said *2 weeks before* in words — and it made the
surface teach a notation the parser refused.

**A displayed value IS input.** People retype what they see and correct it in
place, so every form the app renders has to parse back to the value that produced
it. The fix was the parser's, not the renderer's: `UNIT` accepts `d` or `days`,
the count is optional because *every 1 week* is not English and so is never
written, and `parseOffset` takes `2 weeks before` because that is the whole
sentence the row just said.

**The property is testable and now is**: for every form, `parseWhen(readWhen(w))`
and `parseWhen(spellWhen(w))` both equal `w`. Two rendering functions exist on
purpose — one round-trips into the file, one is read aloud — and the loop has to
close through both.

## Content, not depth, told a section from a matter

Sections were added to the docket format a phase after matters were. The obvious
rule was heading depth: `##` a section, `###` a matter. It would have **silently
lost a house**: every docket written in MH1 has its matters at `##`, so a
depth-based reader would have seen a file full of empty sections and no matters
at all — no error, no missing file, just an empty screen where a docket was.

The rule that works is **content**: a heading with nothing under it is a section,
a heading with anything under it is a matter. It cannot fail that way, because
the writer always emits `when:` under a matter's heading. Depth is still written
correctly for new files, so the outline is true markdown — it is just not what
the reader trusts.

**The general form: when a format grows a new construct, the discriminator must
be something every file already written gets right.** Anything else is a
migration disguised as a parser change, and the loud failures are the lucky ones.

## Two acceptance suites at once share one `out/` and quietly ruin each other

Every `mN` script begins with `npm run build`, and the build writes to one
`out/`. Running two of them concurrently — two backgrounded shells, each with its
own `for` loop — has the second build rewriting the bundle the first one's
Electron process is loading. The failure is not a crash: the suite prints no
summary line at all, which read as *nothing to report* and passed a `grep -E
"passed, [0-9]+ failed"` filter by matching nothing.

**Acceptance suites are serial**, and there is nothing to parallelise anyway —
each one drives a real window. The same mechanism is the best available
explanation for the single unreproduced unit-test failure earlier in the same
session, which happened in the one run that shared the machine with a build.

**And the reporting lesson is the same one as the timed-out scene:** a filter
that only matches success cannot distinguish *passed* from *never finished*.
Assert on the presence of the summary, not on the absence of failures.

## An inference hardened into a rule, and it was the wrong rule

The docket surface carried this as a design constraint, in the file header and in
the stylesheet: **no hover-only controls, because two people cannot both point at
the same row.** Nothing in `goal/horizon.md` or D70 says that. It was inferred
here from H3's legibility requirement, written down in the imperative, and then
cited in three places as though it had been decided.

Corrected from use in one sentence: *hover-only controls are fine, I'm not sure
where that rule came from. Those don't prevent two people from sitting next to
each other and working together.*

**What H3 actually demands is that the surface be legible and its gestures
findable** — and the inferred rule had crowded out the real one. In the same
message: *I'm not sure how to move things into and out of sections.* The move
control was there, and it was the quietest mark in the row — 11.5px, muted ink, a
hairline border. The constraint being enforced was invented; the requirement being
missed was real.

**The tell to look for: a comment that states a rule in the imperative and cites
a requirement number that does not contain it.** When a constraint is written
here rather than in the requirements, say that it was inferred, so that whoever
reads it next knows it can be argued with.

## A glyph is a font dependency, and grips are worth drawing

The drag handle was `⠿` (braille pattern dots-123456), which is the conventional
grip character. The UI font substituted something that rendered as **two dots** —
not six — which reads as punctuation rather than as *pick this up*. The
acceptance check passed the whole time, because it asked whether the element was
present and visible, and it was.

**Drawn instead**: six dots from a repeating radial-gradient, which depends on no
font and lands on the pixel grid at any size. And the check now asks for a box
with real dimensions and a background image, rather than for a character — a
glyph assertion cannot tell a grip from a colon.

**Screenshots caught this too**, as they have caught every visual defect in this
project. The count of things found by looking that were not found by testing is
now high enough that *look at it* belongs in the definition of done.

## A synthetic `dragstart` proves the handlers and not the gesture

The drag handles shipped with eight passing acceptance checks and did not work.
Reported from use in one sentence: *I can see the grab handles and the cursor
changes over them, but when I try to grab them, nothing happens.*

**The grip was a `<button draggable>`.** A form control is not a drag source in
this engine — `mousedown` on a button is an activation gesture, so the browser
never begins a drag, `dragstart` never fires, and there is no error anywhere.
Everything downstream of `dragstart` was correct, which is why every check
passed: the scene *dispatched* `dragstart` by hand. **Dispatching an event skips
the only question that was open** — whether the engine would ever raise it.

**The first fix did not work either.** A `<span role="button" tabIndex={0}
draggable>` with `-webkit-user-drag: element` still did not lift, and the check
written for it — *is this a drag source?* — passed. Two rounds of guessing at
engine rules I could not observe from here, each validated by a check that could
not fail.

**The gesture is pointer events now, and that is the lesson.**
`pointerdown` / `pointermove` / `pointerup`, with the drop resolved by
`document.elementFromPoint` against `data-` attributes on the rows. Nothing in
the engine gets to decide whether an element is liftable; the events a test
dispatches are the events a hand produces, so the check is the gesture rather
than a proxy for it; and the feedback is ours to draw, which mattered because
*nothing is lifted* was the other half of the report.

**The general rule: when a test has to synthesise the event under test, it has
stopped testing the thing and started testing what happens afterwards.** The
honest response is not a cleverer proxy — I tried two and both passed on a broken
feature — it is to choose a mechanism whose entry point a test can actually
produce. Also worth remembering that `cursor: grab` is pure decoration: it says a
thing looks draggable, never that it is.

## Nothing that appears because a drag started may occupy space

With the gesture finally working, drops still landed in the wrong place. The
cause: a *drop here* strip rendered only while dragging, at the top of the list.
It appeared on `pointerdown`, pushed every row down by its own height, and so the
row you aimed at was no longer under the cursor when you let go. In the scene the
aim was (337, 213) and the row had moved to 280.

**It is one bug with two faces.** As a defect: content moving under the pointer at
the exact moment the pointer starts mattering. As a test blind spot: the scene
measured the target *before* pressing, which is the one ordering that cannot see
it. Aim after the gesture begins, always — it costs a callback and it is the only
order that reflects what a hand does.

The fix was to stop conjuring the target: the undivided run is now **labelled
whenever the docket is divided**, so the place to drag something back to is
always there, in the layout, before anybody touches anything.

## Two edits computed from offsets, and the gap was adjacency

The move verb deleted a block and inserted it at the destination in one
`replace()` — two edits — and when the destination coincided with the block's own
boundary they overlapped: *edit at 313 overlaps one ending at 416*, on the first
drag anybody ever did. Sixteen integration tests covered moves and every one
passed, because they all moved a block **past** something. Adjacency — dropping
onto the row immediately above or below — is where the boundaries coincide, and
nothing tested it.

**Rewritten as an order rather than as arithmetic.** The verb now rebuilds the
block sequence: every block that is not moving goes back by its original bytes
(which is what keeps the byte-identical property), the one that moves is
re-serialised, and the result is one edit. There is no interval to get wrong.

Getting it wrong once more on the way — a downward nudge that moved two places,
because the neighbour index was already one past the subject — is why the tests
for this are now **exhaustive over every position and direction**. At three
matters that is fifteen cases and they run in milliseconds; the failure mode was
arithmetic, and arithmetic at this size is worth brute-forcing rather than
reasoning about.


## A scene that finds its controls by label breaks when a label changes

The step rename (*run-up* → *step*, D76) silently disabled a whole section of the
`docket` scene: it opened the add-a-step row by finding the button whose text was
`'run-up'`, and no such button existed any more. The scene did not error. It
carried on, added nothing, and reported the *feature* as broken — a missing step
in the file — when what was broken was the test.

**Text is the most fragile selector available**, and it is the one a scene reaches
for because it is how a person finds the control. The tension is real: a scene
that clicks `.docket-quiet:nth-child(4)` tests nothing anybody can recognise, and
one that clicks *the button that says step* tests exactly the right thing until
the word changes.

**What makes it survivable is the failure being loud in the right place.** The
file check is what caught it — *the step on disk* found nothing — and the useful
habit is the one already recorded for the timed-out scene: read failures
top-down, and when the evidence is *missing* rather than *wrong*, suspect the
scene before the app. A rename is exactly the change that produces missing
evidence everywhere at once.

## A guard that returns silently is indistinguishable from a broken key

Reported from use, four notes at once about one small row, and the sharpest was:
*a carriage return in the task doesn't do an "add."* It did. What it did was hit
this:

```ts
if (offset.trim() === '' || text.trim() === '') return
```

The *when* field was empty, so Enter was swallowed and nothing happened and
nothing was said. From the outside that is a dead key, and no amount of looking
at the Enter handler would have found it, because the Enter handler was correct.

**Two separate faults, and the guard hid the more interesting one.** A blank
schedule should never have been refused at all — `T+0` is the commonest step on
a docket, the first thing to do when work starts, so blank is the *default* and
not a missing field. The guard turned a design gap into a phantom input bug.

**The rule: a control that declines to act must say why.** Either default the
missing thing, or refuse out loud. `return` with nothing said is the worst of
the three, and it is the one that looks like the framework's fault rather than
ours. Worth remembering that the distinction to preserve is *saying nothing* —
a choice, so default it — against *saying something unreadable* — a mistake, so
report it.

**And two controls appeared where one was needed.** The row stayed open after an
add so a second step cost no gesture, which left *add* and *done* side by side —
and *done* read as *cancel*, because a row still sitting there after an add makes
the closing button look like the undo.

**The first fix was to close on add, and it was the wrong half to change.**
Staying open is the right behaviour: work comes in sequences — find a shop, then
have the car fixed, then claim it back — and closing made the whole gesture cost
one row per step. What was actually broken was the *label*. `done` beside `add`
names no difference; `cancel` does, and Escape means it too.

**The lesson is about which of two things to move.** Two controls that need
telling apart can be fixed by removing one or by naming them properly, and the
first is tempting because it is less work. Here it cost a useful behaviour and
had to be put back a few rounds later — on the report *adding a step should
immediately open up a new step to add*, which is the behaviour that had just
been deleted.

## A surface that fires and forgets loses whatever was typed

*"If I hit return on this thing that has a bad when clause, it just seems to drop
the item."* It did. The add row called the verb and closed in the same breath:

```ts
onCommit(offset, text)
onDone()          // ← unconditional
```

The verb is async. It rejected — *then* is not a schedule — the error landed in
the banner at the top of the surface, and the row with the words in it was
already gone. **The complaint said the item was dropped, and from where the
person was sitting that is exactly what happened.**

**The fix is that an action reports whether it worked**, and the caller keeps the
words on screen if it did not. Every verb in this surface goes through one
helper, so it was one signature: `Promise<unknown>` became `Promise<boolean>`,
and three callers learned to wait. It is the same shape of bug as the silent
guard above — a control acting as though it had succeeded — and worth stating as
one rule: **optimistic UI is only honest when there is an undo, and there is no
undo for text you never got to keep.**

## A label is not editable, and identity is what makes that expensive

Alongside the above: *"why can't I click on 'Find electricion' and correct its
spelling?"* Because a step's text was rendered as a `<span>`, and the only repair
was to drop the step and retype it.

**Which is not the same act.** A step's id is what its dependents point at and
its completion stamp is what they read, so a drop-and-retype orphans whatever
was waiting on it and forgets that it had been done. The matter's own name and
date had been click-to-edit since MH1 for exactly this reason; the steps were
built later and the pattern was not carried down.

**The rule: anything with an identity needs an edit, not a replace** — and the
tell for where that is missing is a `<span>` holding text a person authored. The
same sweep found the step's schedule, also a span, also only replaceable.

## A reference nobody can type is not a reference

Steps gained ids so that one could depend on another (D76), and the id is right:
eight random characters, stable against a step being inserted above it. What was
wrong is that it was **the only way to point at a step**, and it is unwritable —
nobody types `okc8kiff`, and the surface never showed it.

So two references arrived from use, in two messages:

- **`then`** — *after whatever is above this in the list*. The word people use
  when typing a chain top to bottom.
- **`after 1`** — an index. Which came with its own observation: *saying "after
  1" is weird because the number 1 isn't shown in the UX anywhere.* It wasn't.
  The number is the handle, so the number has to be on the screen.

**And `after 1` was already parsing.** The reference pattern was `[0-9a-z]+`, so
a digit matched, and the step was stored pointing at `"1"` — a name for nothing.
It would never have come due, and nothing would have said why. **A grammar that
accepts a reference must resolve it**, against the real list, at the moment it is
written; anything else stores a pointer whose target was never checked.

**Both normalise on the way in, which is what keeps the file honest.** `then` and
`after 1` exist only in the field; the block always holds an id. So the two
questions stay separate — *what can a person type*, and *what does the file
mean* — and the second one has one answer.

**The shape to remember: a synonym is resolved where the context lives.** `then`
needs to know what is above it and `after 1` needs the list, so neither can be
settled by the parser alone — it is handed the answer rather than the question,
and a file being read back supplies no context at all, which is exactly why a
step block can still be parsed on its own.

## A count is not a door

The control that adds a step to a matter was labelled with the number of steps:
`step` when there were none, `1 step`, `2 steps`. Reported from use: *it's very
unclear that clicking on "1 step" will add a step.* Which is right — a count is
information, and the only thing a number invites is reading.

**Worse, the information was already on the screen.** A matter's steps are always
listed directly beneath that control, so the number said nothing the reader could
not see, and it cost the one door into the step list its legibility. `+ step`
now, matching the two things beside it that are also doors: *+ Add a matter* and
*+ Add to …*.

**The tell: a control whose label is a fact about the thing rather than a verb
about the act.** The others in that row survive the test because they read as
verbs or as questions — *tag*, *who*, *note* — and the count was the only one
pretending to be a status line.

**This was also the third scene breakage from finding controls by their text**,
so the selector now matches `'+ step'` exactly rather than *contains step*. Exact
is the better trade here: it breaks loudly on a rename instead of quietly
matching some other control that happens to contain the word.

## `undefined !== null` is true, and a native setter says nothing useful about it

The acceptance scene died with `Illegal invocation` and no indication of where.
The cause, three guards of this shape:

```ts
const row = rowOf('air filters')?.querySelector('.docket-where') as HTMLSelectElement | null
if (row !== null) { setter.call(row, 'Periodic maintenance') }
```

`rowOf` returns `undefined` when it finds nothing, `?.` propagates that, and the
cast said `| null` — so the guard passed a missing element straight into a native
`value` setter, which threw a message about receivers rather than about rows.

**Two faults, and the dull one is the dangerous one.** The interesting fault was
upstream: a matter was never created, because the scene typed a date into a field
that shape of matter does not have. The dull one is that the guard turned *there
is no such row* into *illegal invocation*, which sounds like a DOM problem and
sent the search to entirely the wrong place.

**The rule: a cast is not a check.** `as T | null` does not make `undefined`
impossible, it only stops the compiler mentioning it — and a lookup chain with
`?.` in it produces `undefined`, never `null`. Guard with `== null` when both are
possible, and be suspicious of any `!== null` sitting downstream of an optional
chain.

**And the guard that caught this was the one added two days ago** — *a scene that
did not finish is not a scene that passed*. It reported honestly and said nothing
about why, so it now prints the window's own output when there is no `appError`
line. The first run with that in place showed `VERIFY ERROR: "Illegal
invocation"` on the line after the last good one, which was the whole
investigation.

## One class, one thing — or every query for it becomes ambiguous

`.docket-where` was the move-to menu. Then a step's kind needed a `select` and it
got the same class, and so did the shape picker on *Add a matter* — three
different controls answering to one name, because they looked alike. Nothing
broke until the move-to menu was removed and a check asked *is it gone?* by
querying `.docket-where` inside a row: the answer was no, because the add-step
row happened to be open and its kind picker matched.

**Styling is not identity.** The reason they shared a class was that they should
look the same, and that is a job for a shared class *alongside* a name — not
instead of one. Each has its own now: `.docket-where` is gone with the control
it named, `.docket-step-kind` and `.docket-shape` say what they are.

**The tell is a selector that reads as a question about appearance** — *the
small bordered select* — rather than about the thing. Every scene in this
project addresses the UI by class, so a class is an interface, and reusing one is
an overload nobody declared.

## An affordance that appears only once the thing it sets already exists

Three times in one surface, each time reported as a missing feature and each
time a visibility condition written from the state where the feature is already
in use:

- **A step's kind.** Nothing set it, so every step was authored as a task and
  the kind that made a matter recur had no door at all. *How do I create an
  interval-scheduled task right now?*
- **A matter's interval.** The control rendered only when
  `matter.when.every !== null`, so a matter made as *something to get done*
  could never become one that recurs.
- **Which step advances the clock.** The radios rendered only when
  `after !== null`, so *on the calendar* sat there as the single option in a
  group of one — the choice could not be made until something had made it.

**The shape of the mistake is the same each time**: the condition is written
while looking at a thing that already has the value, so it reads as *show this
where it is relevant* and means *show this where it is already decided*.

**The check: for every control that SETS a value, ask what the surface looks
like when that value is absent** — which is the state somebody is in precisely
when they want the control. A field that shows the current value is a display;
a field that only shows when there *is* a current value is a display pretending
to be a control. Where absence is a real state — *once*, *no date yet*, *on the
calendar* — say it in words and keep the control.

## Rewriting a region of CSS takes the rules you forgot were in it

A ground-up restyle of the docket replaced two regions of the stylesheet
wholesale. Both replacements were written by naming the rules they were meant to
contain — and each region also held rules that had arrived later, for controls
added in between. Four went silently: `.docket-step-clock`, `.docket-step-kind`,
`.docket-mode`, `.docket-start`.

**One was caught by eye and three were not**, which is the interesting part. An
unstyled label is obviously broken — black, 16px, wrong font. An unstyled
`<select>` or `<button>` looks *plausible*: the browser's defaults are a
perfectly reasonable-looking control, just not this one. So the failure is
visible exactly where the element has no default appearance of its own, and
invisible everywhere else.

**The check is cheap and general**: nothing in this surface uses 16px, so for
every class the surface styles, assert its computed `font-size` is not the
browser's. A missing rule shows up as the default and the default is the tell.

**Second time this shape has appeared.** The other was a CSS block rewritten in
place whose predecessor survived further down the file and won on source order —
also invisible, also about a stylesheet edit that looked complete because the
part being *looked at* was correct. A stylesheet has no compiler; the only thing
that fails loudly is a rule that changes something you happen to be watching.

## 51. Idempotence has to hold *concurrently*, not just repeatedly

MH3a's generation pass was idempotent in the sense everybody means by it: run it
again and it makes nothing. MH3b's tests ran it under a frozen clock, and it
generated every task twice.

**The day-boundary pass was fired unawaited.** `void this.reconcile()` alongside
the announcement, so the boundary would not be taken down by a background
failure — reasonable, and it meant that crossing a day started a pass that then
overlapped whatever the test (or a person) triggered next. Both passes read *this
step has made nothing* before either one wrote, and both acted on it.

**The word had been doing less work than it looked like it was doing.** Provenance
on the step makes the operation idempotent *in sequence*: the second run sees what
the first recorded. It says nothing about two runs in flight at once, because the
read and the write are not one act. Every reconciler is a read-modify-write, and
a read-modify-write is only atomic if something makes it so.

**Which is not a niche condition.** Reconcilers get called from everywhere on
purpose — that is their appeal, since a caller does not need to know what derives
from what. So being called from two places at once is the *expected* case, not the
exotic one, and the property has to be stated as *running it more cannot do more*
rather than *running it twice makes nothing*.

Queueing the passes fixed it in three lines. Finding it took a frozen clock: at
wall-clock speed the boundary pass and the explicit one do not overlap often
enough to notice, which is the other half of the lesson — the bug was always
there, and the test that moved the clock is what made a rare interleaving into
every run.

**The same run turned up its sibling.** Completion stamps came from
`nowSeconds()` while the day came from the service's clock (D62) — invisible in
production except in the minutes either side of midnight, and immediately fatal
under a clock the test had frozen. Both bugs were *one clock too many*, and both
were found by the same act: making time a thing the test controls rather than a
thing it waits for.

## 52. The first cut inverted the abstraction, and it typechecked

The horizon's query was written inside the docket module: `horizonOf(matter, …)`
beside `dueOn`, returning a `HorizonStep` whose `kind` was the docket's `StepKind`
plus a fourth member. It compiled, the twelve integration tests passed, and it
was wrong in a way none of that could see.

**The horizon is a logical object that several things implement.** Written the
other way round, the docket owns it: the second source (dated tasks) is a special
case grafted on, and the third (H7's ICS feed) is a rewrite rather than an
addition. Nothing is *incorrect* — every row it produced was right — but every
later source has to be shaped like a docket to get in.

**The tell was in the type.** `StepKind | 'due'` is a vocabulary bolted onto one
implementation's, and a union written that way is almost always a sign that the
thing doing the uniting has no name yet. Once the horizon declared its own three
kinds, the docket's job shrank to the only part no other source could supply —
turning steps and instances into dates — and the module stopped importing
anything docket-shaped.

**It was caught by being told, not by a test**, and probably could not have been
caught by one: the failure is about what the *next* source will cost, and no
assertion available today can observe a cost that has not been paid yet. What is
available is the shape of the names, which was saying it plainly the whole time.

**The same session shipped the inverse mistake and caught it in a comment.** The
compact strip gave docket rows an accent tell, under a comment arguing they are
the same kind of thing as a dated task. Writing the justification down was what
exposed it — the sentence and the code contradicted each other in adjacent lines.
Prose next to a decision is not documentation of the decision; it is a place the
decision can be checked.

## 53. Four surfaces, four hand-built copies of the same sentence

The horizon shipped rows reading `Review Steve's [bio draft](https://docs.google
.com/document/d/1t8me…/edit) #career`, a URL sprawling across three lines of a
surface meant to be glanced at. Reported from use, within minutes.

**The fix was one line; the finding was that four callers had built it
separately.** The rail beside the task list did `flattenLinks(prose(item))`. The
row menu's label did `flattenLinks(prose(item))`. The horizon's task rows did
`withoutDue(item.text)` — written an hour earlier, in this same session, to fix
the *due marker* half of exactly this bug, and stopping there because the due
marker was the half then on screen. The horizon's docket rows did nothing at all.

**`plain.ts` had already described the ladder and stopped one rung short.** Its
comment says plainly that markers come off, that tags and dates stay because a
person typed them, and that a caller which cannot draw links composes
`flattenLinks` — *"and the two compose in that order"*. What it does not say is
that there is a third rung: a surface which has already put the date in its own
column and has no room for a chip wants those off too. Every such surface then
discovered the rung privately, and each stopped wherever its own screen looked
right.

**The rung belongs with the grammar, not with the ladder.** It has to cut tags
and due dates by the item's own `tagSpans` and `dueSpan` rather than by
re-matching, or it is a second opinion about where a tag ends — so `shortLine`
lives in `kinds/todo.ts` and `plain.ts` points at it. A caller holding only a
string is asking a different question and composes the two rungs it does have.

**The generalisable shape: a partially-documented ladder is worse than an
undocumented one.** Three rungs existed; two were written down. The missing one
was reinvented every time, and because it was reinvented from whatever was on
screen, each copy was subtly different — which is why the due marker got fixed
and the URL did not.

