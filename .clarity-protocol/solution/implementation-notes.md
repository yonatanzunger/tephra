# Implementation notes

Everything captured so far that is a *build-time* obligation rather than a design rationale. Organised by when you will need it, not by where it came from.

**Every entry states the failure it prevents.** A rule without a reason gets removed as an oddity by whoever reads the code next, and that person is you in eight months.

---

## 1. Invariants that fail silently

These are the ones where the code keeps running and something is quietly wrong. Highest priority.

**Watch directories, never file descriptors.** An fd-based watcher dies *without erroring* when a file is atomically replaced by `rename(2)` — which is how our own writes work. The editor and the disk then drift apart with nothing reported.

**A stale position must throw, never resolve approximately.** T1's likeliest mechanism is an operation computed against text that has since moved: a queued tag, a branch, a print. Rejecting stale `SessionGeneration`s converts the whole class into a visible error.

**Never rewrite a file you failed to parse.** Malformed YAML means "treat frontmatter as absent" *and* "do not touch this file." Overwriting what you could not read is how hand-edited content disappears.

**Rewrites splice into the original bytes; they never serialise from a parsed model.** Model-serialisation silently reformats — YAML key order, list markers, wrapping — and turns every save into a diff against itself. This breaks round-trip discipline from day one and is invisible until the first sync conflict.

**Parse markdown, never regex.** This is a physics notebook: it will contain fenced code, and code *about* Tephra will contain Tephra markers. A fence-aware scan costs almost nothing; a regex scan is wrong in a way that surfaces once, badly. **This applies to v1's scan-based search and enumeration too**, not just the parser.

**Preserve unknown frontmatter keys verbatim.** A future version's key, or a human's, must survive a round trip.

**`onChanged` must not fire on the window that originated the change.** The editor has already applied it locally; re-applying is exactly how text gets duplicated.

**`StoragePosition` must never appear in a signature Z can reach.** It is used heavily inside Document and nowhere else.

**Adjacent same-segment spans must coalesce.** A within-day split otherwise becomes visible above the API, which is the one thing D8 and D19 exist to prevent.

**Quiesce before any external mutation of the tree:** flush, release, mutate, reload. Skipping the flush silently clobbers unsaved edits.

---

## 2. The editing surface

All of this is measured, from Spike 01.

**Block widgets cannot come from a view plugin** — CodeMirror refuses outright. Inline widgets (equations mid-line, thumbnails) rebuild per viewport in a `ViewPlugin`; block widgets (tables, display equations, figures) live in a whole-document `StateField`. A state field cannot see the viewport, so it must map its ranges through each change and rescan only the block the edit touched — **never rescan the document per keystroke.** Measured: 2 ms initial scan, 0.2 ms incremental.

**Rendered constructs must unrender under the cursor.** `@replit/codemirror-vim` does its own offset arithmetic and never consults `atomicRanges`, so nothing can tell it a widget is one unit. Left rendered, six `l` presses leave the cursor frozen while vim walks the hidden source underneath. Unrendering makes every vim operation correct because vim is then operating on the text it thinks it is.

**Block widgets must also unrender from a *neighbouring* line.** Replacing whole lines removes them from the visual layout, so `j`/`k` skip them entirely — and unreachable means uneditable.

**Inline widgets atomic, block widgets not.** Marking blocks atomic makes the problem worse and buys nothing.

**Disable the editor's own history.** Undo is document-scoped (D23) and lives on Document; two histories over one text will diverge.

**Model construction is separate from view construction.** A widget that opens its file during view construction re-reads constantly and loses edit state on reparenting — R1.2 failing at the framework level rather than in application logic.

---

## 3. Storage, files and history

**Every write tier needs a quiescence trigger *and* a maximum interval.** WAL batched ~50 ms; file write on ~1 s quiescence **or every 5 s**; commit on ~5 min quiescence **or every 30 min, or session end**. Quiescence alone fails under exactly the condition this notebook exists for — an hour of continuous writing never reaches quiescence, so nothing is ever written.

**Commits never block typing.** Main process, asynchronous, off the critical path.

**`.gitignore` contains `.tephra/`.**

**Never call whole-tree `status` on the hot path.** We always know which files changed — the editor knows what it wrote, the watcher reports external edits. A full scan happens once, at startup after the app was closed.

**A restore truncates the undo stack.** So does a divergence resolution. Mapping an undo through either is not well-defined, and a wrong answer is silent corruption.

**Remote changes map through the undo stack without entering it.** They are your own edits from another device, not a stranger's.

**The `lock` file is not optional.** Two Tephra processes over one directory fight over the WAL and the fold; the failure mode is corruption, not an error.

**`attachments.manifest` distinguishes evicted from deleted.** Both look identical on disk — a missing file — and that is the replica/cache confusion D5 exists to prevent, reappearing one level down.

**Anchor resolution never caches a file path.** Branching moves anchors between files; a cached path rots silently.

**`branch()` is one operation, ordered create → update references → delete from source.** Never expose the steps. The ordering is the only safety mechanism available without a cross-object transaction, and its worst case is duplicated content (visible, fixable) rather than dangling references.

---

## 4. Process boundaries and the shell

**The app serves itself from a custom scheme** — not `file://`, not a localhost server. Electron needs `registerSchemesAsPrivileged({ secure: true })` **before app startup**. A localhost server inside a desktop app is reachable by any other process on the machine, and this corpus holds other people's information (T8).

**The print document needs an explicit `<base href>`**, or every relative image silently 404s — printing renders through a temp file.

**Printing renders the range to HTML in the web layer**; the shell contributes only the panel. Both shells produced identical PDFs from the same ~90 lines of shared JavaScript.

**The WAL crosses to the main process.** The live buffer is in the renderer, and the renderer is the component most likely to die — durability that stays in the renderer is not durability.

