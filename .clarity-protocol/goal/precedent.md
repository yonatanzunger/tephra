# Precedent: three systems that worked, and how each one broke

Unusually for a new project, there is lived evidence rather than speculation: three prior systems, two of which worked well, each of which failed for an identifiable reason. **None of them failed for lack of features**, which is the most important fact in this document.

## Era 1 — the physical lab notebook (physicist)

The traditional thing: a continuous scroll of thinking, undifferentiated, chronological.

**Failure mode:** no searchability. Notably this "wasn't a big issue at the time" — the corpus was small enough and the working memory recent enough that scanning sufficed. The gap grew with the volume and the number of concurrent threads, rather than being wrong from the start.

## Era 2 — the structured physical notebook — **worked excellently**

The same continuous scroll, plus two structures:

- **A TODO list occupying the front**, worked one two-page spread at a time. Items marked `·` unstarted, `/` started, `✗` complete, ~~struck through~~ cancelled. **When a spread filled, the remaining live items were transcribed onto the next spread.**
- **A separate calendar section.**

**Failure mode: access, not capability.** It stopped working when the user was regularly in situations with a laptop or phone but not the notebook. The system was fine; it was in the wrong place.

### The mechanic worth stealing, which nobody designed on purpose

Copying live items forward when a spread filled was a **forced periodic review**. Anything not worth re-transcribing died — silently, cheaply, and *by a decision* rather than by neglect. The physical constraint of a finite page created the discipline.

**A digital list never fills, so nothing ever forces that review.** Items accumulate indefinitely, the re-reading never happens, and things die by being forgotten instead of by being dropped. That is the graveyard problem in miniature — and it is a direct explanation of the user's report that *"whenever these methods were present, graveyards weren't an issue."*

Finding a digital equivalent of the filling page may be the single highest-leverage design question in this project. It is also the one thing here that speaks directly to the problem Portal was originally built to solve.

**Related tension, worth holding:** era 2 had **no due dates** and worked excellently. Due dates and urgency highlighting are on the current wish list as the thing that "covers the rest" — but the best-performing system in this history did without them, using a filling page and a weekly-ish transcription instead. Worth knowing which mechanism is actually doing the work before building both.

## Era 3 — Google Docs, then M365 — **failed**

Adopted to solve era 2's access problem, and it did solve that.

**Failure modes, in order of severity:**

1. **Reduced structure** relative to what could be written on paper. A document editor could not express what a notebook page could.
2. **Barely functional mobile** (M365 especially) — which reintroduced era 2's access problem in a new form, after access was the whole reason for the move.
3. **Flaky desktop.**

## The synthesis: what actually predicts success

> *All of these notebooks worked if and only if the process of reading and writing from them was a joy.*

On paper this meant tuning the physical experience — paper stock, pens, comfort in the hand over long sessions. In software it means **typography, visual layout, and the responsiveness of the typing experience.**

This is not a polish requirement to be added at the end. It is the **primary requirement**, and the history is the evidence: era 3 had strictly more features than era 2 and failed anyway, because it wasn't a pleasure to use. Era 2 had four symbols and a calendar and worked excellently.

**So the requirement set the history actually supports is short:**

1. **Available wherever thinking happens** — era 2's failure.
2. **A joy to read and write in, on every device it runs on** — era 3's failure, and the one that is hardest to specify and easiest to under-fund.
3. **Searchable** — era 1's gap, which grew rather than being wrong from the start, and which the subject model now makes load-bearing.

Everything else is negotiable until proven otherwise. The design should be suspicious of any feature that does not serve one of these three, because the historical record shows features were never the binding constraint.
