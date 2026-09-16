# The candidate register — what left the backlog, and why

> **The live list moved to `../milestones.md` on 2026-09-16**, when that file
> became the list of projects rather than a plan. This file keeps the *register*:
> every candidate that has been promoted, dissolved or absorbed, with the reason.
> **One list is live, and it is not this one** — a candidate recorded here and
> also there would drift, and the copy that drifts is always the one nobody is
> reading.

**Audited 2026-09-10, when v1 completed.** Four of these left the backlog during
v1 rather than after v2, which is the list working rather than failing: each was
promoted by use or by a specific recorded failure, not by argument. Struck rows
are kept because *why* something was promoted is the reusable part — and that is
now this file's whole job.

The test each of them was admitted or dropped against is `goal/scope.md`'s:
**what does having this here beat?** The evidence came from living on v1, which
is why v1 deliberately ran the plain-file stand-ins rather than doing without.

| Candidate | Competes with | What would promote it |
|---|---|---|
| ~~**TODO type and UX**~~ (R15–R17) | — | **Left the backlog on 2026-09-01** (D55–D58). Both reasons for the M3 re-deferral fell: the record-shaped prediction was wrong (it is a text kind), and D4's evidence gate was never exercised, so its silence was not a "no". Designed in `goal/todo.md` and `solution/parts/todo.md`. |
| ~~**Urgency ranking**~~ (R16) | — | Absorbed as T9. |
| ~~**The forced review**~~ (R16a) | — | Dissolved: the premise was wrong. It became two mechanisms — the soft cap (T12) and the daily walk (T11) — neither of which is a forced review. See Q3. |
| ~~**The link directory**~~ (R10a) | — | **Left the backlog on 2026-09-01** (D57, D60, D61). Nothing had to promote it: the need was already established (`goal/todo.md`, interaction 2, unserved in three eras) and the sweep is one `CorpusIndex` already performs. Scheduled as **ML, after MT3** — `solution/parts/link-roadmap.md`. It is separable but *not* cheap, which the earlier entry here claimed: nothing scans links today, so it is a scanner, an index payload and a pane of its own. |
| ~~**Branching a range into its own file**~~ (R14) | — | **Left the backlog in M2** (D13), and its findability half arrived with search in M4 — so the requirement is met end to end: the file is made, the link is left behind, and both the file and the passage are findable. |
| ~~**Docket: a new matter starts folded**~~ | — | **Left the backlog on 2026-09-12.** Nothing had to promote it: a new matter is seeded with one step whose text *is* its name (D76), so the step list opened showing one line repeating the heading above it — the same redundancy the horizon had to suppress when it stopped printing a matter's name beside a row that already said it. The fold already existed and the default was simply wrong. |
| ~~**Docket: an explicit list of instances**~~ (H7) | A one-off matter per session, or an interval that lies | **Left the backlog on 2026-09-13** (D80), one day after it entered — and not a new idea: H7 asked for *an explicit list* from the start, and **D76 withdrew it** when only *none / fixed / interval* had evidence. The evidence has now arrived: a role-playing game whose next few sessions are agreed in a chat thread, which is neither one date nor a rule. The dates are known, irregular, and finite, so an interval would be a lie and a matter per session loses the identity that recurrence exists to keep (H7a). The shape is a fourth `Schedule`, and the work is mostly that `instancesIn` stops computing and starts reading — the horizon and the tick already treat instances as a sequence. **ICS is the same shape with the list read from a file**, so this is also the cheaper half of that deferral. |
| ~~**Docket: `+ step` moves left of the expando**~~ | — | **Left the backlog on 2026-09-12**, the same day it was reported, being a bug rather than a candidate. The row flushes right, so unfolding a matter inserted `+ step` to the *right* of the disclosure and shifted the disclosure left — expand-then-immediately-collapse landed on `+ step` and silently added one. D42's no-jumping rule broken by a control appearing beside a control; the fix was putting `+ step` on the left so nothing already there moves. |
| ~~**Docket: the date column wants a fixed width**~~ | — | **Left the backlog on 2026-09-12**, with the `+ step` jump it shares a cause with: a right-flushed row lets any element's width move everything left of it. **One fixed slot was not enough** — the date *and* the action both had to be given one, because two variable widths in the same row make a ragged column whichever of them you pin. |
| ~~**De-spaghettify `DocumentService`**~~ | — | **Left the backlog on 2026-09-14, built** (D83, D84). Named from use 2026-09-12 on the evidence of its own field names: `#queue` and `#midPass` read as unambiguous only in a class small enough to have one of each, and that one had ~159 members spanning document lifecycle, windows, the day clock, the task list, dockets, the horizon and reconciliation. What it became: **sixteen services across four tiers**, following the IPC channel boundary, with `NotebookService` reduced to the composition root that answers no channel at all — and `ShellService` as its parallel above the tier line. `ipc.ts` went 471 lines to 66. The plan and what each of the eleven steps actually cost are in `service-layers.md`; the one regression in the whole exercise is note 62. |