---

## 5. Things that will otherwise never be tested

Each of these is a path that fires rarely enough to rot, or a failure that cannot be observed by using the app normally.

- **The day-file split.** At 1 MB and ~100 KB a day this fires roughly never. **A path that fires once every few years is broken when it fires.** Force it with a synthetic oversized day.
- **Vim over every widget type:** motion across, `dd` on a line containing one, visual selection spanning one, undo restoring byte-for-byte. Spike 01's 28-assertion suite is the model.
- **Crash recovery.** Kill the renderer mid-typing; verify the WAL replays and nothing is lost.
- **Hand-edit arriving while the buffer is dirty** — the divergence path, which is rare by design (D12) and therefore untested by use.
- **Atomic-rename watcher survival.** Replace a file by rename and confirm the watcher still fires.
- **Unbalanced markers.** A `tag-start` with no end runs to the end of its segment and is *reported*; verify both halves.
- **Filename/frontmatter date mismatch** — frontmatter wins, repair offered.

---

## 5a. Watch in use — correct so far, but the failure would be quiet

Both of these are implemented and tested; they are here because the tests
encode *a* reading of the right answer, and only real writing will say whether
it was the right one.

- **Offsets near a segment boundary.** A buffer position on a day boundary is
  both the end of one day and the start of the next. It resolves to the LATER
  day, because a day body ends with a newline and that offset therefore renders
  at the first column of the next day — text typed there must land in the file
  the reader can see it under. The end of the window still belongs to the last
  segment, which is what makes appending work. Watch for text arriving in the
  wrong day around midnight, and for cursor jumps when a window is extended.

- **Tags and code spans interacting.** Marker scanning is fence-aware: markers
  inside fenced blocks, indented blocks and inline code spans are text, not
  markup. The uncomfortable case is a tag that *opens* outside a fence and would
  close inside one — the close is invisible, so the tag runs to the end of its
  segment and is reported unterminated. That is the specified degradation, but
  it will look like a bug the first time it happens while writing about Tephra
  in Tephra.

## 6. Claims not yet verified

Separated deliberately from everything above, which is measured or reasoned. **Do not build on these without checking.**

- **`clipboard.readBuffer('public.png')` may avoid Electron's `nativeImage` re-encode.** If it works, byte-preserving paste is a few lines rather than a native path. Also unverified: whether re-encoding strips the ICC profile, which would make "the pixels survive" slightly too strong.
- **`isomorphic-git`'s current maintenance status and API completeness.** The structural analysis in `git-library.md` is durable; library health is not something to take on my word.
- **That the repository is readable by standard git tooling.** This is the *decisive* acceptance test for any git implementation — the entire reason for choosing git (D32) is that the exit extends to the history.
- **Binary growth in git history** over twenty years of pasted images. Probably fine at this scale; worth measuring rather than assuming.
- **Window extent as a working number.** Spike A bounds the *window*, not the file; the extent that feels right in use is unmeasured.

## Themes in practice (D41)

Four named parameter sets ship as built-ins — Aldine, Sage, Night, Broad — and
are **seeded into `config/themes/` on first launch, never overwritten**. A file
that exists is left exactly as it is, even when it differs from the built-in of
the same name; someone who edits `aldine.json` and finds it silently restored
next launch learns not to trust the directory again.

**The name comes from the filename, not from inside the file.** Otherwise a copy
made for experimenting silently shadows the theme it was copied from.

**Parsing is lenient per field, not per file.** A theme is hand-editable (R26),
so the interesting cases are all the ways a person gets one wrong. One bad
number falls back to the default for *that field* and keeps the rest — losing an
evening's work to a fat-fingered digit would be a poor trade for strictness.
Numbers are also clamped: `size: 0` renders nothing at all, including the
controls that would let you fix it, which is an unrecoverable state reachable by
one typo.

**Six authored colours, eight derived tokens.** A theme names paper, ink, head,
faint, rule and accent; the ground and muted fills are mixed from them. Asking
for twelve values that have to agree is how a palette drifts out of tune, and
mixing *paper toward ink* means the derivation follows the theme rather than
assuming paper is light — Night gets a lighter rail beside dark paper, not the
reverse.

**The app renders the draft, not the saved file.** Moving a slider changes what
you are reading immediately; saving is separate and explicit. Apply-on-save
would turn choosing a measure into a guessing game, and the whole reason these
are parameters is that the four arrangements could only be judged by looking at
them.

**The panel states the consequence of the measure.** It is not only taste: the
measure decides how much width is left, and therefore whether the capture stream
lands on empty paper or covers the margin where commentary lives (D42, R27). The
panel says which, live, so the trade is visible while it is being made.

**The default is Aldine at 54ch.** It was chosen for a reason that can be
checked rather than argued: on a 1512px laptop it leaves the overlay landing on
slack, covering nothing. The previous default — 74ch, inherited from Spike A
when the text was centred and there was no gutter — made the stream cover 155px
of margin, and a unit test now fails if the default drifts back above 58ch.

## Per-script sizing (D41)

Hebrew reads uncomfortably small beside Latin at the same nominal size: almost
every letter sits at x-height, so the eye gets no size cue, and several differ
only in fine detail — ב from כ, ד from ר, ה from ח — so the reader needs more
actual pixels to tell them apart.

Done with a runtime `@font-face` carrying `unicode-range` and `size-adjust`, so
it needs **no markup and no language detection**: the browser applies it per
character and everything outside the range falls through untouched.

**The family name folds in the parameters** — `Tephra Hebrew 130 Times-New-Roman`
— and that is not cosmetic. A `@font-face` rule is cached by family name, so
rewriting the rule for the same name with a different `size-adjust` does not
re-resolve; the old metrics stay and the slider appears dead. Distinct settings
must be distinct families.

