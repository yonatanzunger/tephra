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

## Three items raised at M1, and why they are not independent

From `notes/02 next steps.md`: a comment extension to markdown, an
import-and-annotate flow, and the inadequacy of purging. They read as three
parallel design conversations and are not — **the third is upstream of the other
two, in one specific place.**

Q12 floats "does some content need never to enter the history at all?" If the
answer is yes, the corpus acquires a **class** distinction, and both of the other
two items must be able to carry it: the comment format has to say what class a
comment is, and the import path has to say what class an imported document is.
Adding a class to a format later is a backfill problem, and `scope.md`'s own rule
forbids it.

**But only that one sub-question is upstream.** The rest of Q12 — remote choice,
encryption, self-hosting — is v2a and can take its own cycle without blocking M2.
Resist the pull to serialise the whole thing. `[for: failure-analysis]`

**The second coupling runs the other way, and raises the stakes rather than
constraining the design.** Import-and-annotate is a machine for producing the
most sensitive content the notebook will hold: unguarded first reactions to
politically charged documents, timestamped, in a history that cannot forget. The
flow is worth building; it should be scoped knowing that is what it makes.

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
