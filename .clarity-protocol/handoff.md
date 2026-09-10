# Orientation — resuming work on Tephra

**Rewritten 2026-09-10, when v1 completed**, replacing the 2026-08-12 handoff
this file used to be. That file was scaffolding from the move out of `../portal`
and said so; its reading order and its "where we are" were stale by weeks. What
it declared non-recoverable — **how this user works**, and **the mistakes worth
not repeating** — is kept below verbatim, because it is still the most useful
thing here.

## Where the project is

**v1 is complete.** The ordered plan in `solution/milestones.md` is finished:
MD1 → MT4 → MD2 → MT4a → MT5a → MT5b → ML2+ML3 → MT6 → MT7 → MS1–MS4 → R7. The
app is in daily use and has been for months, which is why several decisions were
reversed by evidence rather than argument.

Everything that remains is **wanted-on-demand and freely reorderable** — the
backlog at the foot of `milestones.md`. After that, `components.md`'s sequence:
v2a sync alone, v2b Android, v3 promotes what earned it.

**A design cycle is starting** (2026-09-10), driven by what daily use has taught.
Expect reprioritisation rather than continuation.

## Read in this order

1. `summary.md` — what this is and why, in prose.
2. `goal/precedent.md` — **still the most load-bearing document.** Three prior
   systems and why each failed; nearly every requirement traces back to it, and
   arguments about scope should be settled against it.
3. `goal/requirements.md` — and note which have been amended: R1.4 (vim, by
   D67) and R15–R17 (superseded by `goal/todo.md`).
4. `solution/milestones.md` — what was built, in what order, and what is in the
   backlog. The narrative of the build.
5. `solution/architecture-as-built.md` — the map: which module holds what, and
   where each contract is written down. Read it before touching code.
6. `decisions/decisions.md` — 67 decisions, append-only with amendments in
   place. **Never rewrite one**; amend it and date the amendment.
7. `notes.md` — the carried design discipline, and the general rules the
   failures produced. Short, and repeatedly load-bearing.
8. `goal/open-questions.md` — what is still genuinely open. The header says
   which, as of the v1 audit.

## The distinction that governs these documents

**Records must not be rewritten; descriptions must match today.**

- **Records**: `decisions/decisions.md`, `goal/discovery/`, `failures/`,
  `observations.md`, `notes.md`, the transcripts. History. Amend, annotate, date
  — never edit in place to make the past look consistent.
- **Descriptions**: `architecture-as-built.md`, `features.md`, `milestones.md`,
  `format-spec.md`, `scope.md`, `components.md`. These claim to say what *is*,
  so a stale line in one of them is a bug.

## What the acceptance suites are for

`npm test` is the unit and integration suites; `npm run m0`–`m4` drive a real
Electron window through scenes in `verify.ts`. **The suites exist because the
unit tests could not have caught this project's worst bugs** — a segment cache
race, a span mislabelled by a fallthrough, a search panel inked from the wrong
surface. And **screenshots caught what the suites could not**, repeatedly. Look
at the thing before reporting it done.

`npm run typecheck` is the only command that typechecks the main process;
`npx tsc -p .` silently skips it.

## How this user works

The genuinely non-recoverable part, and worth reading before the first substantive exchange.

**They think by writing, and generate context in long prose.** Give them room. Their documents contain more than they realise — the vim requirement arrived buried in an aside and turned out to constrain the entire technology choice.

**Lay out the problem in current terms before analysing it.** They asked for this explicitly, and it was a fair correction: *"for each of these problems, can we start out by laying out the problem clearly and in our current context, given that many of these open questions were written down before all sorts of changes to the design?"* Several items had gone stale under later decisions. Restating the problem before proposing an answer is not throat-clearing here; it repeatedly changed the answer.

**They improve framings, so present the reasoning rather than only the conclusion.** In one session they decomposed the merge picker in a way that deleted a whole rung of the ladder, correctly rejected a default I proposed, and reframed a scary-sounding data-loss risk into a narrow one by asking what the pointed-at thing actually contained. Show the working; they will find the flaw in it.

**They prefer deletion to addition** and respond well to a model that *dissolves* a problem rather than solving it. "This deletes the hardest requirement" is the most persuasive sentence available.

**Deep technical background** — physicist, systems designer, four years at Microsoft. No fundamentals need explaining, and hedging reads as noise. **But modern platform specifics are genuinely unfamiliar**: macOS experience is decades old, Android experience slight. Be concrete about platform APIs and honest about where the platform risk sits.

**They defer decisively** ("let's punt this") and are comfortable leaving things open. Don't force closure. Do insist on capturing *why* something was deferred and what would reopen it.

**Craft matters to them intrinsically** — custom mechanical keyboards, pen and paper stock chosen for how they feel. Treat experience requirements as hard requirements, not polish. This is the single most reliable predictor of what they will care about.

## Mistakes I made, so as not to repeat them

- **Escalation-by-adjacency.** After deferring one item I promoted its neighbour to "blocking" on no new evidence, purely because it had inherited the vacated slot. It turned out to need no design at all. Check whether anything about the promoted item actually changed.
- **Proposed a default where none was sane.** For the conflict picker I suggested pre-selecting the non-destructive option; the user correctly observed that a default reads as a recommendation the system has no basis for, and is a soft form of the silent resolution the design rejects everywhere else.
- **Rescued a mechanism without checking its arity assumption.** Two rounds were spent on why an ordering rule couldn't reach commit timestamps, before noticing it had also assumed one commit per side — which was false, and which invalidated it independently.
- **Referenced a document before writing it.** `notes.md` pointed at `carried-over.md` for a while before it existed.
- **Jumped to analysis without restating the problem.** See above; the user had to ask.

## Priors worth carrying

**Open items here tend to shrink on examination.** Of the four worked through in Portal, three turned out materially smaller than their write-ups implied — one dissolved entirely, one was answered by a decomposition, one collapsed once its severity was analysed honestly. Approach each open question expecting it to be smaller than it looks, and check whether it is still a question at all before designing an answer.

**The requirement set is short and the history supports being ruthless about it.** Available everywhere thinking happens; a joy to read and write in; findable months later. Anything not serving one of those three should be asked to justify itself, because features were never the binding constraint in twenty years of evidence.

## Live threads

- **Q2 (storage and sync) is still open**, and v1 shipped without needing it —
  which means it is now answerable on evidence from a real corpus.
- **Q11 (what revealing markup should do)** is the sharpest remaining question,
  because it is what the backlog's *rendered editing* item would answer.
- **The two tagging systems** — subjects on text ranges, and task tags — are
  still stated as unrelated. The instinct to unify them should be resisted
  absent evidence they are the same thing *for the same reason*. (They now share
  one *notation*, `shared/tags.ts`, which is not the same claim.)
- **Portal's `todo.md`** still holds real implementation work (Android TLS
  trust, a stray spike repo at `github.com/yonatanzunger/portal-t5-spike` that
  wants deleting). If Portal is ever resumed, start there.