**The trap, learned in the proof sheet and worth repeating:** naming a face for
a range REPLACES the natural fallback for it. The first version listed
`Arial Hebrew` first and silently swapped a serif for a sans — the size was
right and the page looked worse. Whatever is named must be chosen for how it
looks beside the Latin face, not for having the script's name in its own.

**Measured, not assumed.** At 100% versus 130%, over the same string: Hebrew
137px → 175px, Latin 140px → 140px. The Hebrew ratio is 1.278 rather than 1.300
because the two `U+0020` spaces are outside the range and do not scale — 127px
of glyphs × 1.3 = 165, plus 10px of unscaled spaces = 175, exactly. **Latin at
1.000 is the assertion that matters**: it proves the rule is confined to the
range rather than applying to the page.

Face and scale are theme parameters with live controls and a Hebrew sample set
in the body face, so the slider is judged against the type it affects rather
than against the panel's UI font.

## The falsification review

Four M0 assumptions, checked against the code rather than against the comments.
Two held, two did not.

### Undo could change a file with nothing on screen — FIXED

`App.tsx` claimed that when undo lands outside the loaded region "the Pane is
told to go there". **Nothing did.** Measured: type a marker into today, navigate
to a day that does not contain it, undo — the buffer did not change, the
location did not change, and **the marker was gone from the file on disk.**

The danger is not the keystroke, it is the second one. Press undo, see nothing,
and the natural response is to press it again, silently unwinding more work in a
file you are not looking at.

Fixed by inspecting the change undo returns and navigating to its segment when
the current window does not cover it. `toBuffer` already returns null for a
segment outside the window, so the containment test needed no new API. Verified
through the real menu path, which is the only path a person has — calling
`doc.undo()` directly would have bypassed the code under test.

### The boundary-crossing edit split — HELD, and now proved

`#toDocumentEdits` carries the comment "a single deletion sweeping across
midnight is two edits, one per file, and getting that wrong writes half of it to
the wrong day." The suite tested a handful of hand-chosen ranges.

It now tests a **property over every range in a three-day window**: after any
edit, the window's text must equal applying that edit to the text before it.
That is ~1 080 cases including both day boundaries and every zero-length
position. **All pass**, plus four named cases that check which *file* each half
landed in, not merely what the buffer says. The sweep costs about 9 seconds and
is worth it: this is the function whose failure mode is silent misfiling.

### A branch that could not fix what it detected — FIXED

`DocumentWindow.documentChanged` had:

```
if (edits.length === 0 && before === this.#text) return
for (const handler of this.#changeHandlers) handler(edits, change.origin)
```

When the window's text changed but no edit could be expressed in its
coordinates, it called the handlers with an **empty** list — and the renderer
skips empty lists. The editor's buffer would have stayed at the old text while
`RemoteWindow`'s copy moved to the new one, and the next keystroke would have
been computed against a buffer nobody else believed in, surfacing as a
`DesyncError` several steps from its cause. It now resets: expensive, rare, and
correct.

### Echo suppression — HELD

`#originating` is set across `replace` in a `try/finally`, and every path that
reaches it — edit, undo, redo, extend — is serialised by `DocumentService`, so
the flag cannot be cleared by one call while another is still relying on it. The
renderer's half is symmetric: transactions carrying the `fromDocument` effect
are not sent back. Reviewed, found sound, no change.

### `viewportChanged` — SOUND, and untested by construction

The arithmetic is right and `extendWhenWithin` exists (the first hypothesis, that
it did not, was wrong). But the auto-extend branch is **unreachable in v1**,
because `autoExtendOnApproach` is false (D36) — so it is a rule that has only
ever been exercised on its refusing branch. **The trigger to test it is already
written down**: D36 names the moment that flag is set true as the moment the
deferred measurement comes due. This belongs on the same list.

## The commit tier (D32, M1 bullet 2)

**The repository is the notebook directory**, not a store beside it — that is
what makes the exit extend to the history. An existing repository is adopted and
never re-initialised: the owner may have run `git init` there themselves, or be
keeping the notebook in a repository older than Tephra, and clobbering it would
destroy exactly what this feature protects.

**Never a whole-tree scan on the hot path**, per D34. The writer reports what it
wrote — `StreamDocument.writeDirty` returns the paths — and the commit stages
those. `statusMatrix` runs in exactly one place: `commitOutstanding`, at
startup, reconciling whatever happened while the app was closed.

**`Document.flush()` still returns nothing, deliberately.** `document-api.ts` is
the X-to-Z contract and **Z must never learn file paths**; that mapping belongs
to storage. Main-side callers that legitimately need them hold a
`StreamDocument`, not the interface, and call `writeDirty`.

**A quiet notebook accrues no commits.** Staging an unchanged file still counts
as staged, so the question "did anything really change" has to be asked *before*
staging, per path — after `git.add` everything reads as "added". Without that, a
quiet notebook would gain an empty commit every half hour forever until the log
was useless for its one job.

**The two tiers are chained, and testing has to know it.** A commit is scheduled
by a file write, so both intervals are constructor options: a test that
compressed only the commit tier would still be waiting on the file tier's
one-second quiescence and would conclude, wrongly, that the commit never
happens. That is precisely what happened on the first run.

### The harness now chooses how the app dies

The verify harness ended sessions with `app.exit(0)`, which terminates without
firing `before-quit` — so `stop()` never ran and the harness had never once
exercised graceful shutdown. It now quits properly by default, with
`TEPHRA_EXIT=abrupt` for the other path. Both are needed, and the contrast is
the clearest demonstration of what the tier does:

```
graceful   a57741e 2026-08-22 · A first sentence, typed by hand.
           46f7d07 Opened the notebook          working tree clean

abrupt     2d76a24 Opened the notebook          ?? stream/
```

