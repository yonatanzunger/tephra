# Handoff — resuming this conversation

Written 2026-08-12, at the point where the Clarity session moved from `../portal` to this directory. **Audience: the next instance of me.** It deliberately contains *only* what is not already in the protocol documents — everything else is there and should be read rather than summarised here, because a duplicate will drift.

Delete or rewrite this file once its contents have been absorbed into the normal documents. It is scaffolding, not a record.

## Read in this order

1. `summary.md` — what this is and why, in prose.
2. `goal/precedent.md` — **the most load-bearing document.** Three prior systems, why each failed. Nearly every requirement traces back to it, and arguments about scope should be settled against it.
3. `goal/problem.md`, `goal/requirements.md`, `goal/stakeholders.md`.
4. `goal/open-questions.md` — five questions, Q1/Q4 gating everything.
5. `notes.md` — carried design discipline and the open forks.
6. `carried-over.md` — what to reuse from Portal, and what not to.
7. `notes/01 general ideas.md` — the user's own writeup, in their words. The protocol documents are derived from it; when they disagree, this is the source.

## Where we are

**Problem clarification is essentially complete.** Steps 1–10 and 12 of the process are done. **Step 11 (verify alignment) has not happened** — the goal documents and `summary.md` were written but never confirmed by the user. Ask early.

**The agreed next step is a single prototype answering Q1 and Q4 together**: the smallest thing with a real vim mode, an inline-rendered equation, an inline image, and a table — then type into it at full speed and measure. Scope was explicitly extended to include **printing a range and pasting an image**, because that is where the user has *measured* pain (Tauri), not merely suspected it.

**Nothing has been built. There are no decisions recorded yet in this project** — `decisions/` is empty, and that is correct; nothing has been decided that needed to be.

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

## Live threads not yet in the documents

- **The name.** "Notebook" is a placeholder and the directory name follows it. Renaming is trivial now and annoying later.
- **Q4 option 4 (an extension to an existing editor) has not been discussed with the user.** I added it to `open-questions.md` for honest pricing; they have not reacted to it. It is close to their current working setup — VSCode plus vim plugins — and it fails R1.5 ("the UX is the user's own") while covering no mobile. Raise it explicitly rather than letting it sit in a document.
- **The two tagging systems** — subjects on text ranges, and TODO groupings — are stated as unrelated (R17). The instinct to unify them should be resisted absent evidence they are the same thing *for the same reason*.
- **Portal's `todo.md`** still holds real implementation work (Android TLS trust, a stray spike repo at `github.com/yonatanzunger/portal-t5-spike` that wants deleting). If Portal is ever resumed, start there.
