# Feature backlog

Candidates for after v2 (sync and Android). This is a list of *things to decide about*, not a plan — when the time comes, each is admitted or dropped deliberately, against the test in `goal/scope.md`: **what does having this here beat?**

Each entry records what it competes with and what evidence would promote it. Evidence comes from living on v1 and v2, which is why v1 deliberately runs the plain-file stand-ins rather than doing without.

| Candidate | Competes with | What would promote it |
|---|---|---|
| ~~**TODO type and UX**~~ (R15–R17) | — | **Left the backlog on 2026-09-01** (D55–D58). Both reasons for the M3 re-deferral fell: the record-shaped prediction was wrong (it is a text kind), and D4's evidence gate was never exercised, so its silence was not a "no". Designed in `goal/todo.md` and `solution/todo.md`. |
| ~~**Urgency ranking**~~ (R16) | — | Absorbed as T9. |
| ~~**The forced review**~~ (R16a) | — | Dissolved: the premise was wrong. It became two mechanisms — the soft cap (T12) and the daily walk (T11) — neither of which is a forced review. See Q3. |
| ~~**The link directory**~~ (R10a) | — | **Left the backlog on 2026-09-01** (D57, D60, D61). Nothing had to promote it: the need was already established (`goal/todo.md`, interaction 2, unserved in three eras) and the sweep is one `CorpusIndex` already performs. Scheduled as **ML, after MT3** — `solution/link-roadmap.md`. It is separable but *not* cheap, which the earlier entry here claimed: nothing scans links today, so it is a scanner, an index payload and a pane of its own. |
| **Backlog resurfacing** (T14, Q3a) | Cancelling outright, or a list nobody rereads | The mechanism is undecided, which is the whole of Q3a. Everything else in the TODO design is settled. |
| **Filesets** (R20–R22) | A directory plus a notes file | Specific failures of the directory: summaries not kept, en-masse opening painful, snapshots not taken. |
| **URL snapshotting** (R22) | Saving a PDF by hand | Links found dead when it mattered. |
| **Browser extension** (R23) | Copy and paste | Frequency — the friction only counts if capture is frequent enough to matter. |
| **Branching a range into its own file** (R14) | Cut and paste, plus a link | The findability half is the real requirement; a branched file nobody can find later is the current failure being fixed. |
| **Editable filtered views** | Read-only views, jump to source to edit | Measured friction of the jump. This is the most demanding thing in the design (`goal/scope.md`), so the evidence bar is correspondingly high. |
| **Real search** | v1's literal substring matching | Substring search failing on real recall tasks — the half-remembered thing not found. |
| **A derived index** | Scanning | Scans ceasing to be instant (D7). |
| **History browser** | `git log` and `git show` in a terminal | The repository accumulates from v1 (D32), so the data is there from day one and only the affordance is missing. Promoted by the first time something is destroyed and noticed late — or by the terminal path proving too slow to reach for |
| **Footnotes as their own annotation kind** (D50) | Writing a footnote by hand, or using a comment for one | The first time a printed page wants notes at the foot AND commentary in the margin at the same time — the policy already expresses it, and only the kind is missing. Encoding is the open part: GFM `[^1]` is readable by every other renderer (R26) and needs a parser extension `@lezer/markdown`'s GFM does not include, where a marker pair would be consistent with comments (D47) and less legible in the raw file. |
| **docx and other export** | Copy and paste into another program | An actual occasion where the markdown was not enough. |