**And reopening the crashed notebook reconciles it**: the startup scan commits
the orphaned work as "Changes made outside Tephra", the tree comes back clean,
and the text is in the history. The file tier had already saved the *text*; what
the crash cost was only its place in the history, and that is recovered on the
next launch rather than lost.

## Two questions asked of the commit tier, and what they turned up

### "Are external edits committed, or must they be committed explicitly?"

**Measured before answering: neither — they were not committed at all until the
next launch.** The code reads as though they were, because `onChanged` fires for
external changes too, but the paths staged come only from what the app itself
wrote. A notebook is left open for days, and hand-editing is a supported way to
use it (D5, R26), so that left every hand-edit outside the safety net until a
restart.

**Now: committed on the same timers, as their own commit.** Folding someone
else's edit into a commit whose message quotes what *I* typed produces a history
that misattributes both, and the log's whole job is to be trustworthy a year
later. External work commits as "Changes made outside Tephra"; ours quotes ours.

**And the subtler half of the same bug:** because `onChanged` fired for external
changes, a hand-edit set the headline, and the next commit triggered by typing
**quoted text its author never wrote**. Guarded, with a test.

### The feedback loop that was found by looking rather than asserting

`git ls-tree HEAD` on a real notebook showed `.git/index`,
`.git/refs/heads/main` and loose objects **inside the repository's own history**.

The repository lives *inside* the notebook directory, so the watcher sees it —
and every commit rewrites those files, which the watcher reports as an external
change, which schedules another commit, which rewrites them again. A tier that
feeds itself forever, and a tree that can never reach clean.

`isLocal` became `isMachinery`, covering `.git/` as well as `.tephra/`, applied
in the watcher (so the events never arrive), in staging and in the startup scan.
The regression test asserts three things: git's directory is not in the history,
the tier comes to rest, and the tree can actually reach clean.

**Neither of these came from a failing test.** One came from a question about
intent, the other from reading `ls-tree` output on a scratch notebook — the same
lesson as the screenshots: instruments that check state cannot see a thing they
were not pointed at.

## Verification mode is now one gate

Every `TEPHRA_*` affordance — scene running, screenshot capture, the
oversized-window override, menu automation, abrupt exit, the git check — is a
back door: an environment variable that makes the app write a file anywhere,
drive its own menus, or terminate without saving. Individually small;
collectively a surface that grew whenever a test needed something, and **nobody
audits a surface with no name.**

They now pass through `VERIFY_MODE` in `main/verify-mode.ts`:

```ts
!app.isPackaged && process.env['TEPHRA_VERIFY_MODE'] === '1'
```

**`app.isPackaged` is the outer gate and is not overridable** — a shipped
application has no verification affordances whatever the environment says, which
is the property worth having, since the environment is exactly what someone who
can launch the app controls. Inside development it still has to be asked for, so
an ordinary `./run.sh` has none of them either. When it is on, the app says so
on stderr at startup.

`TEPHRA_ROOT` deliberately stays outside the gate: choosing which notebook to
open is ordinary configuration, and it is how `run.sh --scratch` works.

Verified both ways — with the flag absent, a scene does not run and no
screenshot is written even when `TEPHRA_VERIFY` and `TEPHRA_SHOT` are both set.

## History as its own X object (M1 bullet 3)

**Read-only, deliberately.** `restore` throws and says it arrives in M2, on the
rule M0 used for `untag` and `branch`. A restore that quietly did nothing would
be the worst possible behaviour for the one feature people reach for in a panic.

**The contract needed one extension when it met the implementation.**
`history-api.ts` had `read(version, doc)`, which is exactly right for a note or
a fileset and wrong for the stream: the stream is one document by design (D8),
so "the document at a version" is twenty years of text. A **day** is the unit a
reader addresses, and it is already the stream's ordering axis (D9) — so
`readDay(version, date)` and `versionsTouching(date)` joined the interface, with
the reasoning recorded there rather than here.

**What history returns is what the reader saw**, not what the file held:
frontmatter stripped, parts joined (D20). Handing back the frontmatter would
make "copy the paragraph out" mean "and then delete the header", and a day that
crossed the split threshold in 2031 was never something the reader agreed to
know about.

**Null and empty are different answers.** A day that did not exist at a version
reads as null; a day that existed and was blank reads as `''`. A browser showing
one pane for both would be lying about one of them.

## The day-file split (M1 bullet 4)

**The rule is a pure function** — `splitBody(body, threshold)` — because the
correctness lives in the rule, not in the plumbing, and a pure function can be
tested at thresholds a real day will never reach.

**Prefix-stability is what the rule exists for**, and it is stronger than
determinism. Scanning left to right and closing each part as soon as it can be
closed is what buys it: no part's boundary is ever chosen with knowledge of what
comes after it. Tested by appending forty times and asserting that every part
but the last stays byte-identical — because a boundary that moved would rewrite
part 1 for a change that only touched the end, and under sync that is **a
conflict manufactured out of a change nobody made**.

**A paragraph bigger than the threshold is kept whole**, and the part is allowed
to be oversized. Splitting inside it would cut a sentence in half in a file
somebody may open in another editor; a rare, visible, harmless overflow beats
silent damage to the text.

**The common path is untouched.** A day that fits in one file still takes the
original splice path, preserving byte for byte what it did not change — which is
what stops every save becoming a diff of reformatted YAML. Only a day past the
threshold takes the second path, where later parts have no original bytes to
preserve and are rendered fresh. Making the always-case pay for the
once-in-a-career case would be the wrong trade.

**A shrinking day deletes its own tail.** An orphaned part 2 would be read back
as part of the day forever, silently restoring text that had been deleted — the
worst kind of leftover, and one nothing else would catch.

**Two traps found while testing, both in the tests rather than the code.**
`x?.length ?? 0 > 0` parses as `x?.length ?? (0 > 0)`. And `2026-03-14.2.md`
sorts *before* `2026-03-14.md`, because `'2'` precedes `'m'` — so **filename
order is not part order**, and nothing should ever assume it is. The frontmatter
`part` key is what orders them, which is what the format says.

## The write-ahead log (M1 bullet 5)

**One record shape, and the field that matters is `baseLen`.** A record is a
day, a text edit, and *the day's length before that edit*. The length is what
makes replay safe to run twice — and it has to be, because a crash can land
after the files were written and before the log was cleared. Replaying then
would append the same paragraph a second time, silently, to the one place it was
supposed to be safe. On replay a record whose day is not the length it expected
is skipped as already applied; later records match again, so recovery resumes
wherever the files actually got to rather than refusing wholesale.

**The record is emitted from inside `StreamDocument.#applyAndRecord`**, because
that is the only place the pre-edit length still exists. Anywhere downstream the
edit has already been applied. `onJournal` has exactly one subscriber and gives
out pre-edit state, which nothing else needs and nothing else should have.

**Files first, then clear the log.** The other order loses the edits outright if
the process dies between the two; this order duplicates them, and `baseLen`
makes duplication harmless. Choose the failure you can undo.

**A torn last line is expected, not exceptional.** A crash is exactly the event
that leaves half a line behind, and refusing to recover anything because the
final fragment is incomplete would give up at the precise moment the log was
needed.

**Two places the existing design was already right and the implementation was
not.** `.tephra/wal` is in `REQUIRED_DIRS` — a *directory*, so the log can be
segmented later — and my first version wrote a file at that exact path, which
failed with `EISDIR`. And `format-spec.md` specifies `wal/<doc-id>.jsonl`, one
log per document; v1 has only the stream, but honouring the shape now costs
nothing. **Both were caught by reading what was already written down rather than
by a test.**

**One deliberate divergence from the spec, recorded.** It describes the log as
holding serialised `DocumentChange` records. What is written is narrower: per-day
text edits plus `baseLen`. A `DocumentChange` carries generations, and a
`SessionGeneration` dies with its process (D33) — so the part of it that would
survive a crash is exactly the part being written, and the rest would be noise.

**Verified against a real crash**, not a simulated one: a live app typed a
sentence, `TEPHRA_EXIT=abrupt` killed it without running `before-quit`, and the
day file did not exist at all. Reopening printed *"recovered 1 unsaved edit(s)
from the log"* and the sentence was in the buffer and on disk.

## What `npm run m1` asserts, and one thing it found

M0 asked whether the app could write a file and find it again. M1 asks the
harder question — **whether anything can be lost** — so every assertion is made
against the files and the repository on disk, never against the app's account of
itself. Four real launches, one of them killed deliberately.

**The crash section is the one that matters.** It checks, in order, that the day
file did *not* yet exist (so the log is genuinely what is under test), that the
log held the edit, that reopening printed a recovery, that the text is on disk
afterwards — and that it appears **exactly once**, because a replay that
duplicates is the failure mode `baseLen` exists to prevent.

### A finding: an oversized day that arrives from outside is not split

The first version of the split section seeded a 1.05 MB day file and relaunched.
The app read it back perfectly as one day — and left it as one file.

That is correct, and worth stating rather than fixing. **A day is only written
when it is dirty**, and we never rewrite a file we did not change
(format-spec). A file the reader created by hand is not ours to reformat, even
into a shape the format prefers. The split therefore happens when a day crosses
the threshold **through use**, which is the path a real day takes; the
acceptance run now types into the oversized day, which is both the honest
trigger and the one a person would produce.

## The range gesture (M2 bullet 1)

**One command list, three renderings.** `shared/commands.ts` holds
`RANGE_COMMANDS`; main builds the Range menu and the context menu from it, and
both get their enable state from the same `isEnabled`. Two menus maintained
separately disagree the first time either gains an item, and the disagreement is
invisible until somebody right-clicks and finds a command they used ten minutes
ago from the menu bar missing.

**A command that is not built yet is never enabled.** Greying it out is the
"throwing beats pretending" rule pointed at the reader rather than the
programmer — a menu item that does nothing teaches people to distrust the menu.

**Main owns how a command is reached; the renderer owns what the caret is.** The
renderer reports only two booleans, deduplicated, because the caret moves on
every keystroke and sending IPC per keypress to change nothing is traffic on the
one path R1.1 protects.

**Not `window.prompt`.** It blocks the renderer's event loop, including the
editor's painting, and cannot be styled. `Prompt.tsx` is the shared answer for
the four commands that need a word.

### The bug this bullet found: two mirrors of one generation

Writing the first bookmark failed with
`StalePositionError: position is from generation 1, expected 2`.

`RemoteDocument.generation` was refreshed **only at open and on undo/redo**.
Ordinary edits travel through `RemoteWindow`, which learns the new generation
from its own ack and has no reason to report it back — so the renderer held two
mirrors of one number, and they diverged the moment anyone typed. Every position
built from the document's copy was born stale.

`generation` now returns the newest across the document and its windows, so the
two agree **by construction** rather than by a notification that can be
forgotten. **This is exactly what D33 exists to prevent** — a version axis is
worth nothing if two objects each keep their own idea of it — and it is the same
shape as the frame's "two computations of one quantity": the bug is never the
arithmetic, it is that the quantity had two homes.

It was invisible until now because nothing had yet built a durable position from
`doc.generation` after a keystroke. M0 restored the cursor at open, when the two
still agreed.

## A marker at the start of a line eats the line (M2.1)

Bookmarking a boldfaced phrase broke it: `**Intrinsic S**` lost its bold and the
raw `<!--tephra:mark …-->` sat in the text. Two independent faults, found by
running the real `@lezer/markdown` parser rather than by reasoning about it:

**One — CommonMark's HTML-block rule.** A comment that begins a paragraph's
first line makes the *whole paragraph* an HTML block, so nothing inside it is
markdown any more:

| line | strong? | parsed as |
|---|---|---|
| `**Intrinsic S** is…` | yes | Paragraph |
| `<!--tephra:mark …-->**Intrinsic S** is…` | **no** | CommentBlock |
| `<!--tephra:mark …--> **Intrinsic S** is…` | **no** | CommentBlock |
| `x<!--tephra:mark …-->**Intrinsic S**…` | yes | Paragraph + Comment |

The user's instinct — restore the missing space — could not have worked, and the
table says why: the space changes nothing, because it is *starting the line*
that matters, not what follows. Giving the marker its own line is equally wrong;
it splits a hard-wrapped paragraph in two.

The only universally safe placement is the **end of the previous line**, which
is what `placeMarker` in `src/main/x/markers.ts` now does. A marker asked for at
a line's start moves back one character, joining the line above; everywhere else
it stays exactly where it was asked for. The document position it marks is
unchanged — this is a placement rule about bytes, not about meaning.

**Two — the marker was never a widget.** D16 and the format spec both say
markers render as widgets away from the cursor, "so it is rarely seen." Nothing
had ever implemented that, and no test caught it because until M2.1 nothing
wrote a marker. `MarkerWidget` now draws it as a small badge.

The visible asterisks that remained after the fix are **not** a third fault:
they are Q11's reveal-on-cursor behaviour, correct and still unsettled. My first
verification run reported them as a failure because the scene parked the caret
through a stale view handle and so never moved it off the phrase — a measurement
error of exactly the kind `notes.md` keeps collecting.

## Tagging is interval arithmetic, and returns a body (M2.2)

Four things a tag operation has to do — extend a span, merge two, split one,
trim an edge — are four special cases only if you write them that way. Each is a
chance to leave the file with two `tag-start`s in a row, and **alternation is the
only reason pairing works without identifiers** (D21), so the damage would be
silent and permanent.

`tagBody` reads the subject's spans out of the text, unions or subtracts the
requested range, and writes the resulting disjoint set back. All four cases are
then the same code, and alternation holds by construction.

**It returns the new body, not a batch of edits, and that is the interesting
part.** The natural implementation emits deletions for the old markers and
insertions for the new ones — and it cannot be made correct, because an
insertion's position is decided by text the deletions are removing. A marker
written at the very start of a body is given its own line; deleting it takes
that line with it; and the offset the replacement was computed against no longer
exists. Rewriting the string and handing it to `minimalReplacement` has no
coordinate system to get wrong. The cost is one replacement spanning the changed
region, on an operation that happens once per menu invocation.

Two rules fell out of writing the tests rather than out of thinking:

- **A marker alone on a line takes the line with it when removed.** Leaving the
  blank line behind turns one paragraph into two.
- **Spans are trimmed to the text they cover.** A selection usually runs a space
  past the last word, and a marker parked at the end of the line above leaves its
  newline inside the span. Without trimming, untagging the visible words leaves a
  one-character tag behind and the round trip is not exact — which is now
  asserted directly: tag, untag, and the file is byte-for-byte what it was.

## Branching, and a link that is actually a link (M2.3)

The operation is D13's ordering made literal — create the file, update
references, delete from the source — in one method, because assembled by Z from
three primitives the guarantee is gone. Undo restores the stream but leaves the
branched file, which is the same trade the ordering makes: **duplicated content
is visible and fixable; lost content is not.**

Two things the build settled that the design had left implicit:

- **A link left as `[Titration curves](../../../notes/titration-curves.md)` is
  not a path back, it is a line of punctuation to read past.** D13 says the link
  is v1's *entire* findability mechanism for branched content, so it now renders
  as its own words, underlined, with the target in the tooltip, and opens the
  file. Ordinary markdown, so it keeps working in any other editor.
- **A link target is data, not configuration.** It can be typed, pasted, or
  arrive with an imported file (R28), so `../../..` repeated enough times reaches
  anywhere on the machine. `resolveInsideNotebook` resolves and checks
  containment, with the escape attempts written down as tests rather than left as
  an assumption.

### The same module-scope Electron fault, a third time

`import { shell } from 'electron'` at the top of `document-service.ts` broke
three integration suites at module load — they drive the service under plain
node, which is a property worth having and which nothing had written down.

It is the identical shape as `app.isPackaged` at module scope in `verify-mode.ts`
and as `require('electron')` during module evaluation in the packaged build. The
fix was not a lazy import but the layering telling the truth: **what a link means
is a question about the notebook and answerable under node; opening a file is a
question about the desktop.** So the service returns a path and `ipc.ts` opens
it. The test failure was the design being pointed out, not an obstacle to it.

## What MA and MB cost, and the two things that only a screenshot found

Markers left the buffer (D44) and both faults that followed were invisible to
the test suite. Both were caught by looking at the screen.

**The renderer had a second copy of the mapping.** `StreamWindow.toBuffer`
learned the prose↔raw arithmetic; `RemoteWindow.toBuffer` — the renderer's half
of the same object (D37) — went on adding a raw offset to a prose start. Every
test passed, because the tests exercise main. On screen, tag underlines simply
never appeared.

This is the **third** time this codebase has been bitten by two computations of
one quantity: the frame computed its measure twice, `generation` had two homes,
and now a coordinate mapping had two implementations. The fix is the same one
each time — one implementation, in `shared/prose.ts`, used by both sides, with
the snapshot carrying the markers so the renderer can build the identical map.

**The rules were drawn and then thrown away.** An inline element's background is
clipped to its border box, so an underline positioned *below* the em box is
rendered and discarded. It took instrumenting the running app — element count,
computed colour, computed background-position — to see that everything was
correct and the pixels still were not there. `padding-bottom` on the inline box
is what gives the rules somewhere to exist.

### And one the tests found, which is the interesting direction

`tagSlot` took `hash % 8` straight from FNV-1a, whose low bits barely avalanche
for short strings: sixteen plausible subject names reached five of the eight
hues and put four of themselves on one colour. **A palette of eight that behaves
like a palette of five is worse than none, because it looks like it is telling
you something.** Murmur3's finaliser fixed it — and then the first version of
that returned NEGATIVE slots, because `^` yields a signed 32-bit integer in
JavaScript and a negative left operand makes `%` negative.

The test that caught both was almost written badly. Checking two dozen real
subject names for an unused hue fails by luck about a quarter of the time and
passes by luck the rest, so it would have measured a coin flip and been deleted
the first time it went red for no reason. Four hundred generated names measure
the hash.

### An intermittent, recorded rather than explained

`npm run m1` reported 15/3 twice during this stretch and 18/18 on nine other
runs, including four consecutive attempts to reproduce it. Both failures came
straight after other Electron launches in the same shell, which points at a
leftover process or a notebook lock rather than at logic — but that is a guess,
and it is written here as one. The next occurrence gets its failing check names
captured before anything is theorised.

## Three coordinate spaces, and the cast that hid the third

The reported bug: tag "participant has a finite" as *Foo*, then tag the
overlapping "finite shock limit" as *Bar*, and the file came back as

```
Every market <!--tag-start Foo--><!--tag-start Bar-->participant has a finite sho<!--tag-end Bar-->ck limit<!--tag-end Foo-->
```

Both markers of the second tag were about twenty-seven bytes early — one
marker's width — because the second selection was made against a buffer that now
carried a handle, and `RemoteWindow.toDocument` was still returning

```ts
offset: (offset - p.start) as Offset
```

`offset - p.start` is a prose offset within the segment. `Offset` counts bytes.
**They are equal for every body with no markers in it**, which is why the whole
suite passed and why the fault appeared only on the second tag.

### What the fix actually is

There are THREE coordinate spaces here, not two, and only two had names:

| | counts | named |
|---|---|---|
| `Offset` | bytes within one segment's body | was |
| `BufferPosition` | prose characters across the window | was |
| `ProseOffset` | prose characters within one segment | **was not** |

The unnamed one is where the bug lived. It now has a brand, `ProseMap.toRaw`
will not accept an `Offset`, and the two additions that cross between window and
segment are named functions — `inWindow`, `inSegment` — rather than a `+` that
looks innocent. The cast that produced the bug no longer compiles.

### Why the renderer had no tests, and that being the real fault

`RemoteWindow` is the renderer's half of `DocumentWindow` (D37) and had no unit
tests at all — not from neglect, but because **it could not be imported by
one**: it used the `@shared/*` path alias, which vite resolves and the test
runner does not. An entire layer was untestable by construction, and that layer
is where both of this stretch's coordinate bugs lived.

So the alias is gone. Renderer files use relative imports like everything else,
`tests/renderer/` typechecks under the web project because that code needs the
DOM lib, and the first thing written in it is the reproduction of this bug.
Brevity in an import line is not worth a layer nobody can test.

## Growth handed the editor bytes, and why that was the third of a kind

Opening a notebook that already had history showed raw `<!--tephra:tag-start …-->`
in the text. Nothing was wrong with loading: the snapshot was prose, the spans
were right, the mapping was right. **`extend` was wrong** — the path that grows
the loaded region backwards, which is how every day but the one being written
gets into the window:

```ts
const insert = ordered.map(s => s.body).join('')   // bytes, into a prose buffer
```

Reproducing it needed a notebook whose history is in an EARLIER day than today,
which is every real notebook and none of the fixtures, because every `extend`
test used days with no markers in them.

### The class, not the instance

This is the third time raw bytes reached a prose buffer since markers left it
(D44): `documentChanged` handed over the document's raw payloads, `RemoteWindow`
recomputed the mapping without eliding, and now `extend` inserted bodies. Each
looked like a different bug. They are one: **anything that puts text into the
buffer must put prose there, and `string` does not say which kind of string it
is.**

So all four paths that can supply buffer text were audited rather than waiting
for a fourth:

| path | supplies | now |
|---|---|---|
| `#rebuild` | the whole buffer | `segment.prose.text` ✓ |
| `documentChanged` | edits from elsewhere | a prose-to-prose diff ✓ |
| `extend` | a prepended day | `segment.prose.text` ✓ |
| `window.text` | snapshot and reset | prose by construction ✓ |

Each now has a test. A `ProseText` brand on the strings themselves would make
the class impossible rather than merely covered, the way `ProseOffset` did for
the coordinates — worth doing if a fourth appears.

### The test earned its keep by failing first

The regression test was run against the BROKEN code before the fix went in, and
watched to fail. `notes.md` records four occasions where a passing check proved
nothing because its positive control had never fired; this one fired.

## An underline outliving its tag: the one event nobody was announcing

Deleting a tag's mark removed both markers from the file correctly and left the
underline on screen. Nothing was stale in main; the renderer simply was never
told.

Two mechanisms have to miss for this to happen, and both did:

- **Echo suppression.** A window is never told about a change it originated, so
  the deletion — which the editor made — produced no `onChanged`. That rule is
  right and is what stops text duplicating.
- **The acknowledgement is silent.** `RemoteWindow` replaces its span list from
  every ack, and did so with a bare assignment. The tag was gone from the list a
  moment after the keystroke, and nothing asked for a redraw.

So the decorations were rebuilt once, on `docChanged`, from spans that still
listed a tag the document no longer had — mapped through the deletion, which is
why the rule survived it looking plausible.

**`onSpansChanged` is now part of the window's surface**, separate from
`onChanged` because the two genuinely do not coincide: a tag can appear or
disappear on an edit the editor itself made. It is announced only when the spans
actually differ, since an ack arrives for every keystroke and a redraw per
keystroke would put work on the typing path for something that changes a few
times an hour.

The general shape, for the third time in this milestone: **two objects held one
fact and only one of them was maintained.** Here the fact was "which spans
exist"; earlier it was the coordinate mapping, and before that the generation.

## The mark speaks (MB.4, MB.5)

Clicking a mark opens a small panel: the subject, with its colour, and Rename
and Remove. A bookmark's mark says so and offers Remove. **It is also the only
place the subjects past the third are visible** — the extent stacks three rules
deep and no further, so "what is this passage" is a question the list answers
and the underlines cannot.

Identification is a coordinate question and is asked in coordinates, not
re-derived from the text: a bookmark's span is zero-length AT its marker, and a
tag's span begins one prose character after it — the character the mark itself
occupies (D44). So the mark at prose position *p* opens the tag whose buffer
begin is *p+1*, and the panel then lists every other tag covering *p*.

### Renaming forced the algebra to generalise

"Rename this span" is one subject losing a range and another gaining it, and as
**two** calls it cannot be made correct. The first rewrites the body, so the
range for the second has to be carried through a change that deleted the very
markers it was measured against — and `minimalReplacement` reports that change
as one replacement spanning the whole tagged passage, which destroys exactly the
positions needed. The first attempt did this, and produced a renamed span
covering nothing at all.

So `tagBody` became `retagBody(body, ops[])`: any number of subjects, all
measured against one body, all emitted from one disjoint set. `tagBody` is now
the single-subject case of it. Renaming is one call, one edit, one undo step.

**Rename means this span, never the subject everywhere.** Renaming a subject
across the corpus has to find every file that mentions it and changes text the
reader is not looking at; that is a different operation and it is not this one.

### And resolved spans became tight

A marker may not begin a line, so a tag over a paragraph has its start parked at
the end of the line above — which left the newline inside the span, and a tag on
a body's first paragraph appeared to start on a line break it did not mean.
`normalise` already trimmed on the way in; `resolveTags` now trims on the way
out, so the two agree. One existing test expected `'three '` and now correctly
gets `'three'`.

## The pattern behind four bugs (D45)

The renamed-tag bug is worth stating precisely because it is the least
disguised: **the announcement was skipped when the prose diff was null.** A
rename changes marker names, which prose cannot see, so the buffer was
byte-identical and an early return sent the renderer nothing. The file was
right; the UI was a version behind; clicking the mark reported the old subject.

Fixing it alone would have been a one-line change and a missed lesson. The real
finding is that this was the fourth bug of one kind in a single milestone —
the mapping, the spans-after-ack, the growth path, and now this — and that all
four came from **derived state being refreshed as a side effect of text
changing**. D45 states the rule that was always being relied on and never
written down: one announcement per change, carrying everything, with edits as a
description of the text's movement rather than a test of whether to speak.

Worth noting what did NOT go wrong, because it says where to look next time: the
document was correct every single time. Every one of the four lived in the gap
between two objects holding one fact — and in three of the four, the object
holding the stale copy was the renderer's half of a split pair.

## Printing (M2.4)

Spike B's prediction held exactly: the work is in the web layer, and the shell's
whole contribution is `src/main/print.ts` — a window, a PDF, and a viewer.

Three decisions inside it were not in the spike.

**It renders from the editor's own parser.** Adding `marked` would have been
fewer lines and would have installed the fault this milestone has now met four
times: two computations of one quantity, disagreeing quietly and only about the
awkward cases. `@lezer/markdown` with GFM is already present because the editor
uses it, so paper and screen cannot disagree about what is bold.

**Math goes to MathML, where the screen uses KaTeX's HTML.** KaTeX's HTML output
is a lattice of positioned spans that means nothing without its stylesheet, and
the stylesheet means nothing without its sixty font files. A print document is
rendered offscreen and thrown away, so it has to be self-contained; MathML is
rendered by the browser itself and needs no assets at all. The first attempt
shipped KaTeX HTML with no CSS and printed an integral as `∫0τ r(t) dt`.

**Raw HTML in a passage prints as the text it is.** The first version dropped
the tags and kept what was between them, so `<script>alert(1)</script>` printed
as `alert(1)` — the worst of the three options, because it silently altered what
the person wrote. A document is prose, not a template: it may not put markup on
the page, and it may not have its words quietly removed either. Comments are the
exception and print as nothing, which is what they are everywhere else — and
Tephra's own markers are comments.

### The one trap that came back wearing a different hat

Spike B's fourth trap was that Electron prints through a temp file, so relative
images 404 without an explicit `<base href>`. The base was there from the start
and every image still arrived broken, because the document was handed over as a
**data: URL** — an opaque origin, which is allowed to resolve nothing. Written
to a real file and loaded as one, the base works. The spike found the right
rule; the reason it applies is one layer deeper than it recorded.

### Print takes whole lines, and why that is the rule rather than a convenience

Selecting a heading and printing it produced a paragraph. The cause is not in
the printer: **the editor conceals `## ` and the concealment is atomic**, so a
selection starting at the heading's first visible character starts *after* the
hashes. Verified in the running app — the selection began at `"The Sh"`.

Every block construct fails the same way, because markdown reads block structure
off the START of a line: `-` makes an item, `>` a quotation, `|` a table row,
```` ``` ```` a code fence. So the fix is not to special-case headings but to
widen the printed range to whole lines. **Half a line of markdown is not a
smaller piece of the document; it is a different document.**

Tagging and branching deliberately do not widen: those apply to exactly the
words chosen, and a tag over half a sentence is a perfectly good tag.
